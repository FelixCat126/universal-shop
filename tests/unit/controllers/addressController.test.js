import { describe, it, expect, beforeEach } from 'vitest'
import AddressController from '@server/controllers/addressController.js'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'
import { createAuthenticatedRequest, createMockResponse } from '../../helpers/request-helpers.js'

describe('AddressController 单元测试', () => {
  let sequelize, Address, User
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    
    Address = sequelize.models.Address
    User = sequelize.models.User
  })
  
  describe('getAddresses 获取地址列表', () => {
    let req, res, testUser, testAddresses
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      testAddresses = []
      for (let i = 0; i < 3; i++) {
        const addressData = TestDataFactory.createAddress(testUser.id, {
          is_default: i === 0,
          detail_address: `地址${i + 1}`
        })
        const address = await Address.create(addressData)
        testAddresses.push(address)
      }
      
      req = createAuthenticatedRequest(testUser)
      res = createMockResponse()
    })
    
    it('应该返回用户所有地址', async () => {
      await AddressController.getAddresses(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData).toHaveLength(3)
    })
    
    it('默认地址应该排在前面', async () => {
      await AddressController.getAddresses(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData[0].is_default).toBe(true)
    })
  })
  
  describe('getAddressById 获取地址详情', () => {
    let req, res, testUser, testAddress
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const addressData = TestDataFactory.createAddress(testUser.id)
      testAddress = await Address.create(addressData)
      
      req = createAuthenticatedRequest(testUser, {
        params: { id: testAddress.id }
      })
      res = createMockResponse()
    })
    
    it('应该返回地址详情', async () => {
      await AddressController.getAddressById(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.id).toBe(testAddress.id)
    })
    
    it('应该拒绝访问其他用户的地址', async () => {
      const otherUserData = await TestDataFactory.createUser({
        phone: '13900000002'
      })
      const otherUser = await User.create(otherUserData)
      const otherAddressData = TestDataFactory.createAddress(otherUser.id)
      const otherAddress = await Address.create(otherAddressData)
      
      req.params.id = otherAddress.id
      
      await AddressController.getAddressById(req, res)
      
      expect(res.status).toHaveBeenCalledWith(403)
    })
  })
  
  describe('createAddress 创建地址', () => {
    let req, res, testUser
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      req = createAuthenticatedRequest(testUser)
      res = createMockResponse()
    })
    
    it('应该创建新地址', async () => {
      const addressData = TestDataFactory.createAddress(testUser.id)
      delete addressData.user_id // 从user对象获取
      req.body = addressData
      
      await AddressController.createAddress(req, res)
      
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '地址添加成功',
        data: expect.objectContaining({
          province: addressData.province,
          city: addressData.city
        })
      })
    })
    
    it('第一个地址应该自动设为默认', async () => {
      const addressData = TestDataFactory.createAddress(testUser.id, {
        is_default: false
      })
      delete addressData.user_id
      req.body = addressData
      
      await AddressController.createAddress(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.is_default).toBe(true)
    })
    
    it('应该验证必填字段', async () => {
      req.body = {
        province: '北京市'
        // 缺少其他必填字段
      }
      
      await AddressController.createAddress(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
    })
  })
  
  describe('updateAddress 更新地址', () => {
    let req, res, testUser, testAddress
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const addressData = TestDataFactory.createAddress(testUser.id)
      testAddress = await Address.create(addressData)
      
      req = createAuthenticatedRequest(testUser, {
        params: { id: testAddress.id }
      })
      res = createMockResponse()
    })
    
    it('应该更新地址信息', async () => {
      req.body = {
        province: '上海市',
        city: '上海市',
        district: '浦东新区'
      }
      
      await AddressController.updateAddress(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.province).toBe('上海市')
    })
  })
  
  describe('deleteAddress 删除地址', () => {
    let req, res, testUser, testAddress
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const addressData = TestDataFactory.createAddress(testUser.id)
      testAddress = await Address.create(addressData)
      
      req = createAuthenticatedRequest(testUser, {
        params: { id: testAddress.id }
      })
      res = createMockResponse()
    })
    
    it('应该删除地址', async () => {
      await AddressController.deleteAddress(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      const deletedAddress = await Address.findByPk(testAddress.id)
      expect(deletedAddress).toBeNull()
    })
  })
  
  describe('setDefaultAddress 设置默认地址', () => {
    let req, res, testUser, testAddresses
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      testAddresses = []
      for (let i = 0; i < 3; i++) {
        const addressData = TestDataFactory.createAddress(testUser.id, {
          is_default: i === 0
        })
        const address = await Address.create(addressData)
        testAddresses.push(address)
      }
      
      req = createAuthenticatedRequest(testUser, {
        params: { id: testAddresses[1].id }
      })
      res = createMockResponse()
    })
    
    it('应该设置新的默认地址', async () => {
      await AddressController.setDefaultAddress(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      const newDefault = await Address.findByPk(testAddresses[1].id)
      expect(newDefault.is_default).toBe(true)
      
      const oldDefault = await Address.findByPk(testAddresses[0].id)
      expect(oldDefault.is_default).toBe(false)
    })
  })
})
