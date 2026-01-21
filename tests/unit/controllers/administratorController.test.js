import { describe, it, expect, beforeEach, vi } from 'vitest'
import AdministratorController from '@server/controllers/administratorController.js'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('AdministratorController 单元测试', () => {
  let sequelize, Administrator
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    Administrator = sequelize.models.Administrator
  })
  
  describe('login 管理员登录', () => {
    let req, res, testAdmin
    
    beforeEach(async () => {
      const adminData = await TestDataFactory.createAdmin()
      testAdmin = await Administrator.create(adminData)
      
      req = {
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该成功登录', async () => {
      req.body = {
        username: testAdmin.username,
        password: '123456' // 测试密码
      }
      
      await AdministratorController.login(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '登录成功',
        data: expect.objectContaining({
          admin: expect.objectContaining({
            id: testAdmin.id,
            username: testAdmin.username
          }),
          token: expect.any(String)
        })
      })
    })
    
    it('应该拒绝错误的密码', async () => {
      req.body = {
        username: testAdmin.username,
        password: 'wrongpassword'
      }
      
      await AdministratorController.login(req, res)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '用户名或密码错误'
      })
    })
    
    it('应该拒绝不存在的用户名', async () => {
      req.body = {
        username: 'nonexistent',
        password: '123456'
      }
      
      await AdministratorController.login(req, res)
      
      expect(res.status).toHaveBeenCalledWith(401)
    })
    
    it('应该拒绝被禁用的管理员', async () => {
      await testAdmin.update({ is_active: false })
      
      req.body = {
        username: testAdmin.username,
        password: '123456'
      }
      
      await AdministratorController.login(req, res)
      
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '账户已被禁用'
      })
    })
  })
  
  describe('getAdministrators 获取管理员列表', () => {
    let req, res, testAdmins
    
    beforeEach(async () => {
      testAdmins = []
      const roles = ['super_admin', 'admin', 'moderator']
      
      for (let i = 0; i < roles.length; i++) {
        const adminData = await TestDataFactory.createAdmin({
          username: `admin${i}`,
          email: `admin${i}@example.com`,
          role: roles[i]
        })
        const admin = await Administrator.create(adminData)
        testAdmins.push(admin)
      }
      
      req = {
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回所有管理员', async () => {
      await AdministratorController.getAdministrators(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.administrators.length).toBeGreaterThanOrEqual(3)
    })
    
    it('应该支持按角色筛选', async () => {
      req.query.role = 'admin'
      
      await AdministratorController.getAdministrators(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.administrators.every(a => a.role === 'admin')).toBe(true)
    })
  })
  
  describe('createAdministrator 创建管理员', () => {
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
    
    it('应该创建新管理员', async () => {
      const adminData = await TestDataFactory.createAdmin()
      req.body = adminData
      
      await AdministratorController.createAdministrator(req, res)
      
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '管理员创建成功',
        data: expect.objectContaining({
          username: adminData.username
        })
      })
    })
    
    it('应该验证必填字段', async () => {
      req.body = {
        username: 'newadmin'
        // 缺少其他必填字段
      }
      
      await AdministratorController.createAdministrator(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
    })
  })
  
  describe('updateAdministrator 更新管理员', () => {
    let req, res, testAdmin
    
    beforeEach(async () => {
      const adminData = await TestDataFactory.createAdmin()
      testAdmin = await Administrator.create(adminData)
      
      req = {
        params: { id: testAdmin.id },
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该更新管理员信息', async () => {
      req.body = {
        real_name: '新名字',
        phone: '13900139001'
      }
      
      await AdministratorController.updateAdministrator(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      await testAdmin.reload()
      expect(testAdmin.real_name).toBe('新名字')
      expect(testAdmin.phone).toBe('13900139001')
    })
  })
  
  describe('deleteAdministrator 删除管理员', () => {
    let req, res, testAdmin
    
    beforeEach(async () => {
      const adminData = await TestDataFactory.createAdmin()
      testAdmin = await Administrator.create(adminData)
      
      req = {
        params: { id: testAdmin.id }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该删除管理员', async () => {
      await AdministratorController.deleteAdministrator(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      const deletedAdmin = await Administrator.findByPk(testAdmin.id)
      expect(deletedAdmin).toBeNull()
    })
  })
  
  describe('updateAdministratorStatus 更新管理员状态', () => {
    let req, res, testAdmin
    
    beforeEach(async () => {
      const adminData = await TestDataFactory.createAdmin()
      testAdmin = await Administrator.create(adminData)
      
      req = {
        params: { id: testAdmin.id },
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该启用管理员', async () => {
      await testAdmin.update({ is_active: false })
      
      req.body.is_active = true
      
      await AdministratorController.updateAdministratorStatus(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      await testAdmin.reload()
      expect(testAdmin.is_active).toBe(true)
    })
    
    it('应该禁用管理员', async () => {
      req.body.is_active = false
      
      await AdministratorController.updateAdministratorStatus(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      await testAdmin.reload()
      expect(testAdmin.is_active).toBe(false)
    })
  })
  
  describe('resetPassword 重置密码', () => {
    let req, res, testAdmin
    
    beforeEach(async () => {
      const adminData = await TestDataFactory.createAdmin()
      testAdmin = await Administrator.create(adminData)
      
      req = {
        params: { id: testAdmin.id },
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该重置密码', async () => {
      const originalPassword = testAdmin.password
      
      req.body.new_password = 'newpassword123'
      
      await AdministratorController.resetPassword(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      await testAdmin.reload()
      expect(testAdmin.password).not.toBe(originalPassword)
    })
  })
})
