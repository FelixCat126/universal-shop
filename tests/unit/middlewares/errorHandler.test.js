import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ApiError, errorHandler, notFoundHandler } from '@server/middlewares/errorHandler.js'

describe('错误处理中间件', () => {
  let req, res, next
  
  beforeEach(() => {
    req = {
      originalUrl: '/test/path',
      method: 'GET',
      ip: '127.0.0.1'
    }
    
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    }
    
    next = vi.fn()
    
    // Mock console.error
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  
  describe('ApiError类', () => {
    it('应该创建自定义API错误', () => {
      const error = new ApiError('测试错误', 400, 'TEST_ERROR')
      
      expect(error.message).toBe('测试错误')
      expect(error.statusCode).toBe(400)
      expect(error.code).toBe('TEST_ERROR')
      expect(error.name).toBe('ApiError')
    })
    
    it('应该使用默认状态码', () => {
      const error = new ApiError('测试错误')
      
      expect(error.statusCode).toBe(500)
      expect(error.code).toBeNull()
    })
  })
  
  describe('errorHandler中间件', () => {
    it('应该处理ApiError', () => {
      const error = new ApiError('自定义错误', 400, 'CUSTOM_ERROR')
      
      errorHandler(error, req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '自定义错误',
        code: 'CUSTOM_ERROR',
        timestamp: expect.any(String)
      })
    })
    
    it('应该处理Sequelize ValidationError', () => {
      const error = {
        name: 'ValidationError',
        errors: [
          { message: '字段1验证失败' },
          { message: '字段2验证失败' }
        ]
      }
      
      errorHandler(error, req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '字段1验证失败; 字段2验证失败',
        code: 'VALIDATION_ERROR',
        timestamp: expect.any(String)
      })
    })
    
    it('应该处理Sequelize UniqueConstraintError', () => {
      const error = {
        name: 'SequelizeUniqueConstraintError',
        errors: [{ path: 'email' }]
      }
      
      errorHandler(error, req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(409)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'email已存在',
        code: 'UNIQUE_CONSTRAINT_ERROR',
        timestamp: expect.any(String)
      })
    })
    
    it('应该处理Sequelize ForeignKeyConstraintError', () => {
      const error = {
        name: 'SequelizeForeignKeyConstraintError'
      }
      
      errorHandler(error, req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '关联数据不存在',
        code: 'FOREIGN_KEY_ERROR',
        timestamp: expect.any(String)
      })
    })
    
    it('应该处理JWT错误', () => {
      const error = {
        name: 'JsonWebTokenError',
        message: 'invalid token'
      }
      
      errorHandler(error, req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '无效的认证令牌',
        code: 'INVALID_TOKEN',
        timestamp: expect.any(String)
      })
    })
    
    it('应该处理JWT过期错误', () => {
      const error = {
        name: 'TokenExpiredError'
      }
      
      errorHandler(error, req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '认证令牌已过期',
        code: 'TOKEN_EXPIRED',
        timestamp: expect.any(String)
      })
    })
    
    it('应该处理Multer文件大小错误', () => {
      const error = {
        code: 'LIMIT_FILE_SIZE'
      }
      
      errorHandler(error, req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '文件大小超出限制',
        code: 'FILE_TOO_LARGE',
        timestamp: expect.any(String)
      })
    })
    
    it('应该处理Multer文件数量错误', () => {
      const error = {
        code: 'LIMIT_FILE_COUNT'
      }
      
      errorHandler(error, req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '文件数量超出限制',
        code: 'TOO_MANY_FILES',
        timestamp: expect.any(String)
      })
    })
    
    it('应该处理JSON语法错误', () => {
      const error = new SyntaxError('Unexpected token')
      error.status = 400
      error.body = {}
      
      errorHandler(error, req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '请求数据格式错误',
        code: 'INVALID_JSON',
        timestamp: expect.any(String)
      })
    })
    
    it('应该在生产环境隐藏错误详情', () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      
      const error = new Error('内部错误')
      
      errorHandler(error, req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '服务器内部错误',
        code: 'INTERNAL_SERVER_ERROR',
        timestamp: expect.any(String)
      })
      
      // 恢复环境变量
      process.env.NODE_ENV = originalEnv
    })
    
    it('应该在开发环境显示错误详情', () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'
      
      const error = new Error('开发环境错误')
      
      errorHandler(error, req, res, next)
      
      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '开发环境错误',
        code: 'INTERNAL_SERVER_ERROR',
        timestamp: expect.any(String),
        details: expect.objectContaining({
          stack: expect.any(String)
        })
      })
      
      // 恢复环境变量
      process.env.NODE_ENV = originalEnv
    })
    
    it('应该记录错误日志', () => {
      const error = new Error('测试错误')
      
      errorHandler(error, req, res, next)
      
      expect(console.error).toHaveBeenCalledWith(
        '🔥 Error caught by errorHandler:',
        expect.objectContaining({
          name: 'Error',
          message: '测试错误',
          url: '/test/path',
          method: 'GET',
          ip: '127.0.0.1',
          timestamp: expect.any(String)
        })
      )
    })
  })
  
  describe('notFoundHandler中间件', () => {
    it('应该返回404错误', () => {
      notFoundHandler(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '路径 /test/path 不存在',
        code: 'NOT_FOUND',
        timestamp: expect.any(String)
      })
    })
  })
  
  describe('响应格式一致性', () => {
    it('所有错误响应应该包含必需字段', () => {
      const testErrors = [
        new ApiError('测试', 400, 'TEST'),
        { name: 'ValidationError', errors: [] },
        { name: 'JsonWebTokenError' },
        new Error('通用错误')
      ]
      
      testErrors.forEach(error => {
        res.status.mockClear()
        res.json.mockClear()
        
        errorHandler(error, req, res, next)
        
        const response = res.json.mock.calls[0][0]
        expect(response).toHaveProperty('success', false)
        expect(response).toHaveProperty('message')
        expect(response).toHaveProperty('timestamp')
        expect(typeof response.timestamp).toBe('string')
      })
    })
    
    it('应该在有错误码时包含code字段', () => {
      const error = new ApiError('测试', 400, 'TEST_CODE')
      
      errorHandler(error, req, res, next)
      
      const response = res.json.mock.calls[0][0]
      expect(response).toHaveProperty('code', 'TEST_CODE')
    })
    
    it('应该在没有错误码时不包含code字段', () => {
      const error = new ApiError('测试', 400)
      
      errorHandler(error, req, res, next)
      
      const response = res.json.mock.calls[0][0]
      expect(response).not.toHaveProperty('code')
    })
  })
})
