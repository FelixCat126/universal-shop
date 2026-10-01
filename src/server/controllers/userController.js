import User from '../models/User.js'
import jwt from 'jsonwebtoken'
import { Op } from 'sequelize'
import crypto from 'crypto'
import Order from '../models/Order.js'
import { JWT_SECRET } from '../config/jwtSecret.js'
import * as pointsService from '../services/pointsService.js'
import { assertPasswordPolicy } from '../utils/passwordPolicy.js'
import AuditLog from '../models/AuditLog.js'
import { recordLoginFailure, clearLoginFailures } from '../middlewares/loginGuard.js'
import { grantRegisterGiftCoupons } from '../services/couponService.js'
import { logger } from '../utils/logger.js'
import { resolvePagination } from '../utils/pagination.js'

class UserController {
  // 用户注册
  static async register(req, res) {
    try {
      const { nickname, country_code = '+66', phone, email, password, referral_code } = req.body

      // 验证必填字段
      if (!nickname || !phone || !password) {
        return res.status(400).json({
          success: false,
          message: '昵称、手机号和密码为必填项'
        })
      }

      // 验证国家区号
      const supportedCountries = ['+86', '+66', '+60']
      if (!supportedCountries.includes(country_code)) {
        return res.status(400).json({
          success: false,
          message: '不支持的国家区号'
        })
      }

      // 验证手机号格式（静态方法作路由回调时 this 非类实例，须显式用类名）
      const phoneValidation = UserController._validatePhoneNumber(phone, country_code)
      if (!phoneValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: phoneValidation.message
        })
      }

      // 检查国家区号+手机号组合是否已存在（新的唯一性检查）
      const existingPhone = await User.findOne({ 
        where: { 
          country_code: country_code,
          phone: phone 
        } 
      })
      if (existingPhone) {
        if (!existingPhone.is_active) {
          return res.status(403).json({
            success: false,
            message: '该手机号关联的账户已被禁用，请联系管理员'
          })
        }
        return res.status(400).json({
          success: false,
          message: '该手机号已被注册'
        })
      }

      // 如果提供了邮箱，检查邮箱是否已存在
      if (email) {
        const existingEmail = await User.findOne({ 
          where: { 
            [Op.or]: [
              { email: email },
              { username: email }
            ]
          }
        })
        if (existingEmail) {
          return res.status(400).json({
            success: false,
            message: '该邮箱已被注册'
          })
        }
      }

      const pol = assertPasswordPolicy(password)
      if (!pol.ok) {
        return res.status(400).json({
          success: false,
          message: pol.message
        })
      }

      // 使用统一的核心创建逻辑
      const user = await UserController._createUserCore({
        nickname,
        country_code,
        phone,
        password,
        email,
        referral_code
      }, false) // false表示是正常注册

      // 生成JWT token
      const token = jwt.sign(
        { userId: user.id, username: user.username, type: 'user' },
        JWT_SECRET,
        { expiresIn: '7d' }
      )

      AuditLog.logUser({
        user,
        event: 'user.register.success',
        detail: { has_referral: Boolean(referral_code) },
        req
      }).catch(() => {})

