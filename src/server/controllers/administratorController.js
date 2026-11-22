import { Op } from 'sequelize'
import jwt from 'jsonwebtoken'
import Administrator from '../models/Administrator.js'
import OperationLog from '../models/OperationLog.js'
import AuditLog from '../models/AuditLog.js'
import { JWT_ADMIN_SECRET } from '../config/jwtSecret.js'
import { recordLoginFailure, clearLoginFailures } from '../middlewares/loginGuard.js'
import { invalidateAdminAuthCache } from '../middlewares/adminAuthMiddleware.js'
import { assertPasswordPolicy } from '../utils/passwordPolicy.js'
import { logger } from '../utils/logger.js'
import { resolvePagination } from '../utils/pagination.js'
import { likeContains } from '../utils/likeSearch.js'
import { parseId } from '../utils/params.js'
import { respondDbError } from '../utils/dbInputError.js'
import { csvCell } from '../utils/csvExporter.js'
import { getBusinessTimezone, localDateKey } from '../utils/businessTimezone.js'

/** CSV 导出行数上限（与用户/合作方导出同口径） */
const CSV_EXPORT_ROW_LIMIT = 50000

class AdministratorController {
  // 管理员登录
  static async login(req, res) {
    try {
      const { username, password } = req.body

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          message: '用户名和密码为必填项'
        })
      }

      /**
       * 查找管理员（第 48 轮：**不**在这里过滤 is_active）。
       *
       * 原来把 `is_active: true` 混在查询条件里 → 账号被停用时查不到 →
       * 一律回"用户名或密码错误" → 被停用的管理员会一直以为是自己密码打错，
       * 反复重试（还可能触发失败次数限制）。
       *
       * 现在分开判定：查得到但被停用 → 明确告诉他"账号已停用，请联系超级管理员"。
       */
      const admin = await Administrator.findOne({
        where: {
          [Op.or]: [
            { username },
            { email: username }
          ]
        }
      })

      if (!admin) {
        await recordLoginFailure(req, username)
        AuditLog.logAdmin({
          admin: { username },
          event: 'admin.login.fail',
          success: false,
          detail: { reason: 'not_found' },
          req
        }).catch(() => {})
        return res.status(401).json({
          success: false,
          message: '用户名或密码错误'
        })
      }

      if (!admin.is_active) {
        await recordLoginFailure(req, username)
        AuditLog.logAdmin({
          admin: { username },
          event: 'admin.login.fail',
          success: false,
          detail: { reason: 'inactive' },
          req
        }).catch(() => {})
        return res.status(403).json({
          success: false,
          message: '账号已被停用，请联系超级管理员',
          // 前端据此用**自己语言**说这句话（后端消息只有中文）
          code: 'ACCOUNT_DISABLED'
        })
      }

      // 验证密码
      const isValidPassword = await admin.validatePassword(password)
      if (!isValidPassword) {
        await recordLoginFailure(req, username)
        AuditLog.logAdmin({
          admin,
          event: 'admin.login.fail',
          success: false,
          detail: { reason: 'bad_password' },
          req
        }).catch(() => {})
        return res.status(401).json({
          success: false,
          message: '用户名或密码错误'
        })
      }

      // 更新最后登录时间
      admin.last_login_at = new Date()
      await admin.save()
      await clearLoginFailures(req, username)

      // 生成JWT token
      const token = jwt.sign(
        { 
          adminId: admin.id, 
          username: admin.username, 
          role: admin.role,
          type: 'admin', // 标识这是管理员token
          tv: Number(admin.token_version) || 0
        },
        JWT_ADMIN_SECRET,
        { expiresIn: '8h', algorithm: 'HS256' } // 管理员token有效期8小时
      )

      // 记录登录日志
      await OperationLog.logOperation({
        adminId: admin.id,
        adminUsername: admin.username,
        action: 'login',
        resource: 'administrator',
        resourceId: admin.id,
        description: '管理员登录',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      })

      res.json({
        success: true,
        message: '登录成功',
        data: {
          admin: admin.toSafeJSON(),
          token,
          // 强制改密标志：前端据此跳改密页（服务端也会拦，见 adminAuthMiddleware）
          must_reset_password: admin.must_reset_password === true
        }
      })
    } catch (error) {
      logger.error('管理员登录失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '登录失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  // 获取所有管理员
  static async getAllAdministrators(req, res) {
    try {
      const { role, keyword } = req.query
      // 该端点分页参数名为 limit：统一 clamp（下限 1、上限 200 兼容管理端全量拉取、非法回退默认）
      const { page, pageSize, limit, offset } = resolvePagination(req.query, { pageSizeKey: 'limit', defaultPageSize: 20, maxPageSize: 200 })

      const where = {}
      if (role) {
        where.role = role
      }
      if (keyword) {
        where[Op.or] = [
          { username: { [Op.like]: likeContains(keyword) } },
          { real_name: { [Op.like]: likeContains(keyword) } },
          { email: { [Op.like]: likeContains(keyword) } }
        ]
      }

      const { count, rows } = await Administrator.findAndCountAll({
        where,
        limit,
        offset,
        order: [['created_at', 'DESC']],
        attributes: { exclude: ['password'] }
      })

      res.json({
        success: true,
        data: {
          administrators: rows,
          total: count,
          page,
          totalPages: Math.ceil(count / pageSize)
        }
      })
    } catch (error) {
      logger.error('获取管理员列表失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取管理员列表失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  // 创建管理员
  static async createAdministrator(req, res) {
    try {
      const { username, email, password, role, real_name, phone } = req.body
      const currentAdmin = req.admin

      // 验证必填字段
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          message: '用户名和密码为必填项'
        })
      }

      /**
       * 邮箱是**选填**字段：前端不填时提交的是空字符串 `''`。
       *
       * 这里显式归一化成 `null`，让**唯一性预检查**与**入库**用同一个口径
       * （否则预检查拿 `''` 去查、入库拿 `null` 存，两边对不上）。
       * 模型层（Administrator 的 beforeValidate）也做了同样的归一化，
       * 覆盖更新路径 —— 两处都在是有意的：控制器这层管"查"，模型那层管"存"。
       */
      const normalizedEmail = email ? String(email).trim() : null

      /**
       * 密码强度与用户侧/合作方侧**同一把尺子**（assertPasswordPolicy）。
       *
       * 管理端是权限最高的 realm：管理端令牌能看到全部订单、客户资料、
       * 导出与经营统计。口令策略一旦比别处松，这里就成了全站最弱的一环 ——
       * 而"所有设密入口同一把尺子"恰恰是 AT-7 已经断言过的性质。
       *
       * 只影响**新设**的密码；已存在账号的口令不受影响（登录不校验策略，
       * 不存在把存量管理员锁在门外的风险）。
       */
      const policy = assertPasswordPolicy(password)
      if (!policy.ok) {
        return res.status(400).json({
          success: false,
          message: policy.message
        })
      }

      // 验证角色权限
      if (role === 'super_admin' && currentAdmin.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          message: '只有超级管理员才能创建超级管理员'
        })
      }

      // 检查用户名是否已存在
      const existingAdmin = await Administrator.findOne({
        where: {
          [Op.or]: [
            { username },
            ...(normalizedEmail ? [{ email: normalizedEmail }] : [])
          ]
        }
      })

      if (existingAdmin) {
        return res.status(400).json({
          success: false,
          message: '用户名或邮箱已存在'
        })
      }

      // 创建管理员
      const newAdmin = await Administrator.create({
        username,
        email: normalizedEmail,
        password,
        role: role || 'operator',
        real_name,
        phone,
        created_by: currentAdmin.id
      })

      // 操作日志由路由层 logOperation 中间件统一记录（响应 data 即 newData，含 id 作为 resourceId）
      res.status(201).json({
        success: true,
        message: '管理员创建成功',
        data: newAdmin.toSafeJSON()
      })
    } catch (error) {
      return respondDbError(res, error, {
        logLabel: '创建管理员失败',
        fallbackMessage: '创建管理员失败',
        logger
      })
    }
  }

  // 更新管理员
  static async updateAdministrator(req, res) {
    try {
      const { id } = req.params
      const { username, email, role, real_name, phone, is_active } = req.body
      const currentAdmin = req.admin

      const admin = await Administrator.findByPk(id)
      if (!admin) {
        return res.status(404).json({
          success: false,
          message: '管理员不存在'
        })
      }

      // 验证权限
      if (admin.role === 'super_admin' && currentAdmin.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          message: '只有超级管理员才能修改超级管理员'
        })
      }

      const oldData = admin.toSafeJSON()

      // 更新字段
      if (username && username !== admin.username) {
        // 检查用户名是否已存在
        const existing = await Administrator.findOne({
          where: { username, id: { [Op.ne]: id } }
        })
        if (existing) {
          return res.status(400).json({
            success: false,
            message: '用户名已存在'
          })
        }
        admin.username = username
      }

      // 邮箱选填：不填 = 清空（存 null，不存 ''）—— 见 createAdministrator 里的说明
      if (email !== undefined) admin.email = email ? String(email).trim() : null
      if (role && role !== admin.role) {
        if (role === 'super_admin' && currentAdmin.role !== 'super_admin') {
          return res.status(403).json({
            success: false,
            message: '只有超级管理员才能设置超级管理员角色'
          })
        }
        admin.role = role
      }
      if (real_name !== undefined) admin.real_name = real_name
      if (phone !== undefined) admin.phone = phone
      if (is_active !== undefined) {
        // 超级管理员不可被禁用
        if (admin.role === 'super_admin' && is_active === false) {
          return res.status(400).json({
            success: false,
            message: '超级管理员账户不能被禁用'
          })
        }
        // 防止管理员禁用自己的账户
        if (admin.id === currentAdmin.id && is_active === false) {
          return res.status(400).json({
            success: false,
            message: '不能禁用自己的账户'
          })
        }
        admin.is_active = is_active
      }

      await admin.save()

      // 角色/启用状态可能已变更：立即失效鉴权链 5s 短缓存，不等 TTL 自然过期
      invalidateAdminAuthCache(admin.id)

      // 操作日志由路由层 logOperation 中间件统一记录；
      // 中间件固定以响应 data 作为 newData，故把变更前快照挂到 data.old_data 传递，避免审计信息丢失
      res.json({
        success: true,
        message: '管理员更新成功',
        data: { ...admin.toSafeJSON(), old_data: oldData }
      })
    } catch (error) {
      return respondDbError(res, error, {
        logLabel: '更新管理员失败',
        fallbackMessage: '更新管理员失败',
        logger
      })
    }
  }

  // 删除管理员
  static async deleteAdministrator(req, res) {
    try {
      const { id } = req.params
      const currentAdmin = req.admin

      const admin = await Administrator.findByPk(id)
      if (!admin) {
        return res.status(404).json({
          success: false,
          message: '管理员不存在'
        })
      }

      // 不能删除自己
      if (admin.id === currentAdmin.id) {
        return res.status(400).json({
          success: false,
          message: '不能删除自己'
        })
      }

      // 验证权限
      if (admin.role === 'super_admin' && currentAdmin.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          message: '只有超级管理员才能删除超级管理员'
        })
      }

      const oldData = admin.toSafeJSON()
      await admin.destroy()
      // 删号后立即失效鉴权缓存，旧 token 下一请求即 401
      invalidateAdminAuthCache(admin.id)

      // 操作日志由路由层 logOperation 中间件统一记录；
      // 中间件固定以响应 data 作为 newData，故把已删除管理员的快照经响应体传递给中间件存档
      res.json({
        success: true,
        message: '管理员删除成功',
        data: oldData
      })
    } catch (error) {
      logger.error('删除管理员失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '删除管理员失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  // 重置密码
  static async resetPassword(req, res) {
    try {
      const { id } = req.params
      const { password } = req.body
      const currentAdmin = req.admin

      /**
       * 密码强度与用户侧/合作方侧**同一把尺子**（assertPasswordPolicy）。
       *
       * 原来这里只校验"至少 6 个字符"—— `123456` 在管理端是能被暴力猜到的，
       * 而管理端令牌能看全部订单、客户资料、导出与经营统计。
       *
       * 对比用户侧：管理员重置**客户**密码走的是"生成随机临时密码 + 强制首登改密"，
       * 根本不允许调用方自带口令。这里允许自带，就该用同一把尺子。
       */
      const policy = assertPasswordPolicy(password)
      if (!policy.ok) {
        return res.status(400).json({
          success: false,
          message: policy.message
        })
      }

      const admin = await Administrator.findByPk(id)
      if (!admin) {
        return res.status(404).json({
          success: false,
          message: '管理员不存在'
        })
      }

      // 验证权限
      if (admin.role === 'super_admin' && currentAdmin.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          message: '只有超级管理员才能重置超级管理员密码'
        })
      }

      admin.password = password
      admin.token_version = (Number(admin.token_version) || 0) + 1
      await admin.save()
      // 改密后立即失效鉴权缓存与旧 JWT（约定：凭据类变更即刻收敛）
      invalidateAdminAuthCache(admin.id)

      // 操作日志由路由层 logOperation 中间件统一记录；
      // 经响应体把操作对象（不含密码）传给中间件，保证 resourceId/用户名不丢失
      res.json({
        success: true,
        message: '密码重置成功',
        data: { id: admin.id, username: admin.username }
      })
    } catch (error) {
      logger.error('重置密码失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '重置密码失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  /**
   * 修改**自己**的密码。
   *
   * 为什么必须有这个接口：管理员端此前**没有任何**"改自己密码"的入口
   * （只有管理员改别人的 resetPassword），所以"必须改密"这件事无处可去。
   *
   * 安全点：
   * - 校验**旧密码**（防止会话被劫持后直接改密码）
   * - 强度与其它端同一把尺子（assertPasswordPolicy）
   * - 不允许与旧密码相同
   * - 改密后递增 token_version → 旧 JWT 立即失效；并清掉 must_reset_password
   */
  static async changeMyPassword(req, res) {
    try {
      const { old_password, new_password } = req.body || {}
      if (!old_password || !new_password) {
        return res.status(400).json({ success: false, message: '请填写原密码与新密码' })
      }

      const policy = assertPasswordPolicy(new_password)
      if (!policy.ok) {
        return res.status(400).json({ success: false, message: policy.message })
      }
      if (String(old_password) === String(new_password)) {
        return res.status(400).json({ success: false, message: '新密码不能与原密码相同' })
      }

      const admin = await Administrator.findByPk(req.admin.id)
      if (!admin) {
        return res.status(404).json({ success: false, message: '管理员不存在' })
      }
      const ok = await admin.validatePassword(String(old_password))
      if (!ok) {
        return res.status(400).json({ success: false, message: '原密码不正确' })
      }

      admin.password = String(new_password)
      admin.must_reset_password = false
      admin.token_version = (Number(admin.token_version) || 0) + 1
      await admin.save()
      invalidateAdminAuthCache(admin.id)

      return res.json({
        success: true,
        message: '密码修改成功，请重新登录',
        data: { id: admin.id, username: admin.username }
      })
    } catch (error) {
      logger.error('修改本人密码失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({
        success: false,
        message: '密码修改失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  // 获取操作日志
  /**
   * 行为审计日志（第 46 轮）
   *
   * AuditLog 与 OperationLog 是**两张表**：
   *   - OperationLog：管理员在后台的写操作（改状态、改配置…）
   *   - AuditLog：用户与合作方的行为（登录、下单、改密、取消…）
   *
   * 之前 AuditLog **只写不读**（全库没有一处 AuditLog.findAll）→
   * 合作方登录/下单/改密在运营界面**完全无痕**：
   * 合作方说"我没下过这单"、"我没改过密码"，运营查不出来。
   *
   * 现在开放只读查询（含分页与筛选），供运营排查纠纷与核对行为。
   */
  static async getAuditLogs (req, res) {
    try {
      const { actor_type, event, resource, start_date, end_date } = req.query
      const { page, pageSize, limit, offset } = resolvePagination(req.query, { defaultPageSize: 50 })
      const where = {}
      if (actor_type) where.actor_type = actor_type
      if (event) where.event = { [Op.like]: likeContains(event) }
      if (resource) where.resource = resource
      if (start_date && end_date) {
        where.created_at = { [Op.between]: [new Date(start_date), new Date(end_date)] }
      }
      /**
       * 第 49 轮：裁掉 `user_agent`（没人看、很长）。
       * `detail` 保留 —— 它才是审计日志的**内容**（超时删单的订单号/金额/原因就在里面），
       * 配套把 detail 做成看得见的一列（见 admin/views/AuditLogs.vue）。
       */
      const { count, rows } = await AuditLog.findAndCountAll({
        where,
        attributes: { exclude: ['user_agent'] },
        limit,
        offset,
        order: [['created_at', 'DESC']]
      })
      return res.json({
        success: true,
        data: {
          logs: rows,
          total: count,
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize)
        }
      })
    } catch (e) {
      logger.error('读取行为审计日志失败', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '读取行为审计日志失败' })
    }
  }

  /**
   * 导出操作日志 CSV（第 46 轮）
   *
   * 之前操作日志**只能看、不能导出** —— 出了事要留证/交给审计，
   * 运营只能截图（或者干脆没有）。
   *
   * 口径与列表一致（同一套筛选条件 → 同一批数据），行数上限同其它 CSV 导出。
   */
  static async exportOperationLogs (req, res) {
    try {
      const { admin_id, action, resource, start_date, end_date } = req.query
      const where = {}
      if (admin_id) where.admin_id = admin_id
      if (action) where.action = { [Op.like]: likeContains(action) }
      if (resource) where.resource = resource
      if (start_date && end_date) {
        where.created_at = { [Op.between]: [new Date(start_date), new Date(end_date)] }
      }
      const rows = await OperationLog.findAll({
        where,
        order: [['created_at', 'DESC']],
        limit: CSV_EXPORT_ROW_LIMIT
      })
      const header = ['id', 'admin_id', 'admin_username', 'action', 'resource', 'resource_id', 'created_at']
      const lines = [header.join(',')]
      for (const row of rows) {
        const raw = row.toJSON()
        lines.push(header.map(col => {
          switch (col) {
            case 'id': return String(raw.id ?? '')
            case 'admin_id': return String(raw.admin_id ?? '')
            case 'admin_username': return csvCell(raw.admin_username)
            case 'action': return csvCell(raw.action)
            case 'resource': return csvCell(raw.resource)
            case 'resource_id': return raw.resource_id == null ? '' : String(raw.resource_id)
            case 'created_at': return csvCell(raw.created_at)
            default: return ''
          }
        }).join(','))
      }
      const tz = await getBusinessTimezone()
      const filename = `operation-logs-${localDateKey(tz, new Date())}.csv`
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      return res.send('\ufeff' + lines.join('\r\n'))
    } catch (e) {
      logger.error('导出操作日志 CSV 失败', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '导出失败' })
    }
  }

  /**
   * 单条操作日志详情（第 49 轮）：带 `old_data` / `new_data` 快照。
   *
   * 列表不再带这两个大字段（每页 50 行），点开某一行时再按需取 ✓
   */
  static async getOperationLogDetail (req, res) {
    try {
      const id = parseId(req.params.id)
      if (!id) {
        return res.status(400).json({ success: false, message: '无效的日志 ID' })
      }
      const row = await OperationLog.findByPk(id)
      if (!row) {
        return res.status(404).json({ success: false, message: '日志不存在' })
      }
      return res.json({ success: true, data: row })
    } catch (e) {
      logger.error('读取操作日志详情失败', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '读取日志详情失败' })
    }
  }

  static async getOperationLogs(req, res) {
    try {
      const { admin_id, action, resource, start_date, end_date } = req.query
      // 该端点分页参数名为 limit：统一 clamp（下限 1、上限 100、非法回退默认）
      const { page, pageSize, limit, offset } = resolvePagination(req.query, { pageSizeKey: 'limit', defaultPageSize: 50 })

      const where = {}
      if (admin_id) where.admin_id = admin_id
      if (action) where.action = { [Op.like]: likeContains(action) }
      if (resource) where.resource = resource
      if (start_date && end_date) {
        where.created_at = {
          [Op.between]: [new Date(start_date), new Date(end_date)]
        }
      }

      /**
       * 第 49 轮：列表**不带** `old_data` / `new_data`（两个 JSONB 快照，
       * 每页 50 行全带是纯浪费），详情**按需取**（GET /operation-logs/:id）。
       */
      const { count, rows } = await OperationLog.findAndCountAll({
        where,
        attributes: { exclude: ['old_data', 'new_data'] },
        limit,
        offset,
        order: [['created_at', 'DESC']]
      })

      res.json({
        success: true,
        data: {
          logs: rows,
          total: count,
          page,
          totalPages: Math.ceil(count / pageSize)
        }
      })
    } catch (error) {
      logger.error('获取操作日志失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取操作日志失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  // 初始化超级管理员（仅在没有任何管理员时可用）
  static async initSuperAdmin(req, res) {
    try {
      /**
       * 修复 A4 拒绝抢占：必须 INIT_SECRET 校验通过；生产环境若未配置则禁用此路由
       * 仍保留"已存在则拒绝"的双保险
       */
      const expected = process.env.INIT_SECRET ? String(process.env.INIT_SECRET) : ''
      if (process.env.NODE_ENV === 'production' && !expected) {
        return res.status(404).json({ success: false, message: 'NOT_FOUND' })
      }
      const headerVal = req.headers['x-init-secret']
      const provided = (Array.isArray(headerVal) ? headerVal[0] : headerVal) || req.body?.init_secret || ''
      if (!expected || String(provided) !== expected) {
        return res.status(403).json({ success: false, message: '初始化口令缺失或不正确' })
      }

      const existingAdmin = await Administrator.findOne()
      if (existingAdmin) {
        return res.status(400).json({
          success: false,
          message: '系统已初始化，不能重复创建超级管理员'
        })
      }

      /**
       * 初始超级管理员口令：与所有其它设密入口**同一把尺子**。
       *
       * 原来这里只要求"≥8 字符"，比 assertPasswordPolicy 宽（后者还要数字+字母）。
       * 这是全站第一个被创建的管理员账号 —— 它的强度决定了整条管理链的起点。
       */
      const presetRaw = process.env.INIT_ADMIN_PASSWORD ? String(process.env.INIT_ADMIN_PASSWORD) : ''
      const presetPolicy = presetRaw ? assertPasswordPolicy(presetRaw) : { ok: false, message: '未设置' }
      const presetPassword = presetPolicy.ok ? presetRaw : null
      if (!presetPassword && process.env.NODE_ENV === 'production') {
        return res.status(400).json({
          success: false,
          message: presetRaw
            ? `生产环境初始密码强度不足：${presetPolicy.message}`
            : '生产环境必须通过 INIT_ADMIN_PASSWORD 设置初始密码（至少8位，含数字与英文字母）'
        })
      }
      // 开发环境兜底：'admin123' 恰好满足统一策略（8 位 + 数字 + 字母）
      const finalPassword = presetPassword || 'admin123'

      const superAdmin = await Administrator.create({
        username: 'admin',
        password: finalPassword,
        role: 'super_admin',
        real_name: '超级管理员',
        is_active: true
      })

      res.json({
        success: true,
        message: '超级管理员初始化成功',
        data: {
          username: 'admin',
          message: '请立即登录并修改密码',
          ...(presetPassword ? {} : { password: finalPassword })
        }
      })
    } catch (error) {
      logger.error('初始化超级管理员失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '初始化失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }
}

export default AdministratorController
