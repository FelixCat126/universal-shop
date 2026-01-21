import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

describe('地址管理 API', () => {
  let sequelize
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
  })
  
  describe('GET /api/addresses - 获取用户地址列表', () => {
    let testUser, authToken, testAddresses
    
    beforeEach(async () => {
      const { User, Address } = sequelize.models
      
      // 创建测试用户
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
      
      // 创建测试地址
      testAddresses = []
      for (let i = 0; i < 3; i++) {
        const addressData = TestDataFactory.createAddress(testUser.id, {
          contact_name: `收货人${i + 1}`,
          is_default: i === 0 // 第一个设为默认
        })
        const address = await Address.create(addressData)
        testAddresses.push(address)
      }
    })
    
    it('应该返回用户的所有地址', async () => {
      const response = await request(app)
        .get('/api/addresses')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.addresses).toHaveLength(3)
      
      // 验证地址属于当前用户
      response.body.data.addresses.forEach(address => {
        expect(address.user_id).toBe(testUser.id)
      })
    })
    
    it('应该按默认地址优先排序', async () => {
      const response = await request(app)
        .get('/api/addresses')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.addresses[0].is_default).toBe(true)
    })
    
    it('应该返回空列表（新用户）', async () => {
      // 创建新用户
      const { User } = sequelize.models
      const newUserData = await TestDataFactory.createUser({
        phone: '13900139001',
        email: 'newuser@example.com'
      })
      const newUser = await User.create(newUserData)
      const newToken = TestHelpers.generateToken(newUser)
      
      const response = await request(app)
        .get('/api/addresses')
        .set('Authorization', `Bearer ${newToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.addresses).toHaveLength(0)
    })
    
    it('应该拒绝未认证的请求', async () => {
      const response = await request(app)
        .get('/api/addresses')
        .expect(401)
      
      expect(response.body.success).toBe(false)
    })
  })
  
  describe('POST /api/addresses - 创建新地址', () => {
    let testUser, authToken
    
    beforeEach(async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
    })
    
    it('应该成功创建新地址', async () => {
      const addressData = {
        province: '北京市',
        city: '北京市',
        district: '朝阳区',
        detail_address: '测试街道123号',
        postal_code: '100000',
        contact_name: '张三',
        contact_phone: '13800138001',
        is_default: false
      }
      
      const response = await request(app)
        .post('/api/addresses')
        .set('Authorization', `Bearer ${authToken}`)
        .send(addressData)
        .expect(201)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBeDefined()
      expect(response.body.data.province).toBe(addressData.province)
      expect(response.body.data.contact_name).toBe(addressData.contact_name)
      expect(response.body.data.user_id).toBe(testUser.id)
      
      // 验证数据库中的记录
      const { Address } = sequelize.models
      const savedAddress = await Address.findByPk(response.body.data.id)
      expect(savedAddress.province).toBe(addressData.province)
    })
    
    it('应该自动设置为默认地址（如果是用户第一个地址）', async () => {
      const addressData = TestDataFactory.createAddress(testUser.id, {
        is_default: false // 明确设置为非默认
      })
      delete addressData.user_id // 移除user_id，由后端自动设置
      
      const response = await request(app)
        .post('/api/addresses')
        .set('Authorization', `Bearer ${authToken}`)
        .send(addressData)
        .expect(201)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.is_default).toBe(true) // 自动设为默认
    })
    
    it('应该正确处理默认地址设置', async () => {
      const { Address } = sequelize.models
      
      // 先创建一个默认地址
      const firstAddress = await Address.create(
        TestDataFactory.createAddress(testUser.id, { is_default: true })
      )
      
      // 创建新的默认地址
      const newDefaultData = TestDataFactory.createAddress(testUser.id, {
        is_default: true,
        contact_name: '新默认地址'
      })
      delete newDefaultData.user_id
      
      const response = await request(app)
        .post('/api/addresses')
        .set('Authorization', `Bearer ${authToken}`)
        .send(newDefaultData)
        .expect(201)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.is_default).toBe(true)
      
      // 验证原默认地址被取消
      await firstAddress.reload()
      expect(firstAddress.is_default).toBe(false)
    })
    
    it('应该验证必填字段', async () => {
      const incompleteData = {
        province: '北京市',
        city: '北京市'
        // 缺少其他必填字段
      }
      
      const response = await request(app)
        .post('/api/addresses')
        .set('Authorization', `Bearer ${authToken}`)
        .send(incompleteData)
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('必填')
    })
    
    it('应该验证手机号格式', async () => {
      const addressData = TestDataFactory.createAddress(testUser.id, {
        contact_phone: '123' // 无效手机号
      })
      delete addressData.user_id
      
      const response = await request(app)
        .post('/api/addresses')
        .set('Authorization', `Bearer ${authToken}`)
        .send(addressData)
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('手机号格式')
    })
    
    it('应该验证邮编格式', async () => {
      const addressData = TestDataFactory.createAddress(testUser.id, {
        postal_code: '123' // 无效邮编
      })
      delete addressData.user_id
      
      const response = await request(app)
        .post('/api/addresses')
        .set('Authorization', `Bearer ${authToken}`)
        .send(addressData)
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('邮编格式')
    })
  })
  
  describe('GET /api/addresses/:id - 获取地址详情', () => {
    let testUser, testAddress, authToken
    
    beforeEach(async () => {
      const { User, Address } = sequelize.models
      
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
      
      const addressData = TestDataFactory.createAddress(testUser.id)
      testAddress = await Address.create(addressData)
    })
    
    it('应该返回指定地址的详情', async () => {
      const response = await request(app)
        .get(`/api/addresses/${testAddress.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBe(testAddress.id)
      expect(response.body.data.province).toBe(testAddress.province)
      expect(response.body.data.contact_name).toBe(testAddress.contact_name)
    })
    
    it('应该拒绝访问其他用户的地址', async () => {
      // 创建另一个用户
      const { User, Address } = sequelize.models
      const otherUserData = await TestDataFactory.createUser({
        phone: '13900139002',
        email: 'other@example.com'
      })
      const otherUser = await User.create(otherUserData)
      
      const otherAddressData = TestDataFactory.createAddress(otherUser.id)
      const otherAddress = await Address.create(otherAddressData)
      
      const response = await request(app)
        .get(`/api/addresses/${otherAddress.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404)
      
      expect(response.body.success).toBe(false)
    })
    
    it('应该返回404对于不存在的地址', async () => {
      const response = await request(app)
        .get('/api/addresses/99999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('地址不存在')
    })
  })
  
  describe('PUT /api/addresses/:id - 更新地址', () => {
    let testUser, testAddress, authToken
    
    beforeEach(async () => {
      const { User, Address } = sequelize.models
      
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
      
      const addressData = TestDataFactory.createAddress(testUser.id)
      testAddress = await Address.create(addressData)
    })
    
    it('应该成功更新地址信息', async () => {
      const updateData = {
        contact_name: '更新后的姓名',
        contact_phone: '13900139001',
        detail_address: '更新后的详细地址'
      }
      
      const response = await request(app)
        .put(`/api/addresses/${testAddress.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.contact_name).toBe(updateData.contact_name)
      expect(response.body.data.contact_phone).toBe(updateData.contact_phone)
      
      // 验证数据库更新
      await testAddress.reload()
      expect(testAddress.contact_name).toBe(updateData.contact_name)
    })
    
    it('应该支持部分字段更新', async () => {
      const originalContactName = testAddress.contact_name
      const updateData = {
        contact_phone: '13900139001'
        // 只更新手机号
      }
      
      const response = await request(app)
        .put(`/api/addresses/${testAddress.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.contact_phone).toBe(updateData.contact_phone)
      expect(response.body.data.contact_name).toBe(originalContactName) // 未变
    })
    
    it('应该处理默认地址切换', async () => {
      const { Address } = sequelize.models
      
      // 创建另一个地址作为默认地址
      const defaultAddress = await Address.create(
        TestDataFactory.createAddress(testUser.id, { is_default: true })
      )
      
      // 将当前地址设为默认
      const response = await request(app)
        .put(`/api/addresses/${testAddress.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ is_default: true })
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.is_default).toBe(true)
      
      // 验证原默认地址被取消
      await defaultAddress.reload()
      expect(defaultAddress.is_default).toBe(false)
    })
    
    it('应该拒绝更新其他用户的地址', async () => {
      // 创建另一个用户
      const { User } = sequelize.models
      const otherUserData = await TestDataFactory.createUser({
        phone: '13900139003',
        email: 'other2@example.com'
      })
      const otherUser = await User.create(otherUserData)
      const otherToken = TestHelpers.generateToken(otherUser)
      
      const response = await request(app)
        .put(`/api/addresses/${testAddress.id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ contact_name: '恶意更新' })
        .expect(404)
      
      expect(response.body.success).toBe(false)
    })
    
    it('应该验证更新数据格式', async () => {
      const response = await request(app)
        .put(`/api/addresses/${testAddress.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          contact_phone: '123' // 无效手机号
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('手机号格式')
    })
  })
  
  describe('PUT /api/addresses/:id/default - 设置默认地址', () => {
    let testUser, testAddresses, authToken
    
    beforeEach(async () => {
      const { User, Address } = sequelize.models
      
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
      
      // 创建多个地址
      testAddresses = []
      for (let i = 0; i < 3; i++) {
        const addressData = TestDataFactory.createAddress(testUser.id, {
          is_default: i === 0
        })
        const address = await Address.create(addressData)
        testAddresses.push(address)
      }
    })
    
    it('应该成功设置默认地址', async () => {
      const targetAddress = testAddresses[1] // 选择第二个地址
      
      const response = await request(app)
        .put(`/api/addresses/${targetAddress.id}/default`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      
      // 验证目标地址变为默认
      await targetAddress.reload()
      expect(targetAddress.is_default).toBe(true)
      
      // 验证原默认地址被取消
      await testAddresses[0].reload()
      expect(testAddresses[0].is_default).toBe(false)
    })
    
    it('应该正确处理已经是默认地址的情况', async () => {
      const defaultAddress = testAddresses[0] // 已经是默认地址
      
      const response = await request(app)
        .put(`/api/addresses/${defaultAddress.id}/default`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      
      // 验证仍为默认地址
      await defaultAddress.reload()
      expect(defaultAddress.is_default).toBe(true)
    })
  })
  
  describe('DELETE /api/addresses/:id - 删除地址', () => {
    let testUser, testAddresses, authToken
    
    beforeEach(async () => {
      const { User, Address } = sequelize.models
      
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
      
      // 创建多个地址
      testAddresses = []
      for (let i = 0; i < 3; i++) {
        const addressData = TestDataFactory.createAddress(testUser.id, {
          is_default: i === 0
        })
        const address = await Address.create(addressData)
        testAddresses.push(address)
      }
    })
    
    it('应该成功删除非默认地址', async () => {
      const targetAddress = testAddresses[1] // 非默认地址
      
      const response = await request(app)
        .delete(`/api/addresses/${targetAddress.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      
      // 验证地址已删除
      const { Address } = sequelize.models
      const deletedAddress = await Address.findByPk(targetAddress.id)
      expect(deletedAddress).toBeNull()
    })
    
    it('应该在删除默认地址时自动设置新的默认地址', async () => {
      const defaultAddress = testAddresses[0] // 默认地址
      
      const response = await request(app)
        .delete(`/api/addresses/${defaultAddress.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      
      // 验证原默认地址已删除
      const { Address } = sequelize.models
      const deletedAddress = await Address.findByPk(defaultAddress.id)
      expect(deletedAddress).toBeNull()
      
      // 验证有其他地址成为默认地址
      const remainingAddresses = await Address.findAll({
        where: { user_id: testUser.id }
      })
      const newDefaultAddress = remainingAddresses.find(addr => addr.is_default)
      expect(newDefaultAddress).toBeTruthy()
    })
    
    it('应该拒绝删除最后一个地址', async () => {
      // 先删除其他地址，只保留一个
      const { Address } = sequelize.models
      await Address.destroy({
        where: {
          user_id: testUser.id,
          id: { [sequelize.Sequelize.Op.ne]: testAddresses[0].id }
        }
      })
      
      const response = await request(app)
        .delete(`/api/addresses/${testAddresses[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('至少保留一个地址')
    })
    
    it('应该拒绝删除其他用户的地址', async () => {
      // 创建另一个用户
      const { User } = sequelize.models
      const otherUserData = await TestDataFactory.createUser({
        phone: '13900139004',
        email: 'other3@example.com'
      })
      const otherUser = await User.create(otherUserData)
      const otherToken = TestHelpers.generateToken(otherUser)
      
      const response = await request(app)
        .delete(`/api/addresses/${testAddresses[0].id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404)
      
      expect(response.body.success).toBe(false)
    })
    
    it('应该返回404对于不存在的地址', async () => {
      const response = await request(app)
        .delete('/api/addresses/99999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('地址不存在')
    })
  })
  
  describe('地址数据完整性验证', () => {
    let testUser, authToken
    
    beforeEach(async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
    })
    
    it('应该返回地址的完整信息', async () => {
      const { Address } = sequelize.models
      const addressData = TestDataFactory.createAddress(testUser.id, {
        province: '广东省',
        city: '深圳市', 
        district: '南山区',
        detail_address: '科技园南区深南大道10000号',
        postal_code: '518000',
        contact_name: '完整信息测试',
        contact_phone: '13800138001',
        is_default: true
      })
      const address = await Address.create(addressData)
      
      const response = await request(app)
        .get(`/api/addresses/${address.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      const returnedAddress = response.body.data
      expect(returnedAddress).toHaveProperty('id')
      expect(returnedAddress).toHaveProperty('province')
      expect(returnedAddress).toHaveProperty('city')
      expect(returnedAddress).toHaveProperty('district')
      expect(returnedAddress).toHaveProperty('detail_address')
      expect(returnedAddress).toHaveProperty('postal_code')
      expect(returnedAddress).toHaveProperty('contact_name')
      expect(returnedAddress).toHaveProperty('contact_phone')
      expect(returnedAddress).toHaveProperty('is_default')
      expect(returnedAddress).toHaveProperty('created_at')
      expect(returnedAddress).toHaveProperty('updated_at')
      
      // 验证完整地址字段
      expect(returnedAddress).toHaveProperty('full_address')
      expect(returnedAddress.full_address).toContain('广东省')
      expect(returnedAddress.full_address).toContain('深圳市')
      expect(returnedAddress.full_address).toContain('南山区')
      expect(returnedAddress.full_address).toContain('科技园南区深南大道10000号')
    })
  })
})
