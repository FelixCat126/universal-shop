import User from '../models/User.js'
import jwt from 'jsonwebtoken'
import { Op } from 'sequelize'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here'

class UserController {
  // 用户注册
  static async register(req, res) {
    try {
      const { nickname, country_code = '+86', phone, email, password, referral_code } = req.body

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

      // 验证手机号格式和长度
      const phoneRegex = /^[1-9]\d+$/
      if (!phoneRegex.test(phone)) {
        return res.status(400).json({
          success: false,
          message: '手机号必须为纯数字且不能以0开头'
        })
      }

      // 根据国家区号验证手机号长度
      let minLength
      let countryName
      switch (country_code) {
        case '+86':
          minLength = 11
          countryName = '中国'
          break
        case '+60':
          minLength = 9
          countryName = '马来西亚'
          break
        case '+66':
          minLength = 9
          countryName = '泰国'
          break
      }

      if (phone.length < minLength) {
        return res.status(400).json({
          success: false,
          message: `${countryName}手机号必须不少于${minLength}位数字`
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

      const { nickname, email } = req.body

      // 基本校验
      if (!nickname || nickname.length > 50) {
        return res.status(400).json({ success: false, message: '昵称不能为空且不超过50个字符' })
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
      await user.save()

      return res.json({ success: true, message: '资料更新成功', data: user.toSafeJSON() })
    } catch (error) {
      console.error('更新用户资料失败:', error)
      return res.status(500).json({ success: false, message: '更新失败', error: error.message })
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
        referral_code = ''
      } = req.query

      const limit = parseInt(pageSize)
      const offset = (parseInt(page) - 1) * limit

      // 构建查询条件
      const whereConditions = []
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
        attributes: ['id', 'username', 'email', 'phone', 'referral_code', 'created_at']
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
      console.log('🔍 createUserForOrder 开始执行:', {
        fullPhoneWithCode,
        contactName,
        referralCode
      })
      
      // 解析完整手机号中的国家区号和手机号
      let countryCode = '+86' // 默认值
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
      
      console.log('🔍 解析后的手机号信息:', {
        countryCode,
        phoneNumber
      })
      
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
      console.error('❌ createUserForOrder 执行失败:', error)
      throw error
    }
  }
  
  // 统一的用户创建核心逻辑
  static async _createUserCore(userData, isAutoRegister = false) {
    const { nickname, country_code, phone, password, email, referral_code } = userData
    
    // 验证手机号格式（纯数字，不能以0开头）
    const phoneRegex = /^[1-9]\d+$/
    if (!phoneRegex.test(phone)) {
      throw new Error('手机号必须为纯数字且不能以0开头')
    }
    
    // 根据国家区号验证手机号长度
    let minLength
    let countryName
    switch (country_code) {
      case '+86':
        minLength = 11
        countryName = '中国'
        break
      case '+60':
        minLength = 9
        countryName = '马来西亚'
        break
      case '+66':
        minLength = 9
        countryName = '泰国'
        break
    }
    
    if (phone.length < minLength) {
      throw new Error(`${countryName}手机号必须不少于${minLength}位数字`)
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
      console.log('🔍 记录推荐码:', {
        原始推荐码: referral_code,
        处理后推荐码: code,
        说明: '推荐码自由填写，无需验证存在性'
      })
    } else {
      console.log('🔍 未提供推荐码')
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
    
    console.log('🔍 准备创建用户:', finalUserData)
    
    const user = await User.create(finalUserData)
    
    console.log('✅ 用户创建成功:', {
      用户ID: user.id,
      昵称: user.nickname,
      手机号: user.phone,
      推荐码字段: user.referred_by_code,
      创建方式: isAutoRegister ? '自动注册' : '正常注册'
    })

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
}

export default UserController