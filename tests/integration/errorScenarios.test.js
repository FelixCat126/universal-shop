import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

describe('API错误场景集成测试', () => {
  let sequelize
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
  })
  
  describe('认证和授权错误', () => {
    it('应该处理缺少token的请求', async () => {
      const response = await request(app)
        .get('/api/users/profile')
        .expect(401)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('缺少认证令牌')
      expect(response.body.timestamp).toBeDefined()
    })
    
    it('应该处理无效token', async () => {
      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', 'Bearer invalidtoken')
        .expect(403)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('无效的认证令牌')
    })
    
    it('应该处理过期token', async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      // 创建已过期的token (过期时间设为1ms前)
      const expiredToken = TestHelpers.generateToken(user, '-1ms')
      
      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('认证令牌已过期')
    })
    
    it('应该处理被禁用用户的token', async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser({ is_active: false })
      const user = await User.create(userData)
      const token = TestHelpers.generateToken(user)
      
      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(403)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('账户已被禁用')
    })
  })
  
  describe('数据验证错误', () => {
    it('应该处理必填字段缺失', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .send({
          nickname: '测试用户'
          // 缺少其他必填字段
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toBeDefined()
      expect(response.body.timestamp).toBeDefined()
    })
    
    it('应该处理无效的JSON格式', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('请求数据格式错误')
      expect(response.body.code).toBe('INVALID_JSON')
    })
    
    it('应该处理邮箱格式错误', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .send({
          nickname: '测试用户',
          country_code: '+86',
          phone: TestHelpers.generatePhoneNumber('+86'),
          email: 'invalid-email-format',
          password: '123456'
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('格式')
    })
    
    it('应该处理手机号格式错误', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .send({
          nickname: '测试用户',
          country_code: '+86',
          phone: '123', // 无效的手机号
          email: TestHelpers.generateEmail(),
          password: '123456'
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('手机号格式错误')
    })
  })
  
  describe('数据库约束错误', () => {
    it('应该处理重复邮箱注册', async () => {
      const { User } = sequelize.models
      
      // 先创建一个用户
      const existingUserData = await TestDataFactory.createUser()
      await User.create(existingUserData)
      
      // 尝试用相同邮箱注册
      const response = await request(app)
        .post('/api/users/register')
        .send({
          nickname: '另一个用户',
          country_code: '+86',
          phone: TestHelpers.generatePhoneNumber('+86'),
          email: existingUserData.email, // 重复邮箱
          password: '123456'
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('该邮箱已被注册')
    })
    
    it('应该处理重复手机号注册', async () => {
      const { User } = sequelize.models
      
      // 先创建一个用户
      const existingUserData = await TestDataFactory.createUser()
      await User.create(existingUserData)
      
      // 尝试用相同手机号注册
      const response = await request(app)
        .post('/api/users/register')
        .send({
          nickname: '另一个用户',
          country_code: existingUserData.country_code,
          phone: existingUserData.phone, // 重复手机号
          email: TestHelpers.generateEmail(),
          password: '123456'
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('已被注册')
    })
    
    it('应该处理外键约束错误', async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      const token = TestHelpers.generateToken(user)
      
      const response = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [{
            product_id: 99999, // 不存在的商品ID
            quantity: 1
          }],
          contact_name: '测试收货人',
          contact_phone: '13800138001',
          delivery_address: '测试地址'
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toBeDefined()
    })
  })
  
  describe('业务逻辑错误', () => {
    it('应该处理库存不足', async () => {
      const { User, Product } = sequelize.models
      
      // 创建用户和商品
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      const token = TestHelpers.generateToken(user)
      
      const productData = TestDataFactory.createProduct({ stock: 5 })
      const product = await Product.create(productData)
      
      const response = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [{
            product_id: product.id,
            quantity: 10 // 超过库存
          }],
          contact_name: '测试收货人',
          contact_phone: '13800138001',
          delivery_address: '测试地址'
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('库存不足')
    })
    
    it('应该处理登录失败（错误密码）', async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      const response = await request(app)
        .post('/api/users/login')
        .send({
          country_code: user.country_code,
          phone: user.phone,
          password: 'wrongpassword'
        })
        .expect(401)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('用户名或密码错误')
    })
    
    it('应该处理登录失败（用户不存在）', async () => {
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
  })
  
  describe('404错误', () => {
    it('应该处理不存在的API路径', async () => {
      const response = await request(app)
        .get('/api/nonexistent')
        .expect(404)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('/api/nonexistent 不存在')
      expect(response.body.code).toBe('NOT_FOUND')
    })
    
    it('应该处理不存在的资源ID', async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      const token = TestHelpers.generateToken(user)
      
      const response = await request(app)
        .get('/api/orders/99999')
        .set('Authorization', `Bearer ${token}`)
        .expect(404)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('订单不存在')
    })
  })
  
  describe('方法不允许错误', () => {
    it('应该处理错误的HTTP方法', async () => {
      const response = await request(app)
        .patch('/api/users/login') // 错误的HTTP方法
        .send({})
        .expect(404)
      
      expect(response.body.success).toBe(false)
    })
  })
  
  describe('Content-Type错误', () => {
    it('应该处理错误的Content-Type', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .set('Content-Type', 'text/plain')
        .send('plain text data')
        .expect(400)
      
      expect(response.body.success).toBe(false)
    })
  })
  
  describe('响应格式一致性检查', () => {
    it('所有错误响应应该具有统一格式', async () => {
      const testCases = [
        { method: 'get', path: '/api/users/profile', expectedStatus: 401 },
        { method: 'get', path: '/api/nonexistent', expectedStatus: 404 },
        { method: 'post', path: '/api/users/register', data: {}, expectedStatus: 400 }
      ]
      
      for (const testCase of testCases) {
        const req = request(app)[testCase.method](testCase.path)
        
        if (testCase.data) {
          req.send(testCase.data)
        }
        
        const response = await req.expect(testCase.expectedStatus)
        
        // 验证响应格式
        expect(response.body).toHaveProperty('success', false)
        expect(response.body).toHaveProperty('message')
        expect(response.body).toHaveProperty('timestamp')
        expect(typeof response.body.timestamp).toBe('string')
        
        // 验证时间戳格式
        expect(() => new Date(response.body.timestamp)).not.toThrow()
      }
    })
  })
})