      res.status(201).json({
        success: true,
        message: '注册成功',
        data: {
          user: user.toSafeJSON(),
          token
        }
      })
    } catch (error) {
      logger.error('用户注册失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '注册失败',
        error: error.message
      })
    }
  }

  // 更新当前用户资料（昵称、邮箱）
  static async updateProfile(req, res) {
    try {
      const userId = req.user?.userId
      if (!userId) {
        return res.status(401).json({ success: false, message: '未登录' })
      }

      const { nickname, email, avatar_url } = req.body
      let nextAvatarUrl
      const avatarKeyPresent = Object.prototype.hasOwnProperty.call(req.body, 'avatar_url')

      // 基本校验
      if (!nickname || nickname.length > 50) {
        return res.status(400).json({ success: false, message: '昵称不能为空且不超过50个字符' })
      }

      if (avatarKeyPresent) {
        if (avatar_url == null || avatar_url === '') {
          nextAvatarUrl = null
        } else {
          const s = String(avatar_url).trim()
          if (s.length > 512) {
            return res.status(400).json({ success: false, message: '头像地址无效' })
          }
          if (!s.startsWith('/uploads/avatars/')) {
            return res.status(400).json({ success: false, message: '头像地址无效' })
          }
          if (s.includes('..') || s.includes('\\')) {
            return res.status(400).json({ success: false, message: '头像地址无效' })
          }
          nextAvatarUrl = s
        }
      }

      // 邮箱可选；如果传入则校验唯一
      if (email) {
        const exists = await User.findOne({
          where: {
            [Op.or]: [
              { email },
              { username: email }
            ],
            id: { [Op.ne]: userId }
          }
        })
        if (exists) {
          return res.status(400).json({ success: false, message: '该邮箱已被占用' })
        }
      }

      const user = await User.findByPk(userId)
      if (!user) {
        return res.status(404).json({ success: false, message: '用户不存在' })
      }

      user.nickname = nickname
      // 同步email与username（兼容旧逻辑用户名即邮箱）
      user.email = email || null
      user.username = email || null
      if (avatarKeyPresent) {
        user.avatar_url = nextAvatarUrl
      }
      await user.save()

      return res.json({ success: true, message: '资料更新成功', data: user.toSafeJSON() })
    } catch (error) {
      logger.error('更新用户资料失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '更新失败', error: error.message })
    }
  }

  /** 已登录用户修改登录密码（需校验旧密码） */
  static async changePassword(req, res) {
    try {
      const userId = req.user?.userId
      if (!userId) {
        return res.status(401).json({ success: false, message: '未登录' })
      }

      const { old_password: oldPassword, new_password: newPassword } = req.body

      if (oldPassword == null || newPassword == null ||
          String(oldPassword).length === 0 || String(newPassword).length === 0) {
        return res.status(400).json({
          success: false,
          message: '请输入当前密码和新密码'
        })
      }

      const next = String(newPassword)
      const pol = assertPasswordPolicy(next)
      if (!pol.ok) {
        return res.status(400).json({
          success: false,
          message: pol.message
        })
      }

      const user = await User.findByPk(userId)
      if (!user) {
        return res.status(404).json({ success: false, message: '用户不存在' })
      }

      const ok = await user.validatePassword(String(oldPassword))
      if (!ok) {
        return res.status(400).json({
          success: false,
          message: '当前密码不正确'
        })
      }

      user.password = next
      await user.save()

      return res.json({
        success: true,
        message: '密码已更新'
      })
    } catch (error) {
      logger.error('修改密码失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({
        success: false,
        message: '修改密码失败',
        error: error.message
      })
    }
  }

  // 用户登录
  static async login(req, res) {
    try {
      const { email, country_code, phone, password } = req.body

      // 支持两种登录方式：
      // 1. 新方式：country_code + phone + password
      // 2. 兼容旧方式：email + password
      
      let user
      
      if (country_code && phone) {
        // 新的手机号登录方式
        if (!password) {
          return res.status(400).json({
            success: false,
            message: '密码不能为空'
          })
        }

        // 验证国家区号
        const supportedCountries = ['+86', '+66', '+60']
        if (!supportedCountries.includes(country_code)) {
          return res.status(400).json({
            success: false,
            message: '不支持的国家区号'
          })
        }

        // 根据国家区号+手机号查找用户
        user = await User.findByCountryAndPhone(country_code, phone)
      } else if (email) {
        // 兼容旧的邮箱登录方式
        const identifier = email.trim()

        if (!identifier || !password) {
          return res.status(400).json({
            success: false,
            message: '账号和密码为必填项'
          })
        }

        // 查找用户（支持邮箱/用户名）
        user = await User.findOne({
          where: {
            [Op.or]: [
              { email: identifier },
              { username: identifier }
            ]
          }
        })
      } else {
        return res.status(400).json({
          success: false,
          message: '请提供手机号或邮箱进行登录'
        })
      }

      if (!user) {
        recordLoginFailure(req, phone || email)
        AuditLog.logUser({
          event: 'user.login.fail',
          success: false,
          detail: { reason: 'user_not_found', identifier: email || phone || null },
          req
        }).catch(() => {})
        return res.status(401).json({
          success: false,
          message: '用户名或密码错误'
        })
      }

      // 检查用户是否被禁用
      if (!user.is_active) {
        AuditLog.logUser({
          user,
          event: 'user.login.fail',
          success: false,
          detail: { reason: 'inactive' },
          req
        }).catch(() => {})
        return res.status(403).json({
          success: false,
          message: '账户已被禁用，请联系管理员'
        })
      }

      // 验证密码
      const isValidPassword = await user.validatePassword(password)
      if (!isValidPassword) {
        recordLoginFailure(req, phone || email)
        AuditLog.logUser({
          user,
          event: 'user.login.fail',
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
      user.last_login_at = new Date()
      await user.save()
      clearLoginFailures(req, phone || email)
      AuditLog.logUser({ user, event: 'user.login.success', req }).catch(() => {})

      // 生成JWT token
      const token = jwt.sign(
        { userId: user.id, username: user.username, type: 'user' },
        JWT_SECRET,
        { expiresIn: '7d' }
      )

      res.json({
        success: true,
        message: '登录成功',
        data: {
          user: user.toSafeJSON(),
          token
        }
      })
    } catch (error) {
      logger.error('用户登录失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '登录失败',
        error: error.message
      })
    }
  }

  // 获取用户列表（管理端）
  static async getAllUsers(req, res) {
    try {
      const {
        email = '',
        phone = '',
        referral_code = '',
        name = '',
        id: userIdParam = ''
      } = req.query

      // 分页参数统一 clamp（下限 1、上限 100、非法回退默认）
      const { page, pageSize, limit, offset } = resolvePagination(req.query, { defaultPageSize: 10 })

      // 构建查询条件
      const whereConditions = []
      if (userIdParam !== undefined && userIdParam !== null && String(userIdParam).trim() !== '') {
        const uid = parseInt(String(userIdParam), 10)
        if (Number.isFinite(uid) && uid > 0) {
          whereConditions.push({ id: uid })
        }
      }
      const nameTrim = typeof name === 'string' ? name.trim() : ''
      if (nameTrim) {
        const q = `%${nameTrim}%`
        whereConditions.push({
          [Op.or]: [
            { nickname: { [Op.like]: q } },
            { username: { [Op.like]: q } },
            { phone: { [Op.like]: q } }
          ]
        })
      }
      if (email) {
        whereConditions.push({
          [Op.or]: [
            { email: { [Op.like]: `%${email}%` } },
            { username: { [Op.like]: `%${email}%` } }
          ]
        })
      }
      if (phone) {
        whereConditions.push({ phone: { [Op.like]: `%${phone}%` } })
      }
      if (referral_code) {
        whereConditions.push({
          [Op.or]: [
            { referral_code: { [Op.like]: `%${referral_code}%` } },
            { referred_by_code: { [Op.like]: `%${referral_code}%` } }
          ]
        })
      }

      const finalWhereCondition = whereConditions.length > 0 ? { [Op.and]: whereConditions } : {}

      const { count, rows } = await User.findAndCountAll({
        where: finalWhereCondition,
        limit,
        offset,
        order: [['created_at', 'DESC']],
        attributes: { exclude: ['password'] } // 排除密码字段
      })

      const totalPages = Math.ceil(count / pageSize)

      // 服务端统计：今日/近7日/近30日新增用户数（按 created_at，不受分页与筛选影响）
      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      const startOfWeek = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000)
      const startOfMonth = new Date(startOfToday.getTime() - 29 * 24 * 60 * 60 * 1000)
      const [today, week, month] = await Promise.all([
        User.count({ where: { created_at: { [Op.gte]: startOfToday } } }),
        User.count({ where: { created_at: { [Op.gte]: startOfWeek } } }),
        User.count({ where: { created_at: { [Op.gte]: startOfMonth } } })
      ])

      res.json({
        success: true,
        data: {
          users: rows,
          pagination: {
            currentPage: page,
            pageSize,
            totalPages,
            total: count
          },
          stats: {
            today: Number(today) || 0,
            week: Number(week) || 0,
            month: Number(month) || 0
          }
        }
      })
    } catch (error) {
      logger.error('获取用户列表失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取用户列表失败',
        error: error.message
      })
    }
  }

  // 验证推荐码
  static async verifyReferralCode(req, res) {
    try {
      const { code } = req.params

      const user = await User.findByReferralCode(code)
      
      if (user) {
        res.json({
          success: true,
          message: '推荐码有效',
          data: {
            referrer: {
              username: user.username,
              referral_code: user.referral_code
            }
          }
        })
      } else {
        res.status(404).json({
          success: false,
          message: '推荐码不存在'
        })
      }
    } catch (error) {
      logger.error('验证推荐码失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '验证推荐码失败',
        error: error.message
      })
    }
  }

  // 验证Token
  static async verifyToken(req, res) {
    try {
      const userId = req.user.userId
      const user = await User.findByPk(userId, {
        attributes: ['id', 'username', 'email', 'phone', 'nickname', 'avatar_url', 'referral_code', 'created_at']
      })

      if (!user) {
        return res.status(404).json({
          success: false,
          message: '用户不存在'
        })
      }

      res.json({
        success: true,
        message: 'Token验证成功',
        data: {
          user: user,
          valid: true
        }
      })
    } catch (error) {
      logger.error('Token验证失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: 'Token验证失败',
        error: error.message
      })
    }
  }

  // 获取当前用户信息
  static async getCurrentUser(req, res) {
    try {
      const userId = req.user.userId
      const user = await User.findByPk(userId, {
        attributes: { exclude: ['password'] }
      })

      if (!user) {
        return res.status(404).json({
          success: false,
          message: '用户不存在'
        })
      }

      res.json({
        success: true,
        data: user
      })
    } catch (error) {
      logger.error('获取用户信息失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取用户信息失败',
        error: error.message
      })
    }
  }

  // 用户登出
  static async logout(req, res) {
    try {
      // JWT是无状态的，前端删除token即可
      // 这里可以添加黑名单逻辑或其他清理操作
      res.json({
        success: true,
        message: '登出成功'
      })
    } catch (error) {
      logger.error('用户登出失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '登出失败',
        error: error.message
      })
    }
  }

  /**
   * 统一的用户创建服务方法（用于订单自动注册）
   * 安全要点：默认密码不再用"手机号后 8 位"（可被字典/撞库猜测），
   *   改为 32 字节强随机；must_reset_password=true，强制下次登录改密。
   * 复用语义：手机号已存在且为游客自动创建账号（must_reset_password=true）时
   *   直接复用该账号（首单失败重试/并发同手机号均安全）；正常注册账号仍拒绝。
   */
  static async createUserForOrder(fullPhoneWithCode, contactName, referralCode = null) {
    try {
      let countryCode = '+66'
      let phoneNumber = fullPhoneWithCode
      const supportedCodes = ['+86', '+66', '+60']
      for (const code of supportedCodes) {
        if (fullPhoneWithCode.startsWith(code)) {
          countryCode = code
          phoneNumber = fullPhoneWithCode.substring(code.length)
          break
        }
      }

      // 32 字节随机 + 一个大写/小写/数字/符号锚点，确保通过任何强度策略
      const defaultPassword = `Aa1!${crypto.randomBytes(24).toString('base64url')}`

      return await UserController._createUserCore({
        nickname: contactName || `用户${phoneNumber.slice(-4)}`,
        country_code: countryCode,
        phone: phoneNumber,
        password: defaultPassword,
        email: null,
        referral_code: referralCode,
        must_reset_password: true
      }, true)
    } catch (error) {
      logger.error('createUserForOrder 执行失败', { err: error?.message, stack: error?.stack })
      throw error
    }
  }
  
  // 统一的用户创建核心逻辑
  static async _createUserCore(userData, isAutoRegister = false) {
    const { nickname, country_code, phone, password, email, referral_code, must_reset_password } = userData
    
    // 验证手机号格式 - 使用统一的验证逻辑
    const phoneValidation = UserController._validatePhoneNumber(phone, country_code)
    if (!phoneValidation.isValid) {
      throw new Error(phoneValidation.message)
    }

    // 自助注册／后台创建：校验密码复杂度；订单自动注册等口令由系统生成，不套用此规则
    if (!isAutoRegister) {
      const pol = assertPasswordPolicy(password)
      if (!pol.ok) {
        throw new Error(pol.message)
      }
    }

    // 检查手机号是否已存在
    const existingPhone = await User.findOne({
      where: {
        country_code: country_code,
        phone: phone
      }
    })
    if (existingPhone) {
      if (!existingPhone.is_active) {
        throw new Error(isAutoRegister ? '该手机号关联的账户已被禁用，无法下单' : '该手机号关联的账户已被禁用，请联系管理员')
      }
      /**
       * 游客下单自动注册：该账号若是此前游客单自动创建的（must_reset_password=true，
       * 用户从未设置过自己的密码），直接复用该账号继续下单——
       * 修复"首单失败后手机号被烧掉、重试永远报无法自动注册"的问题；
       * 正常注册账号（用户自己设过密码）仍拒绝复用，避免冒用他人已注册手机号下单
       */
      if (isAutoRegister && existingPhone.must_reset_password === true) {
        return existingPhone
      }
      throw new Error(isAutoRegister ? '该手机号已被注册，无法自动注册' : '该手机号已被注册')
    }

    // 如果提供了邮箱，检查邮箱是否已存在
    if (email) {
      const existingEmail = await User.findOne({ 
        where: { 
          [Op.or]: [
            { email: email },
            { username: email }
          ]
        }
      })
      if (existingEmail) {
        throw new Error('该邮箱已被注册')
      }
    }

    // 处理推荐码（如果提供了）- 自由填写，不需要验证存在性
    let validReferralCode = null
    if (referral_code && referral_code.trim()) {
      const code = referral_code.trim().toUpperCase()
      validReferralCode = code
    }
    
    const finalUserData = {
      username: isAutoRegister ? phone : `${country_code}${phone}`,
      nickname,
      email: email || null,
      country_code,
      phone,
      password,
      referred_by_code: validReferralCode,
      must_reset_password: must_reset_password === true
    }

    let user
    try {
      user = await User.create(finalUserData)
    } catch (createError) {
      /**
       * 并发下同手机号撞 (country_code, phone) 唯一约束（PG 23505）：
       * 预检与插入之间存在竞态窗口，负方在此捕获后重读胜方已落库的行——
       * 命中游客自动创建账号则复用（与上面已有账号分支同语义），否则报稳定的
       * 中文提示；不再把裸 Sequelize message（如 'Validation error'）透传给前端。
       * 仅自动注册路径做该兜底；自助注册路径维持原错误向上抛（其入口 500 包装不变）
       */
      const isUniqueViolation =
        createError?.name === 'SequelizeUniqueConstraintError' ||
        createError?.parent?.code === '23505' ||
        createError?.original?.code === '23505'
      if (!isUniqueViolation || !isAutoRegister) throw createError

      const racedUser = await User.findOne({
        where: {
          country_code: country_code,
          phone: phone
        }
      })
      if (racedUser) {
        if (!racedUser.is_active) {
          throw new Error('该手机号关联的账户已被禁用，无法下单')
        }
        if (racedUser.must_reset_password === true) {
          return racedUser
        }
      }
      throw new Error('该手机号已被注册，无法自动注册')
    }

    /**
     * 注册赠券（P2）：仅对新建用户发放——上方"复用既有游客账号"的早退分支不会再发；
     * await 保证调用方（注册响应/游客下单）返回前发券已落定，结果确定可测；
     * 失败只记日志，不影响注册主流程
     */
    try {
      await grantRegisterGiftCoupons(user.id)
    } catch (giftError) {
      logger.error('注册赠券发放失败（不影响注册）', {
        userId: user.id,
        err: giftError?.message,
        stack: giftError?.stack
      })
    }

    return user
  }

  // 检查手机号是否已注册
  static async checkPhoneExists(req, res) {
    try {
      const { phone } = req.params
      
      if (!phone) {
        return res.status(400).json({
          success: false,
          message: '手机号不能为空'
        })
      }

      const user = await User.findOne({ where: { phone } })
      
      res.json({
        success: true,
        data: {
          exists: !!user,
          phone
        }
      })
    } catch (error) {
      logger.error('检查手机号失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '检查手机号失败',
        error: error.message
      })
    }
  }

  // 管理员更新用户状态
  static async updateUserStatus(req, res) {
    try {
      const { id } = req.params
      const { is_active } = req.body

      if (typeof is_active !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: '状态值必须为布尔类型'
        })
      }

      const user = await User.findByPk(id)
      if (!user) {
        return res.status(404).json({
          success: false,
          message: '用户不存在'
        })
      }

      await user.update({ is_active })
      // 立即失效 authMiddleware 5s 缓存，确保该 token 下次请求即被拒绝
      const { invalidateAuthCache } = await import('../middlewares/authMiddleware.js')
      invalidateAuthCache(user.id)

      res.json({
        success: true,
        message: `用户${is_active ? '启用' : '禁用'}成功`,
        data: {
          id: user.id,
          nickname: user.nickname,
          is_active: user.is_active
        }
      })

    } catch (error) {
      logger.error('更新用户状态失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '更新用户状态失败',
        error: error.message
      })
    }
  }

  /**
   * 顶部名片统计：订单总数、累计消费(THB)、当前积分余额
   */
  static async getProfileMetrics(req, res) {
    try {
      const userId = req.user?.userId
      if (!userId) {
        return res.status(401).json({ success: false, message: '未登录' })
      }

      const order_count = await Order.count({ where: { user_id: userId } })
      const spentRaw = await Order.sum('total_amount_thb', {
        where: {
          user_id: userId,
          payment_method: { [Op.ne]: 'points' }
        }
      })
      const spent_thb = spentRaw != null && spentRaw !== ''
        ? parseFloat(String(spentRaw))
        : 0

      const points_balance = await pointsService.getBalance(userId)

      res.json({
        success: true,
        data: {
          order_count,
          spent_thb: Number.isFinite(spent_thb) ? spent_thb : 0,
          points_balance
        }
      })
    } catch (error) {
      logger.error('获取个人中心统计失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取统计失败'
      })
    }
  }

  // 手机号验证方法 - 更精确的验证逻辑
  static _validatePhoneNumber(phone, countryCode) {
    // 基础检查：必须是纯数字
    if (!/^\d+$/.test(phone)) {
      return {
        isValid: false,
        message: '手机号必须为纯数字'
      }
    }

    // 根据国家区号进行具体验证
    switch (countryCode) {
      case '+86': // 中国
        // 中国手机号：11位，以1开头，第二位为3-9
        if (!/^1[3-9]\d{9}$/.test(phone)) {
          return {
            isValid: false,
            message: '中国手机号格式错误，应为11位数字，以1开头'
          }
        }
        break
        
      case '+66': // 泰国
        // 泰国手机号：9-10位，以6、8、9开头
        if (!/^[689]\d{8,9}$/.test(phone)) {
          return {
            isValid: false,
            message: '泰国手机号格式错误，应为9-10位数字，以6、8或9开头'
          }
        }
        break
        
      case '+60': // 马来西亚  
        // 马来西亚手机号：9-10位，以1开头
        if (!/^1\d{8,9}$/.test(phone)) {
          return {
            isValid: false,
            message: '马来西亚手机号格式错误，应为9-10位数字，以1开头'
          }
        }
        break
        
      default:
        return {
          isValid: false,
          message: '不支持的国家区号'
        }
    }

    return { isValid: true }
  }
}

export default UserController