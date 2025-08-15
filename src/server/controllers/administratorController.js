import { Op } from 'sequelize'
import jwt from 'jsonwebtoken'
import Administrator from '../models/Administrator.js'
import OperationLog from '../models/OperationLog.js'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here'

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

      // 查找管理员
      const admin = await Administrator.findOne({
        where: {
          [Op.or]: [
            { username },
            { email: username }
          ],
          is_active: true
        }
      })

      if (!admin) {
        return res.status(401).json({
          success: false,
          message: '用户名或密码错误'
        })
      }

      // 验证密码
      const isValidPassword = await admin.validatePassword(password)
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: '用户名或密码错误'
        })
      }

      // 更新最后登录时间
      admin.last_login_at = new Date()
      await admin.save()

      // 生成JWT token
      const token = jwt.sign(
        { 
          adminId: admin.id, 
          username: admin.username, 
          role: admin.role,
          type: 'admin' // 标识这是管理员token
        },
        JWT_SECRET,
        { expiresIn: '8h' } // 管理员token有效期8小时
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
          token
        }
      })
    } catch (error) {
      console.error('管理员登录失败:', error)
      res.status(500).json({
        success: false,
        message: '登录失败',
        error: error.message
      })
    }
  }

  // 获取所有管理员
  static async getAllAdministrators(req, res) {
    try {
      const { page = 1, limit = 20, role, keyword } = req.query
      const offset = (page - 1) * limit

      const where = {}
      if (role) {
        where.role = role
      }
      if (keyword) {
        where[Op.or] = [
          { username: { [Op.like]: `%${keyword}%` } },
          { real_name: { [Op.like]: `%${keyword}%` } },
          { email: { [Op.like]: `%${keyword}%` } }
        ]
      }

      const { count, rows } = await Administrator.findAndCountAll({
        where,
        limit: parseInt(limit),
        offset,
        order: [['created_at', 'DESC']],
        attributes: { exclude: ['password'] }
      })

      res.json({
        success: true,
        data: {
          administrators: rows,
          total: count,
          page: parseInt(page),
          totalPages: Math.ceil(count / limit)
        }
      })
    } catch (error) {
      console.error('获取管理员列表失败:', error)
      res.status(500).json({
        success: false,
        message: '获取管理员列表失败',
        error: error.message
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
            ...(email ? [{ email }] : [])
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
        email,
        password,
        role: role || 'operator',
        real_name,
        phone,
        created_by: currentAdmin.id
      })

      // 记录操作日志
      await OperationLog.logOperation({
        adminId: currentAdmin.id,
        adminUsername: currentAdmin.username,
        action: 'create_administrator',
        resource: 'administrator',
        resourceId: newAdmin.id,
        description: `创建管理员: ${username} (${role || 'operator'})`,
        newData: newAdmin.toSafeJSON(),
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      })

      res.status(201).json({
        success: true,
        message: '管理员创建成功',
        data: newAdmin.toSafeJSON()
      })
    } catch (error) {
      console.error('创建管理员失败:', error)
      res.status(500).json({
        success: false,
        message: '创建管理员失败',
        error: error.message
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

      if (email !== undefined) admin.email = email
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

      // 记录操作日志
      await OperationLog.logOperation({
        adminId: currentAdmin.id,
        adminUsername: currentAdmin.username,
        action: 'update_administrator',
        resource: 'administrator',
        resourceId: admin.id,
        description: `更新管理员: ${admin.username}`,
        oldData,
        newData: admin.toSafeJSON(),
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      })

      res.json({
        success: true,
        message: '管理员更新成功',
        data: admin.toSafeJSON()
      })
    } catch (error) {
      console.error('更新管理员失败:', error)
      res.status(500).json({
        success: false,
        message: '更新管理员失败',
        error: error.message
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

      // 记录操作日志
      await OperationLog.logOperation({
        adminId: currentAdmin.id,
        adminUsername: currentAdmin.username,
        action: 'delete_administrator',
        resource: 'administrator',
        resourceId: admin.id,
        description: `删除管理员: ${admin.username}`,
        oldData,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      })

      res.json({
        success: true,
        message: '管理员删除成功'
      })
    } catch (error) {
      console.error('删除管理员失败:', error)
      res.status(500).json({
        success: false,
        message: '删除管理员失败',
        error: error.message
      })
    }
  }

  // 重置密码
  static async resetPassword(req, res) {
    try {
      const { id } = req.params
      const { password } = req.body
      const currentAdmin = req.admin

      if (!password || password.length < 6) {
        return res.status(400).json({
          success: false,
          message: '密码至少6个字符'
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
      await admin.save()

      // 记录操作日志
      await OperationLog.logOperation({
        adminId: currentAdmin.id,
        adminUsername: currentAdmin.username,
        action: 'reset_password',
        resource: 'administrator',
        resourceId: admin.id,
        description: `重置管理员密码: ${admin.username}`,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      })

      res.json({
        success: true,
        message: '密码重置成功'
      })
    } catch (error) {
      console.error('重置密码失败:', error)
      res.status(500).json({
        success: false,
        message: '重置密码失败',
        error: error.message
      })
    }
  }

  // 获取操作日志
  static async getOperationLogs(req, res) {
    try {
      const { page = 1, limit = 50, admin_id, action, resource, start_date, end_date } = req.query
      const offset = (page - 1) * limit

      const where = {}
      if (admin_id) where.admin_id = admin_id
      if (action) where.action = { [Op.like]: `%${action}%` }
      if (resource) where.resource = resource
      if (start_date && end_date) {
        where.created_at = {
          [Op.between]: [new Date(start_date), new Date(end_date)]
        }
      }

      const { count, rows } = await OperationLog.findAndCountAll({
        where,
        limit: parseInt(limit),
        offset,
        order: [['created_at', 'DESC']]
      })

      res.json({
        success: true,
        data: {
          logs: rows,
          total: count,
          page: parseInt(page),
          totalPages: Math.ceil(count / limit)
        }
      })
    } catch (error) {
      console.error('获取操作日志失败:', error)
      res.status(500).json({
        success: false,
        message: '获取操作日志失败',
        error: error.message
      })
    }
  }

  // 初始化超级管理员（仅在没有任何管理员时可用）
  static async initSuperAdmin(req, res) {
    try {
      // 检查是否已存在管理员
      const existingAdmin = await Administrator.findOne()
      if (existingAdmin) {
        return res.status(400).json({
          success: false,
          message: '系统已初始化，不能重复创建超级管理员'
        })
      }

      // 创建默认超级管理员
      const superAdmin = await Administrator.create({
        username: 'admin',
        password: 'admin123',
        role: 'super_admin',
        real_name: '超级管理员',
        is_active: true
      })

      res.json({
        success: true,
        message: '超级管理员初始化成功',
        data: {
          username: 'admin',
          password: 'admin123',
          message: '请立即登录并修改密码'
        }
      })
    } catch (error) {
      console.error('初始化超级管理员失败:', error)
      res.status(500).json({
        success: false,
        message: '初始化失败',
        error: error.message
      })
    }
  }
}

export default AdministratorController
