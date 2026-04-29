import User from '../models/User.js'
import jwt from 'jsonwebtoken'
import { Op } from 'sequelize'
import Order from '../models/Order.js'
import { JWT_SECRET } from '../config/jwtSecret.js'
import * as pointsService from '../services/pointsService.js'
import { assertPasswordPolicy } from '../utils/passwordPolicy.js'

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
        { userId: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: '7d' }
      )

      res.status(201).json({
        success: true,
        message: '注册成功',
        data: {
          user: user.toSafeJSON(),
          token
        }
      })
    } catch (error) {
      console.error('用户注册失败:', error)
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
      console.error('更新用户资料失败:', error)
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
      console.error('修改密码失败:', error)
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
        return res.status(401).json({
          success: false,
          message: '用户名或密码错误'
        })
      }

      // 检查用户是否被禁用
      if (!user.is_active) {
        return res.status(403).json({
          success: false,
          message: '账户已被禁用，请联系管理员'
        })
      }

      // 验证密码
      const isValidPassword = await user.validatePassword(password)
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: '用户名或密码错误'
        })
      }

      // 更新最后登录时间
      user.last_login_at = new Date()
      await user.save()

      // 生成JWT token
      const token = jwt.sign(
        { userId: user.id, username: user.username },
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
      console.error('用户登录失败:', error)
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
        page = 1, 
        pageSize = 10, 
        email = '',
        phone = '',
        referral_code = '',
        name = '',
        id: userIdParam = ''
      } = req.query

      const limit = parseInt(pageSize)
      const offset = (parseInt(page) - 1) * limit

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

      const totalPages = Math.ceil(count / limit)

      res.json({
        success: true,
        data: {
          users: rows,
          pagination: {
            currentPage: parseInt(page),
            pageSize: limit,
            totalPages,
            total: count
          }
        }
      })
    } catch (error) {
      console.error('获取用户列表失败:', error)
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
      console.error('验证推荐码失败:', error)
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
      console.error('Token验证失败:', error)
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
      console.error('获取用户信息失败:', error)
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
      console.error('用户登出失败:', error)
      res.status(500).json({
        success: false,
        message: '登出失败',
        error: error.message
      })
    }
  }

  // 统一的用户创建服务方法（用于订单自动注册）
  static async createUserForOrder(fullPhoneWithCode, contactName, referralCode = null) {
    try {
      // 解析完整手机号中的国家区号和手机号
      let countryCode = '+66' // 默认值
      let phoneNumber = fullPhoneWithCode
      
      // 检查是否包含国家区号并解析
      const supportedCodes = ['+86', '+66', '+60']
      for (const code of supportedCodes) {
        if (fullPhoneWithCode.startsWith(code)) {
          countryCode = code
          phoneNumber = fullPhoneWithCode.substring(code.length)
          break
        }
      }
      
      // 生成默认密码（手机号后8位）
      const defaultPassword = phoneNumber.slice(-8)
      
      // 调用统一的用户创建核心逻辑
      return await UserController._createUserCore({
        nickname: contactName || `用户${phoneNumber.slice(-4)}`,
        country_code: countryCode,
        phone: phoneNumber,
        password: defaultPassword,
        email: null,
        referral_code: referralCode
      }, true) // true表示是自动注册
      
    } catch (error) {
      console.error('createUserForOrder 执行失败:', error)
      throw error
    }
  }
  
  // 统一的用户创建核心逻辑
  static async _createUserCore(userData, isAutoRegister = false) {
    const { nickname, country_code, phone, password, email, referral_code } = userData
    
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
    
    // 创建用户
    const finalUserData = {
      username: isAutoRegister ? phone : `${country_code}${phone}`, // 自动注册时用户名不含区号，正常注册含区号
      nickname,
      email: email || null,
      country_code,
      phone,
      password,
      referred_by_code: validReferralCode
    }
    
    const user = await User.create(finalUserData)

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
      console.error('检查手机号失败:', error)
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
      console.error('更新用户状态失败:', error)
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
      console.error('获取个人中心统计失败:', error)
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