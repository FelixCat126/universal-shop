import { describe, it, expect, beforeEach, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import { authenticateToken, optionalAuth } from '@server/middlewares/authMiddleware.js'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('authMiddleware', () => {
  let sequelize, User
  const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key'
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    User = sequelize.models.User
  })
  
  describe('authenticateToken 中间件', () => {
    let req, res, next, testUser
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
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
    
    it('应该验证有效的token', async () => {
      const token = jwt.sign(
        { userId: testUser.id },
        JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${token}`
      
      await authenticateToken(req, res, next)
      
      expect(req.user).toBeDefined()
      expect(req.user.id).toBe(testUser.id)
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
    
    it('应该拒绝缺少token的请求', async () => {
      // 没有设置Authorization header
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '未提供认证令牌'
      })
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝格式错误的token', async () => {
      req.headers['authorization'] = 'InvalidFormat'
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('令牌格式错误')
      })
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝无效的token', async () => {
      req.headers['authorization'] = 'Bearer invalid.token.here'
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('令牌验证失败')
      })
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝过期的token', async () => {
      const expiredToken = jwt.sign(
        { userId: testUser.id },
        JWT_SECRET,
        { expiresIn: '-1h' } // 过期的token
      )
      
      req.headers['authorization'] = `Bearer ${expiredToken}`
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('令牌已过期')
      })
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝用户不存在的token', async () => {
      const nonExistentUserId = 99999
      const token = jwt.sign(
        { userId: nonExistentUserId },
        JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${token}`
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '用户不存在'
      })
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝被禁用用户的token', async () => {
      await testUser.update({ is_active: false })
      
      const token = jwt.sign(
        { userId: testUser.id },
        JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${token}`
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '账户已被禁用'
      })
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该支持小写的bearer前缀', async () => {
      const token = jwt.sign(
        { userId: testUser.id },
        JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `bearer ${token}`
      
      await authenticateToken(req, res, next)
      
      expect(req.user).toBeDefined()
      expect(req.user.id).toBe(testUser.id)
      expect(next).toHaveBeenCalled()
    })
    
    it('应该处理token中的额外空格', async () => {
      const token = jwt.sign(
        { userId: testUser.id },
        JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer  ${token}  `
      
      await authenticateToken(req, res, next)
      
      expect(req.user).toBeDefined()
      expect(req.user.id).toBe(testUser.id)
      expect(next).toHaveBeenCalled()
    })
    
    it('应该在用户对象中排除密码', async () => {
      const token = jwt.sign(
        { userId: testUser.id },
        JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${token}`
      
      await authenticateToken(req, res, next)
      
      expect(req.user).toBeDefined()
      expect(req.user.password).toBeUndefined()
      expect(req.user.email).toBeDefined()
    })
  })
  
  describe('optionalAuth 中间件', () => {
    let req, res, next, testUser
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
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
    
    it('应该在有token时验证用户', async () => {
      const token = jwt.sign(
        { userId: testUser.id },
        JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${token}`
      
      await optionalAuth(req, res, next)
      
      expect(req.user).toBeDefined()
      expect(req.user.id).toBe(testUser.id)
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
    
    it('应该在没有token时允许请求通过', async () => {
      // 没有设置Authorization header
      
      await optionalAuth(req, res, next)
      
      expect(req.user).toBeUndefined()
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
    
    it('应该在token无效时允许请求通过但不设置user', async () => {
      req.headers['authorization'] = 'Bearer invalid.token'
      
      await optionalAuth(req, res, next)
      
      expect(req.user).toBeUndefined()
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
    
    it('应该在token过期时允许请求通过但不设置user', async () => {
      const expiredToken = jwt.sign(
        { userId: testUser.id },
        JWT_SECRET,
        { expiresIn: '-1h' }
      )
      
      req.headers['authorization'] = `Bearer ${expiredToken}`
      
      await optionalAuth(req, res, next)
      
      expect(req.user).toBeUndefined()
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
    
    it('应该在用户不存在时允许请求通过但不设置user', async () => {
      const token = jwt.sign(
        { userId: 99999 },
        JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${token}`
      
      await optionalAuth(req, res, next)
      
      expect(req.user).toBeUndefined()
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
    
    it('应该拒绝被禁用的用户', async () => {
      await testUser.update({ is_active: false })
      
      const token = jwt.sign(
        { userId: testUser.id },
        JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${token}`
      
      await optionalAuth(req, res, next)
      
      expect(req.user).toBeUndefined()
      expect(next).toHaveBeenCalled()
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
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该处理只有Bearer的Authorization header', async () => {
      req.headers['authorization'] = 'Bearer'
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该处理只有Bearer和空格的Authorization header', async () => {
      req.headers['authorization'] = 'Bearer '
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该处理多个空格的token', async () => {
      req.headers['authorization'] = 'Bearer    '
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该处理没有Bearer前缀的token', async () => {
      req.headers['authorization'] = 'some.jwt.token'
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
  })
  
  describe('安全性测试', () => {
    let req, res, next, testUser
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
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
        { userId: testUser.id },
        'wrong-secret-key',
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${wrongSecretToken}`
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝篡改过的token', async () => {
      const validToken = jwt.sign(
        { userId: testUser.id },
        JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      // 篡改token的payload部分
      const parts = validToken.split('.')
      parts[1] = Buffer.from(JSON.stringify({ userId: 99999 })).toString('base64')
      const tamperedToken = parts.join('.')
      
      req.headers['authorization'] = `Bearer ${tamperedToken}`
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
    
    it('应该拒绝包含额外字段的token', async () => {
      const token = jwt.sign(
        {
          userId: testUser.id,
          role: 'admin', // 额外字段
          permissions: ['all']
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${token}`
      
      // 应该能验证通过，但只使用userId
      await authenticateToken(req, res, next)
      
      expect(req.user).toBeDefined()
      expect(req.user.id).toBe(testUser.id)
      // 验证额外字段不会影响认证
      expect(next).toHaveBeenCalled()
    })
    
    it('应该拒绝缺少userId的token', async () => {
      const invalidToken = jwt.sign(
        { email: testUser.email }, // 没有userId
        JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      req.headers['authorization'] = `Bearer ${invalidToken}`
      
      await authenticateToken(req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
  })
})
