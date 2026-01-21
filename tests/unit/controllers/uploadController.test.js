import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import UploadController from '@server/controllers/uploadController.js'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'
import fs from 'fs'
import path from 'path'

describe('UploadController 单元测试', () => {
  let sequelize, Product
  const tempUploadDir = path.join(process.cwd(), 'temp_test_uploads')
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    Product = sequelize.models.Product
    
    // 创建临时上传目录
    if (!fs.existsSync(tempUploadDir)) {
      fs.mkdirSync(tempUploadDir, { recursive: true })
    }
  })
  
  afterEach(() => {
    // 清理临时文件
    if (fs.existsSync(tempUploadDir)) {
      const files = fs.readdirSync(tempUploadDir)
      files.forEach(file => {
        const filePath = path.join(tempUploadDir, file)
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      })
      fs.rmdirSync(tempUploadDir)
    }
  })
  
  describe('uploadProductImage 上传商品图片', () => {
    let req, res
    
    beforeEach(() => {
      req = {
        file: {
          filename: 'test-image.jpg',
          mimetype: 'image/jpeg',
          size: 102400, // 100KB
          path: path.join(tempUploadDir, 'test-image.jpg')
        }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
      
      // 创建临时测试文件
      fs.writeFileSync(req.file.path, 'fake image data')
    })
    
    it('应该成功上传图片', async () => {
      await UploadController.uploadProductImage(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '上传成功',
        data: expect.objectContaining({
          filename: expect.any(String),
          url: expect.stringContaining('/uploads/')
        })
      })
    })
    
    it('应该拒绝没有文件的请求', async () => {
      req.file = null
      
      await UploadController.uploadProductImage(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('未上传文件')
      })
    })
    
    it('应该验证文件类型', async () => {
      req.file.mimetype = 'application/pdf'
      req.file.filename = 'test.pdf'
      
      await UploadController.uploadProductImage(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('文件类型')
      })
    })
    
    it('应该验证文件大小', async () => {
      req.file.size = 10 * 1024 * 1024 // 10MB，超过限制
      
      await UploadController.uploadProductImage(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('文件过大')
      })
    })
    
    it('应该验证文件名安全性', async () => {
      req.file.filename = '../../../etc/passwd'
      
      await UploadController.uploadProductImage(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('非法')
      })
    })
    
    it('应该拒绝包含特殊字符的文件名', async () => {
      const illegalNames = [
        '../test.jpg',
        'test/../image.jpg',
        'test/../../image.jpg',
        'test\x00.jpg',
        'test<script>.jpg'
      ]
      
      for (const filename of illegalNames) {
        req.file.filename = filename
        
        await UploadController.uploadProductImage(req, res)
        
        expect(res.status).toHaveBeenCalledWith(400)
        res.status.mockClear()
        res.json.mockClear()
      }
    })
  })
  
  describe('deleteProductImage 删除商品图片', () => {
    let req, res, testImagePath
    
    beforeEach(() => {
      // 创建测试图片文件
      testImagePath = path.join(tempUploadDir, 'test-delete.jpg')
      fs.writeFileSync(testImagePath, 'test image')
      
      req = {
        body: {
          filename: 'test-delete.jpg'
        }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该成功删除图片', async () => {
      await UploadController.deleteProductImage(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '删除成功'
      })
    })
    
    it('应该拒绝包含路径遍历的文件名', async () => {
      req.body.filename = '../../../etc/passwd'
      
      await UploadController.deleteProductImage(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('非法')
      })
    })
    
    it('应该处理不存在的文件', async () => {
      req.body.filename = 'nonexistent.jpg'
      
      await UploadController.deleteProductImage(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('不存在')
      })
    })
    
    it('应该验证文件名不为空', async () => {
      req.body.filename = ''
      
      await UploadController.deleteProductImage(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
    })
  })
  
  describe('getUploadedImages 获取已上传图片列表', () => {
    let req, res
    
    beforeEach(() => {
      // 创建多个测试图片
      const testImages = ['image1.jpg', 'image2.png', 'image3.jpg']
      testImages.forEach(filename => {
        fs.writeFileSync(path.join(tempUploadDir, filename), 'test')
      })
      
      req = {
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回图片列表', async () => {
      await UploadController.getUploadedImages(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      expect(Array.isArray(responseData.images)).toBe(true)
      expect(responseData.images.length).toBeGreaterThan(0)
    })
    
    it('应该支持分页', async () => {
      req.query.page = 1
      req.query.page_size = 2
      
      await UploadController.getUploadedImages(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.images.length).toBeLessThanOrEqual(2)
    })
    
    it('应该支持按类型筛选', async () => {
      req.query.type = 'jpg'
      
      await UploadController.getUploadedImages(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      responseData.images.forEach(image => {
        expect(image.filename).toMatch(/\.jpg$/)
      })
    })
  })
  
  describe('文件验证', () => {
    let req, res
    
    beforeEach(() => {
      req = {
        file: {
          filename: 'test.jpg',
          mimetype: 'image/jpeg',
          size: 102400,
          path: path.join(tempUploadDir, 'test.jpg')
        }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
      
      fs.writeFileSync(req.file.path, 'fake image')
    })
    
    it('应该接受合法的图片格式', async () => {
      const validTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp'
      ]
      
      for (const mimeType of validTypes) {
        req.file.mimetype = mimeType
        res.status.mockClear()
        res.json.mockClear()
        
        await UploadController.uploadProductImage(req, res)
        
        expect(res.status).toHaveBeenCalledWith(200)
      }
    })
    
    it('应该拒绝可执行文件', async () => {
      const dangerousTypes = [
        'application/x-executable',
        'application/x-sh',
        'application/x-msdownload'
      ]
      
      for (const mimeType of dangerousTypes) {
        req.file.mimetype = mimeType
        res.status.mockClear()
        res.json.mockClear()
        
        await UploadController.uploadProductImage(req, res)
        
        expect(res.status).toHaveBeenCalledWith(400)
      }
    })
    
    it('应该检查文件扩展名', async () => {
      const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
      
      for (const ext of validExtensions) {
        req.file.filename = `test${ext}`
        res.status.mockClear()
        res.json.mockClear()
        
        await UploadController.uploadProductImage(req, res)
        
        expect(res.status).toHaveBeenCalledWith(200)
      }
    })
    
    it('应该拒绝双扩展名文件', async () => {
      req.file.filename = 'test.php.jpg'
      
      await UploadController.uploadProductImage(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
    })
  })
  
  describe('安全性测试', () => {
    let req, res
    
    beforeEach(() => {
      req = {
        file: {
          filename: 'test.jpg',
          mimetype: 'image/jpeg',
          size: 102400,
          path: path.join(tempUploadDir, 'test.jpg')
        }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
      
      fs.writeFileSync(req.file.path, 'fake image')
    })
    
    it('应该防止目录遍历攻击', async () => {
      const attackPaths = [
        '../../etc/passwd',
        '..\\..\\windows\\system32',
        '/etc/passwd',
        'C:\\Windows\\System32\\config\\sam'
      ]
      
      for (const attackPath of attackPaths) {
        req.file.filename = attackPath
        res.status.mockClear()
        res.json.mockClear()
        
        await UploadController.uploadProductImage(req, res)
        
        expect(res.status).toHaveBeenCalledWith(400)
      }
    })
    
    it('应该防止null byte注入', async () => {
      req.file.filename = 'test.jpg\x00.php'
      
      await UploadController.uploadProductImage(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
    })
    
    it('应该防止特殊字符注入', async () => {
      const specialChars = ['<', '>', ':', '"', '|', '?', '*']
      
      for (const char of specialChars) {
        req.file.filename = `test${char}image.jpg`
        res.status.mockClear()
        res.json.mockClear()
        
        await UploadController.uploadProductImage(req, res)
        
        expect(res.status).toHaveBeenCalledWith(400)
      }
    })
  })
})
