import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

describe('用户认证 API', () => {
  let sequelize
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
  })
  
  describe('POST /api/users/register', () => {
    it('应该成功注册新用户', async () => {
      const userData = {
        nickname: '测试用户',
        country_code: '+86',
        phone: TestHelpers.generatePhoneNumber('+86'),
        email: TestHelpers.generateEmail(),
        password: '123456'
      }
      
      const response = await request(app)
        .post('/api/users/register')
        .send(userData)
        .expect(201)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.user.email).toBe(userData.email)
      expect(response.body.data.user.nickname).toBe(userData.nickname)
      expect(response.body.data.token).toBeDefined()
      expect(response.body.data.user.password).toBeUndefined() // 密码不应该返回
      
      // 验证数据库中确实创建了用户
      const { User } = sequelize.models
      const user = await User.findOne({ where: { email: userData.email } })
      expect(user).toBeTruthy()
      expect(user.nickname).toBe(userData.nickname)
      expect(user.referral_code).toBeTruthy() // 应该自动生成推荐码
    })
    
    it('应该拒绝重复的手机号注册', async () => {
      // 先创建一个用户
      const { User } = sequelize.models
      const existingUserData = await TestDataFactory.createUser()
      await User.create(existingUserData)
      
      // 尝试用相同手机号注册
      const duplicateData = {
        nickname: '另一个用户',
        country_code: existingUserData.country_code,
        phone: existingUserData.phone,
        email: TestHelpers.generateEmail(),
        password: '123456'
      }
      
      const response = await request(app)
        .post('/api/users/register')
        .send(duplicateData)
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('已被注册')
    })
    
    it('应该拒绝重复的邮箱注册', async () => {
      // 先创建一个用户
      const { User } = sequelize.models
      const existingUserData = await TestDataFactory.createUser()
      await User.create(existingUserData)
      
      // 尝试用相同邮箱注册
      const duplicateData = {
        nickname: '另一个用户',
        country_code: '+86',
        phone: TestHelpers.generatePhoneNumber('+86'),
        email: existingUserData.email,
        password: '123456'
      }
      
      const response = await request(app)
        .post('/api/users/register')
        .send(duplicateData)
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('该邮箱已被注册')
    })
    
    it('应该验证手机号格式 - 中国手机号', async () => {
      const userData = {
        nickname: '测试用户',
        country_code: '+86',
        phone: '123', // 无效的中国手机号
        email: TestHelpers.generateEmail(),
        password: '123456'
      }
      
      const response = await request(app)
        .post('/api/users/register')
        .send(userData)
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('手机号格式错误')
    })
    
    it('应该验证手机号格式 - 泰国手机号', async () => {
      const userData = {
        nickname: '测试用户',
        country_code: '+66',
        phone: '123', // 无效的泰国手机号
        email: TestHelpers.generateEmail(),
        password: '123456'
      }
      
      const response = await request(app)
        .post('/api/users/register')
        .send(userData)
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('泰国手机号格式错误')
    })
    
    it('应该验证必填字段', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .send({
          nickname: '测试用户'
          // 缺少必填字段
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('必填项')
    })
    
    it('应该支持推荐码注册', async () => {
      const userData = {
        nickname: '测试用户',
        country_code: '+86',
        phone: TestHelpers.generatePhoneNumber('+86'),
        email: TestHelpers.generateEmail(),
        password: '123456',
        referral_code: 'TEST1234'
      }
      
      const response = await request(app)
        .post('/api/users/register')
        .send(userData)
        .expect(201)
      
      expect(response.body.success).toBe(true)
      
      // 验证推荐码被正确保存
      const { User } = sequelize.models
      const user = await User.findOne({ where: { email: userData.email } })
      expect(user.referral_from).toBe('TEST1234')
    })
  })
  
  describe('POST /api/users/login', () => {
    let testUser
    
    beforeEach(async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
    })
    
    it('应该成功登录（使用国家区号+手机号）', async () => {
      const response = await request(app)
        .post('/api/users/login')
        .send({
          country_code: testUser.country_code,
          phone: testUser.phone,
          password: '123456'
        })
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.token).toBeDefined()
      expect(response.body.data.user.id).toBe(testUser.id)
      expect(response.body.data.user.password).toBeUndefined() // 密码不应该返回
      
      // 验证最后登录时间被更新
      await testUser.reload()
      expect(testUser.last_login_at).toBeTruthy()
    })
    
    it('应该成功登录（使用邮箱）', async () => {
      const response = await request(app)
        .post('/api/users/login')
        .send({
          email: testUser.email,
          password: '123456'
        })
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.token).toBeDefined()
      expect(response.body.data.user.id).toBe(testUser.id)
    })
    
    it('应该拒绝错误的密码', async () => {
      const response = await request(app)
        .post('/api/users/login')
        .send({
          country_code: testUser.country_code,
          phone: testUser.phone,
          password: 'wrongpassword'
        })
        .expect(401)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('用户名或密码错误')
    })
    
    it('应该拒绝不存在的用户', async () => {
      const response = await request(app)
        .post('/api/users/login')
        .send({
          country_code: '+86',
          phone: '19999999999',
          password: '123456'
        })
        .expect(401)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('用户名或密码错误')
    })
    
    it('应该拒绝被禁用的用户', async () => {
      // 禁用用户
      await testUser.update({ is_active: false })
      
      const response = await request(app)
        .post('/api/users/login')
        .send({
          country_code: testUser.country_code,
          phone: testUser.phone,
          password: '123456'
        })
        .expect(403)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('账户已被禁用')
    })
  })
  
  describe('GET /api/users/verify', () => {
    let testUser, authToken
    
    beforeEach(async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
    })
    
    it('应该验证有效的token', async () => {
      const response = await request(app)
        .get('/api/users/verify')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.user.id).toBe(testUser.id)
    })
    
    it('应该拒绝无效的token', async () => {
      const response = await request(app)
        .get('/api/users/verify')
        .set('Authorization', 'Bearer invalidtoken')
        .expect(403)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('无效的认证令牌')
    })
    
    it('应该拒绝缺少token的请求', async () => {
      const response = await request(app)
        .get('/api/users/verify')
        .expect(401)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('缺少认证令牌')
    })
    
    it('应该拒绝已被禁用用户的token', async () => {
      // 禁用用户
      await testUser.update({ is_active: false })
      
      const response = await request(app)
        .get('/api/users/verify')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('账户已被禁用')
    })
  })
  
  describe('GET /api/users/profile', () => {
    let testUser, authToken
    
    beforeEach(async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
    })
    
    it('应该返回用户资料', async () => {
      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBe(testUser.id)
      expect(response.body.data.email).toBe(testUser.email)
      expect(response.body.data.password).toBeUndefined() // 密码不应该返回
    })
    
    it('应该拒绝未认证的请求', async () => {
      const response = await request(app)
        .get('/api/users/profile')
        .expect(401)
      
      expect(response.body.success).toBe(false)
    })
  })
})
