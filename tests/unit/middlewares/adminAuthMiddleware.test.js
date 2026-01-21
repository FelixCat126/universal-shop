import { describe, it, expect, beforeEach, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import { authenticateAdmin, checkPermission } from '@server/middlewares/adminAuthMiddleware.js'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('adminAuthMiddleware', () => {
  let sequelize, Administrator
  const JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET || 'test-admin-secret-key'
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    Administrator = sequelize.models.Administrator
  })
  
  describe('authenticateAdmin 中间件', () => {
    let req, res, next, testAdmin
    
    beforeEach(async () => {
      const adminData = await TestDataFactory.createAdmin()
      testAdmin = await Administrator.create(adminData)
      
      req = {
        headers: {},
        header: function(name) {
          return this.headers[name.toLowerCase()]
        }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
      next = vi.fn()
    })
    
    it('应该验证有效的管理员token', async () => {
      const token = jwt.sign(
        { adminId: testAdmin.id },
        JWT_ADMIN_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${token}`
      
      await authenticateAdmin(req, res, next)
      
      expect(req.admin).toBeDefined()
      expect(req.admin.id).toBe(testAdmin.id)
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
    
    it('应该拒绝缺少token的请求', async () => {
      await authenticateAdmin(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('令牌')
      })
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝格式错误的token', async () => {
      req.headers['authorization'] = 'InvalidFormat'
      
      await authenticateAdmin(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝无效的token', async () => {
      req.headers['authorization'] = 'Bearer invalid.token.here'
      
      await authenticateAdmin(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝过期的token', async () => {
      const expiredToken = jwt.sign(
        { adminId: testAdmin.id },
        JWT_ADMIN_SECRET,
        { expiresIn: '-1h' }
      )
      
      req.headers['authorization'] = `Bearer ${expiredToken}`
      
      await authenticateAdmin(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝管理员不存在的token', async () => {
      const nonExistentAdminId = 99999
      const token = jwt.sign(
        { adminId: nonExistentAdminId },
        JWT_ADMIN_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${token}`
      
      await authenticateAdmin(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('管理员不存在')
      })
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝被禁用管理员的token', async () => {
      await testAdmin.update({ is_active: false })
      
      const token = jwt.sign(
        { adminId: testAdmin.id },
        JWT_ADMIN_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${token}`
      
      await authenticateAdmin(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('已被禁用')
      })
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该在管理员对象中排除密码', async () => {
      const token = jwt.sign(
        { adminId: testAdmin.id },
        JWT_ADMIN_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${token}`
      
      await authenticateAdmin(req, res, next)
      
      expect(req.admin).toBeDefined()
      expect(req.admin.password).toBeUndefined()
      expect(req.admin.username).toBeDefined()
    })
    
    it('应该支持小写的bearer前缀', async () => {
      const token = jwt.sign(
        { adminId: testAdmin.id },
        JWT_ADMIN_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `bearer ${token}`
      
      await authenticateAdmin(req, res, next)
      
      expect(req.admin).toBeDefined()
      expect(next).toHaveBeenCalled()
    })
  })
  
  describe('checkPermission 中间件', () => {
    let req, res, next, regularAdmin, superAdmin
    
    beforeEach(async () => {
      // 创建普通管理员
      const regularAdminData = await TestDataFactory.createAdmin({
        role: 'admin',
        permissions: ['users', 'orders']
      })
      regularAdmin = await Administrator.create(regularAdminData)
      
      // 创建超级管理员
      const superAdminData = await TestDataFactory.createAdmin({
        username: 'superadmin',
        email: 'super@example.com',
        role: 'super_admin',
        permissions: []
      })
      superAdmin = await Administrator.create(superAdminData)
      
      req = {
        admin: null
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
      next = vi.fn()
    })
    
    it('应该允许超级管理员访问所有权限', async () => {
      req.admin = superAdmin.toJSON()
      
      const middleware = checkPermission('any_permission')
      await middleware(req, res, next)
      
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
    
    it('应该允许有权限的管理员访问', async () => {
      req.admin = regularAdmin.toJSON()
      
      const middleware = checkPermission('users')
      await middleware(req, res, next)
      
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
    
    it('应该拒绝没有权限的管理员访问', async () => {
      req.admin = regularAdmin.toJSON()
      
      const middleware = checkPermission('products')
      await middleware(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('权限不足')
      })
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝没有登录的访问', async () => {
      req.admin = null
      
      const middleware = checkPermission('users')
      await middleware(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('未登录')
      })
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该支持多个权限检查（OR逻辑）', async () => {
      req.admin = regularAdmin.toJSON()
      
      // 管理员有users权限，应该通过
      const middleware = checkPermission(['users', 'products'])
      await middleware(req, res, next)
      
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
    
    it('应该拒绝没有任何指定权限的管理员', async () => {
      req.admin = regularAdmin.toJSON()
      
      // 管理员没有products和statistics权限
      const middleware = checkPermission(['products', 'statistics'])
      await middleware(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(403)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该处理permissions为null的情况', async () => {
      const adminWithoutPerms = await Administrator.create(
        await TestDataFactory.createAdmin({
          username: 'noperms',
          email: 'noperms@example.com',
          role: 'admin',
          permissions: null
        })
      )
      
      req.admin = adminWithoutPerms.toJSON()
      req.admin.permissions = null
      
      const middleware = checkPermission('users')
      await middleware(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(403)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该处理permissions为空数组的情况', async () => {
      const adminWithEmptyPerms = {
        ...regularAdmin.toJSON(),
        permissions: []
      }
      
      req.admin = adminWithEmptyPerms
      
      const middleware = checkPermission('users')
      await middleware(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(403)
      expect(next).not.toHaveBeenCalled()
    })
  })
  
  describe('权限层级测试', () => {
    let req, res, next
    
    beforeEach(() => {
      req = {
        admin: null
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
      next = vi.fn()
    })
    
    it('超级管理员应该拥有所有权限', async () => {
      const superAdminData = await TestDataFactory.createAdmin({
        role: 'super_admin',
        permissions: []
      })
      const superAdmin = await Administrator.create(superAdminData)
      
      req.admin = superAdmin.toJSON()
      
      const testPermissions = ['users', 'orders', 'products', 'statistics', 'config']
      
      for (const permission of testPermissions) {
        const middleware = checkPermission(permission)
        await middleware(req, res, next)
        
        expect(next).toHaveBeenCalled()
        next.mockClear()
      }
    })
    
    it('普通管理员只能访问授权的权限', async () => {
      const adminData = await TestDataFactory.createAdmin({
        role: 'admin',
        permissions: ['users', 'orders']
      })
      const admin = await Administrator.create(adminData)
      
      req.admin = admin.toJSON()
      
      // 应该通过的权限
      const allowedPermissions = ['users', 'orders']
      for (const permission of allowedPermissions) {
        const middleware = checkPermission(permission)
        await middleware(req, res, next)
        
        expect(next).toHaveBeenCalled()
        next.mockClear()
        res.status.mockClear()
      }
      
      // 应该被拒绝的权限
      const deniedPermissions = ['products', 'statistics', 'config']
      for (const permission of deniedPermissions) {
        const middleware = checkPermission(permission)
        await middleware(req, res, next)
        
        expect(res.status).toHaveBeenCalledWith(403)
        expect(next).not.toHaveBeenCalled()
        next.mockClear()
        res.status.mockClear()
        res.json.mockClear()
      }
    })
    
    it('版主应该有有限的权限', async () => {
      const moderatorData = await TestDataFactory.createAdmin({
        role: 'moderator',
        permissions: ['users']
      })
      const moderator = await Administrator.create(moderatorData)
      
      req.admin = moderator.toJSON()
      
      // 有权限
      const middleware1 = checkPermission('users')
      await middleware1(req, res, next)
      expect(next).toHaveBeenCalled()
      
      next.mockClear()
      res.status.mockClear()
      
      // 无权限
      const middleware2 = checkPermission('orders')
      await middleware2(req, res, next)
      expect(res.status).toHaveBeenCalledWith(403)
    })
  })
  
  describe('安全性测试', () => {
    let req, res, next, testAdmin
    
    beforeEach(async () => {
      const adminData = await TestDataFactory.createAdmin()
      testAdmin = await Administrator.create(adminData)
      
      req = {
        headers: {},
        header: function(name) {
          return this.headers[name.toLowerCase()]
        }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
      next = vi.fn()
    })
    
    it('应该拒绝使用错误密钥签名的token', async () => {
      const wrongSecretToken = jwt.sign(
        { adminId: testAdmin.id },
        'wrong-secret-key',
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${wrongSecretToken}`
      
      await authenticateAdmin(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝篡改过的token', async () => {
      const validToken = jwt.sign(
        { adminId: testAdmin.id },
        JWT_ADMIN_SECRET,
        { expiresIn: '24h' }
      )
      
      const parts = validToken.split('.')
      parts[1] = Buffer.from(JSON.stringify({ adminId: 99999 })).toString('base64')
      const tamperedToken = parts.join('.')
      
      req.headers['authorization'] = `Bearer ${tamperedToken}`
      
      await authenticateAdmin(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝用户token（使用用户密钥签名）', async () => {
      const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key'
      const userToken = jwt.sign(
        { userId: testAdmin.id },
        JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${userToken}`
      
      await authenticateAdmin(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝缺少adminId的token', async () => {
      const invalidToken = jwt.sign(
        { email: testAdmin.email },
        JWT_ADMIN_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${invalidToken}`
      
      await authenticateAdmin(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('不应该允许通过修改req.admin来提升权限', async () => {
      const lowPrivAdmin = await Administrator.create(
        await TestDataFactory.createAdmin({
          username: 'lowpriv',
          email: 'lowpriv@example.com',
          role: 'admin',
          permissions: ['users']
        })
      )
      
      // 验证管理员身份
      const token = jwt.sign(
        { adminId: lowPrivAdmin.id },
        JWT_ADMIN_SECRET,
        { expiresIn: '24h' }
      )
      req.headers['authorization'] = `Bearer ${token}`
      
      await authenticateAdmin(req, res, next)
      
      // 尝试篡改权限（模拟攻击）
      req.admin.role = 'super_admin'
      req.admin.permissions = ['all']
      
      // 重新验证权限
      next.mockClear()
      res.status.mockClear()
      res.json.mockClear()
      
      // 应该根据数据库中的真实权限来判断，而不是req.admin
      const middleware = checkPermission('orders')
      await middleware(req, res, next)
      
      // 因为权限检查使用的是req.admin中的数据，
      // 实际应用中应该从数据库重新查询或使用加密的权限信息
      // 这里只是测试当前实现
      expect(res.status).toHaveBeenCalledWith(403)
    })
  })
  
  describe('边界情况', () => {
    let req, res, next
    
    beforeEach(() => {
      req = {
        headers: {},
        header: function(name) {
          return this.headers[name.toLowerCase()]
        }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
      next = vi.fn()
    })
    
    it('应该处理空的Authorization header', async () => {
      req.headers['authorization'] = ''
      
      await authenticateAdmin(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该处理只有Bearer的Authorization header', async () => {
      req.headers['authorization'] = 'Bearer'
      
      await authenticateAdmin(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该处理权限为undefined的情况', async () => {
      req.admin = {
        id: 1,
        username: 'test',
        role: 'admin',
        permissions: undefined
      }
      
      const middleware = checkPermission('users')
      await middleware(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(403)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该处理空字符串权限', async () => {
      req.admin = {
        id: 1,
        username: 'test',
        role: 'super_admin'
      }
      
      const middleware = checkPermission('')
      await middleware(req, res, next)
      
      // 超级管理员应该通过
      expect(next).toHaveBeenCalled()
    })
  })
})
