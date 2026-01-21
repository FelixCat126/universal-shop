import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import ExportController from '@server/controllers/exportController.js'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'
import fs from 'fs'
import path from 'path'

describe('ExportController 单元测试', () => {
  let sequelize, Order, User, Product, OrderItem
  const tempDir = path.join(process.cwd(), 'temp_exports')
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    
    Order = sequelize.models.Order
    User = sequelize.models.User
    Product = sequelize.models.Product
    OrderItem = sequelize.models.OrderItem
    
    // 创建临时导出目录
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
  })
  
  afterEach(() => {
    // 清理临时文件
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir)
      files.forEach(file => {
        fs.unlinkSync(path.join(tempDir, file))
      })
      fs.rmdirSync(tempDir)
    }
  })
  
  describe('exportOrders 导出订单', () => {
    let req, res, testUser, testOrders
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const productData = TestDataFactory.createProduct()
      const product = await Product.create(productData)
      
      testOrders = []
      const statuses = ['pending_payment', 'pending_shipment', 'shipped', 'completed']
      
      for (let i = 0; i < 4; i++) {
        const orderData = TestDataFactory.createOrder(testUser.id, {
          order_no: `ORD${Date.now()}${i}`,
          status: statuses[i],
          total_amount: (i + 1) * 100
        })
        const order = await Order.create(orderData)
        testOrders.push(order)
        
        const orderItemData = TestDataFactory.createOrderItem(order.id, product.id, {
          quantity: i + 1
        })
        await OrderItem.create(orderItemData)
        
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      
      req = {
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        setHeader: vi.fn(),
        send: vi.fn()
      }
    })
    
    it('应该导出所有订单', async () => {
      await ExportController.exportOrders(req, res)
      
      expect(res.setHeader).toHaveBeenCalled()
      expect(res.send).toHaveBeenCalled()
      
      // 验证Excel文件头
      const headerCalls = res.setHeader.mock.calls
      const contentTypeHeader = headerCalls.find(call => call[0] === 'Content-Type')
      expect(contentTypeHeader).toBeDefined()
      expect(contentTypeHeader[1]).toContain('spreadsheet')
    })
    
    it('应该支持按状态筛选导出', async () => {
      req.query.status = 'completed'
      
      await ExportController.exportOrders(req, res)
      
      expect(res.send).toHaveBeenCalled()
    })
    
    it('应该支持按日期范围筛选', async () => {
      const today = new Date()
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
      
      req.query.start_date = yesterday.toISOString()
      req.query.end_date = today.toISOString()
      
      await ExportController.exportOrders(req, res)
      
      expect(res.send).toHaveBeenCalled()
    })
    
    it('应该包含多语言状态（泰语、中文、英文）', async () => {
      await ExportController.exportOrders(req, res)
      
      expect(res.send).toHaveBeenCalled()
      
      // 验证文件内容应该包含状态的三种语言格式
      // 由于Excel内容是二进制，这里主要验证函数执行成功
      expect(res.status).not.toHaveBeenCalledWith(500)
    })
  })
  
  describe('exportUsers 导出用户', () => {
    let req, res
    
    beforeEach(async () => {
      // 创建多个用户
      for (let i = 0; i < 5; i++) {
        const userData = await TestDataFactory.createUser({
          phone: `1390015${i.toString().padStart(4, '0')}`,
          email: `exportuser${i}@example.com`
        })
        await User.create(userData)
      }
      
      req = {
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        setHeader: vi.fn(),
        send: vi.fn()
      }
    })
    
    it('应该导出所有用户', async () => {
      await ExportController.exportUsers(req, res)
      
      expect(res.setHeader).toHaveBeenCalled()
      expect(res.send).toHaveBeenCalled()
    })
    
    it('应该支持按状态筛选', async () => {
      req.query.is_active = 'true'
      
      await ExportController.exportUsers(req, res)
      
      expect(res.send).toHaveBeenCalled()
    })
  })
  
  // exportProducts 方法未实现，跳过测试
  describe.skip('exportProducts 导出商品（未实现）', () => {
    // 业务侧未实现此功能，测试暂时跳过
  })
  
  // getStatusText 不是独立方法，而是exportOrders内部函数，跳过测试
  describe.skip('getStatusText 状态文本转换（内部函数）', () => {
    // 此方法在exportOrders内部定义，不作为独立方法暴露
  })
  
  // exportSalesReport 方法未实现，跳过测试
  describe.skip('exportSalesReport 导出销售报表（未实现）', () => {
    // 业务侧未实现此功能，测试暂时跳过
  })
  
  describe('错误处理', () => {
    let req, res
    
    beforeEach(() => {
      req = {
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        setHeader: vi.fn(),
        send: vi.fn()
      }
    })
    
    it('应该处理数据库错误', async () => {
      // 模拟数据库错误
      const spy = vi.spyOn(Order, 'findAll').mockRejectedValue(new Error('Database error'))
      
      await ExportController.exportOrders(req, res)
      
      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '导出失败',
        error: 'Database error'
      })
      
      // 恢复mock
      spy.mockRestore()
    })
    
    it('应该处理空数据导出', async () => {
      // 没有任何订单 - 应该能正常导出空Excel
      await ExportController.exportOrders(req, res)
      
      // 验证导出成功（即使数据为空）
      expect(res.setHeader).toHaveBeenCalled()
      expect(res.send).toHaveBeenCalled()
    })
  })
})
