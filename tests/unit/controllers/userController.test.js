import { describe, it, expect, beforeEach, vi } from 'vitest'
import UserController from '@server/controllers/userController.js'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('UserController 单元测试', () => {
  let sequelize
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
  })
  
  describe('_validatePhoneNumber 方法', () => {
    it('应该验证中国手机号', () => {
      const validChinesePhones = [
        '13800138001',
        '15912345678',
        '18611111111',
        '19988887777'
      ]
      
      validChinesePhones.forEach(phone => {
        const result = UserController._validatePhoneNumber(phone, '+86')
        expect(result.isValid).toBe(true)
        expect(result.message).toBeNull()
      })
    })
    
    it('应该拒绝无效的中国手机号', () => {
      const invalidChinesePhones = [
        '12345',           // 太短
        '12800138001',     // 第二位不是3-9
        '10800138001',     // 第二位不是3-9
        '138001380011',    // 太长
        '03800138001',     // 以0开头
        'abc00138001'      // 包含字母
      ]
      
      invalidChinesePhones.forEach(phone => {
        const result = UserController._validatePhoneNumber(phone, '+86')
        expect(result.isValid).toBe(false)
        expect(result.message).toContain('中国手机号格式错误')
      })
    })
    
    it('应该验证泰国手机号', () => {
      const validThaiPhones = [
        '661234567',    // 9位，以6开头
        '6612345678',   // 10位，以6开头
        '801234567',    // 9位，以8开头
        '8012345678',   // 10位，以8开头
        '901234567',    // 9位，以9开头
        '9012345678'    // 10位，以9开头
      ]
      
      validThaiPhones.forEach(phone => {
        const result = UserController._validatePhoneNumber(phone, '+66')
        expect(result.isValid).toBe(true)
        expect(result.message).toBeNull()
      })
    })
    
    it('应该拒绝无效的泰国手机号', () => {
      const invalidThaiPhones = [
        '12345',        // 太短
        '561234567',    // 不以6、8、9开头
        '701234567',    // 不以6、8、9开头
        '66123456789',  // 太长
        '12345678'      // 8位且不以6、8、9开头
      ]
      
      invalidThaiPhones.forEach(phone => {
        const result = UserController._validatePhoneNumber(phone, '+66')
        expect(result.isValid).toBe(false)
        expect(result.message).toContain('泰国手机号格式错误')
      })
    })
    
    it('应该验证马来西亚手机号', () => {
      const validMalaysianPhones = [
        '123456789',     // 9位，以1开头
        '1234567890',    // 10位，以1开头
        '187654321',     // 9位，以1开头
        '1987654321'     // 10位，以1开头
      ]
      
      validMalaysianPhones.forEach(phone => {
        const result = UserController._validatePhoneNumber(phone, '+60')
        expect(result.isValid).toBe(true)
        expect(result.message).toBeNull()
      })
    })
    
    it('应该拒绝不支持的国家区号', () => {
      const unsupportedCodes = ['+1', '+44', '+81', '+91', '+33']
      
      unsupportedCodes.forEach(code => {
        const result = UserController._validatePhoneNumber('1234567890', code)
        expect(result.isValid).toBe(false)
        expect(result.message).toContain('不支持的国家区号')
      })
    })
    
    it('应该处理边界情况', () => {
      // 空值测试
      let result = UserController._validatePhoneNumber('', '+86')
      expect(result.isValid).toBe(false)
      
      result = UserController._validatePhoneNumber(null, '+86')
      expect(result.isValid).toBe(false)
      
      result = UserController._validatePhoneNumber(undefined, '+86')
      expect(result.isValid).toBe(false)
      
      // 空国家区号
      result = UserController._validatePhoneNumber('13800138001', '')
      expect(result.isValid).toBe(false)
      
      result = UserController._validatePhoneNumber('13800138001', null)
      expect(result.isValid).toBe(false)
    })
    
    it('应该拒绝包含特殊字符的手机号', () => {
      const specialCharPhones = [
        '138-0013-8001',  // 包含连字符
        '138 0013 8001',  // 包含空格
        '138.0013.8001',  // 包含点号
        '(138)0013-8001', // 包含括号
        '+8613800138001'  // 包含加号
      ]
      
      specialCharPhones.forEach(phone => {
        const result = UserController._validatePhoneNumber(phone, '+86')
        expect(result.isValid).toBe(false)
        expect(result.message).toContain('手机号必须为纯数字')
      })
    })
  })
  
  describe('_createUserCore 方法', () => {
    it('应该创建基本用户', async () => {
      const userData = await TestDataFactory.createUser()
      
      const result = await UserController._createUserCore(userData)
      
      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(result.email).toBe(userData.email)
      expect(result.phone).toBe(userData.phone)
      expect(result.password).not.toBe(userData.password) // 应该被加密
    })
    
    it('应该处理推荐码', async () => {
      const userData = await TestDataFactory.createUser({
        referral_code: 'FRIEND2024'
      })
      
      const result = await UserController._createUserCore(userData)
      
      expect(result.referral_from).toBe('FRIEND2024')
    })
    
    it('应该生成用户自己的推荐码', async () => {
      const userData = await TestDataFactory.createUser()
      delete userData.referral_code // 让系统自动生成
      
      const result = await UserController._createUserCore(userData)
      
      expect(result.referral_code).toBeDefined()
      expect(result.referral_code).toHaveLength(8)
      expect(/^[A-Z0-9]{8}$/.test(result.referral_code)).toBe(true)
    })
    
    it('应该验证手机号格式', async () => {
      const userData = await TestDataFactory.createUser({
        phone: '123', // 无效手机号
        country_code: '+86'
      })
      
      await expect(UserController._createUserCore(userData))
        .rejects.toThrow(/手机号格式错误/)
    })
    
    it('应该检查邮箱唯一性', async () => {
      const { User } = sequelize.models
      const userData1 = await TestDataFactory.createUser()
      await User.create(userData1)
      
      const userData2 = await TestDataFactory.createUser({
        email: userData1.email, // 重复邮箱
        phone: '13900139001'
      })
      
      await expect(UserController._createUserCore(userData2))
        .rejects.toThrow(/该邮箱已被注册/)
    })
    
    it('应该检查手机号唯一性', async () => {
      const { User } = sequelize.models
      const userData1 = await TestDataFactory.createUser()
      await User.create(userData1)
      
      const userData2 = await TestDataFactory.createUser({
        country_code: userData1.country_code,
        phone: userData1.phone, // 重复手机号
        email: 'different@example.com'
      })
      
      await expect(UserController._createUserCore(userData2))
        .rejects.toThrow(/已被注册/)
    })
  })
  
  describe('register 方法', () => {
    let req, res
    
    beforeEach(() => {
      req = {
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该成功注册用户', async () => {
      const userData = await TestDataFactory.createUser()
      req.body = userData
      
      await UserController.register(req, res)
      
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '注册成功',
        data: expect.objectContaining({
          user: expect.objectContaining({
            email: userData.email,
            phone: userData.phone
          }),
          token: expect.any(String)
        })
      })
    })
    
    it('应该验证必填字段', async () => {
      req.body = {
        nickname: '测试用户'
        // 缺少其他必填字段
      }
      
      await UserController.register(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('必填项')
      })
    })
    
    it('应该处理数据库错误', async () => {
      // 模拟数据库错误
      vi.spyOn(UserController, '_createUserCore').mockRejectedValue(
        new Error('数据库连接失败')
      )
      
      const userData = await TestDataFactory.createUser()
      req.body = userData
      
      await UserController.register(req, res)
      
      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('注册失败')
      })
    })
  })
  
  describe('login 方法', () => {
    let req, res, testUser
    
    beforeEach(async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      req = {
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该成功登录（使用手机号）', async () => {
      req.body = {
        country_code: testUser.country_code,
        phone: testUser.phone,
        password: 'Abcd1234'
      }
      
      await UserController.login(req, res)
      
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '登录成功',
        data: expect.objectContaining({
          user: expect.objectContaining({
            id: testUser.id,
            email: testUser.email
          }),
          token: expect.any(String)
        })
      })
    })
    
    it('应该成功登录（使用邮箱）', async () => {
      req.body = {
        email: testUser.email,
        password: 'Abcd1234'
      }
      
      await UserController.login(req, res)
      
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '登录成功',
        data: expect.objectContaining({
          user: expect.objectContaining({
            id: testUser.id
          }),
          token: expect.any(String)
        })
      })
    })
    
    it('应该拒绝错误的密码', async () => {
      req.body = {
        country_code: testUser.country_code,
        phone: testUser.phone,
        password: 'wrongpassword'
      }
      
      await UserController.login(req, res)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '用户名或密码错误'
      })
    })
    
    it('应该拒绝不存在的用户', async () => {
      req.body = {
        country_code: '+86',
        phone: '19999999999',
        password: 'Abcd1234'
      }
      
      await UserController.login(req, res)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '用户名或密码错误'
      })
    })
    
    it('应该拒绝被禁用的用户', async () => {
      await testUser.update({ is_active: false })
      
      req.body = {
        country_code: testUser.country_code,
        phone: testUser.phone,
        password: 'Abcd1234'
      }
      
      await UserController.login(req, res)
      
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '账户已被禁用，请联系管理员'
      })
    })
    
    it('应该验证登录参数', async () => {
      req.body = {
        // 缺少必要的登录参数
      }
      
      await UserController.login(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '请提供手机号或邮箱进行登录'
      })
    })
    
    it('应该更新最后登录时间', async () => {
      const originalLoginTime = testUser.last_login_at
      
      req.body = {
        country_code: testUser.country_code,
        phone: testUser.phone,
        password: 'Abcd1234'
      }
      
      await UserController.login(req, res)
      
      await testUser.reload()
      if (testUser.last_login_at) {
        expect(testUser.last_login_at.getTime()).toBeGreaterThan(
          originalLoginTime ? originalLoginTime.getTime() : 0
        )
      }
    })
  })
  
  describe('verifyToken 方法', () => {
    let req, res, testUser
    
    beforeEach(async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      req = {
        user: testUser
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回用户信息', async () => {
      await UserController.verifyToken(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Token验证成功',
        data: {
          user: expect.objectContaining({
            id: testUser.id,
            email: testUser.email
          })
        }
      })
    })
    
    it('应该处理用户不存在的情况', async () => {
      req.user = null
      
      await UserController.verifyToken(req, res)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '用户不存在'
      })
    })
  })
  
  describe('getProfile 方法', () => {
    let req, res, testUser
    
    beforeEach(async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      req = {
        user: testUser
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回用户资料', async () => {
      await UserController.getProfile(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: testUser.id,
          email: testUser.email,
          nickname: testUser.nickname
        })
      })
    })
    
    it('返回的用户资料不应包含密码', async () => {
      await UserController.getProfile(req, res)
      
      const callArgs = res.json.mock.calls[0][0]
      expect(callArgs.data.password).toBeUndefined()
    })
  })
  
  describe('createUserForOrder 方法', () => {
    it('应该为订单创建用户', async () => {
      const userData = await TestDataFactory.createUser()
      
      const result = await UserController.createUserForOrder(userData)
      
      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(result.email).toBe(userData.email)
      expect(result.phone).toBe(userData.phone)
    })
    
    it('应该处理推荐码', async () => {
      const userData = await TestDataFactory.createUser({
        referral_code: 'ORDER2024'
      })
      
      const result = await UserController.createUserForOrder(userData)
      
      expect(result.referral_from).toBe('ORDER2024')
    })
    
    it('应该处理创建错误', async () => {
      const userData = await TestDataFactory.createUser({
        phone: '123', // 无效手机号
        country_code: '+86'
      })
      
      await expect(UserController.createUserForOrder(userData))
        .rejects.toThrow()
    })
  })
})
