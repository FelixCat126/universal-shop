import { describe, it, expect, beforeEach, vi } from 'vitest'
import StatisticsController from '@server/controllers/statisticsController.js'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('StatisticsController 单元测试', () => {
  let sequelize, User, Product, Order, OrderItem
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    
    User = sequelize.models.User
    Product = sequelize.models.Product
    Order = sequelize.models.Order
    OrderItem = sequelize.models.OrderItem
  })
  
  describe('getOverview 获取概览统计', () => {
    let req, res
    
    beforeEach(async () => {
      // 创建测试数据
      for (let i = 0; i < 5; i++) {
        const userData = await TestDataFactory.createUser({
          phone: `1390013${i.toString().padStart(4, '0')}`,
          email: `statsuser${i}@example.com`
        })
        await User.create(userData)
      }
      
      for (let i = 0; i < 10; i++) {
        const productData = TestDataFactory.createProduct({
          name: `统计商品${i + 1}`
        })
        await Product.create(productData)
      }
      
      req = {}
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回概览统计数据', async () => {
      await StatisticsController.getOverview(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      
      expect(responseData).toHaveProperty('total_users')
      expect(responseData).toHaveProperty('total_products')
      expect(responseData).toHaveProperty('total_orders')
      expect(responseData).toHaveProperty('total_revenue')
      
      expect(responseData.total_users).toBe(5)
      expect(responseData.total_products).toBe(10)
    })
  })
  
  describe('getSalesStatistics 获取销售统计', () => {
    let req, res
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      const productData = TestDataFactory.createProduct()
      const product = await Product.create(productData)
      
      // 创建不同状态的订单
      const statuses = ['completed', 'completed', 'pending_payment', 'cancelled']
      
      for (let i = 0; i < statuses.length; i++) {
        const orderData = TestDataFactory.createOrder(user.id, {
          status: statuses[i],
          total_amount: (i + 1) * 100,
          payment_amount: (i + 1) * 100
        })
        const order = await Order.create(orderData)
        
        const orderItemData = TestDataFactory.createOrderItem(order.id, product.id, {
          price: (i + 1) * 100,
          quantity: 1,
          subtotal: (i + 1) * 100
        })
        await OrderItem.create(orderItemData)
      }
      
      req = {
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回销售统计数据', async () => {
      await StatisticsController.getSalesStatistics(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      
      expect(responseData).toHaveProperty('total_sales')
      expect(responseData).toHaveProperty('completed_orders')
      expect(responseData).toHaveProperty('total_revenue')
      
      // 只有completed状态的订单计入销售额：100 + 200 = 300
      expect(responseData.total_revenue).toBe(300)
      expect(responseData.completed_orders).toBe(2)
    })
    
    it('应该支持按日期范围筛选', async () => {
      const today = new Date()
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
      
      req.query.start_date = yesterday.toISOString()
      req.query.end_date = today.toISOString()
      
      await StatisticsController.getSalesStatistics(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.total_sales).toBeGreaterThanOrEqual(0)
    })
  })
  
  describe('getUserStatistics 获取用户统计', () => {
    let req, res
    
    beforeEach(async () => {
      // 创建不同状态的用户
      for (let i = 0; i < 10; i++) {
        const userData = await TestDataFactory.createUser({
          phone: `1390014${i.toString().padStart(4, '0')}`,
          email: `userstat${i}@example.com`,
          is_active: i < 8
        })
        await User.create(userData)
      }
      
      req = {}
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回用户统计数据', async () => {
      await StatisticsController.getUserStatistics(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      
      expect(responseData).toHaveProperty('total_users')
      expect(responseData).toHaveProperty('active_users')
      expect(responseData).toHaveProperty('inactive_users')
      
      expect(responseData.total_users).toBe(10)
      expect(responseData.active_users).toBe(8)
      expect(responseData.inactive_users).toBe(2)
    })
  })
  
  describe('getProductStatistics 获取商品统计', () => {
    let req, res
    
    beforeEach(async () => {
      const categories = ['电子产品', '服装', '食品']
      
      for (let i = 0; i < 9; i++) {
        const productData = TestDataFactory.createProduct({
          name: `商品${i + 1}`,
          category: categories[i % 3],
          status: i < 6 ? 'active' : 'inactive',
          stock: i < 3 ? 0 : 10
        })
        await Product.create(productData)
      }
      
      req = {}
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回商品统计数据', async () => {
      await StatisticsController.getProductStatistics(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      
      expect(responseData).toHaveProperty('total_products')
      expect(responseData).toHaveProperty('active_products')
      expect(responseData).toHaveProperty('out_of_stock')
      expect(responseData).toHaveProperty('category_count')
      
      expect(responseData.total_products).toBe(9)
      expect(responseData.active_products).toBe(6)
      expect(responseData.out_of_stock).toBe(3)
    })
  })
  
  describe('getTopProducts 获取热销商品', () => {
    let req, res
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      const products = []
      for (let i = 0; i < 5; i++) {
        const productData = TestDataFactory.createProduct({
          name: `热销商品${i + 1}`,
          price: (i + 1) * 100
        })
        const product = await Product.create(productData)
        products.push(product)
      }
      
      // 创建订单和订单项，制造销售数据
      for (let i = 0; i < 3; i++) {
        const orderData = TestDataFactory.createOrder(user.id, {
          status: 'completed'
        })
        const order = await Order.create(orderData)
        
        // 第一个商品卖得最多
        const orderItemData = TestDataFactory.createOrderItem(
          order.id,
          products[0].id,
          {
            quantity: 10,
            price: products[0].price,
            subtotal: products[0].price * 10
          }
        )
        await OrderItem.create(orderItemData)
      }
      
      req = {
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回热销商品列表', async () => {
      await StatisticsController.getTopProducts(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      
      expect(Array.isArray(responseData)).toBe(true)
      expect(responseData.length).toBeGreaterThan(0)
      
      // 第一个应该是销量最高的
      expect(responseData[0]).toHaveProperty('product_name')
      expect(responseData[0]).toHaveProperty('total_sold')
      expect(responseData[0]).toHaveProperty('total_revenue')
    })
    
    it('应该支持限制返回数量', async () => {
      req.query.limit = 3
      
      await StatisticsController.getTopProducts(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.length).toBeLessThanOrEqual(3)
    })
  })
  
  describe('getRecentOrders 获取最近订单', () => {
    let req, res
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      for (let i = 0; i < 10; i++) {
        const orderData = TestDataFactory.createOrder(user.id, {
          order_no: `ORD${Date.now()}${i}`
        })
        await Order.create(orderData)
        
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      
      req = {
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回最近订单', async () => {
      await StatisticsController.getRecentOrders(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      
      expect(Array.isArray(responseData)).toBe(true)
      expect(responseData.length).toBeGreaterThan(0)
    })
    
    it('应该支持限制返回数量', async () => {
      req.query.limit = 5
      
      await StatisticsController.getRecentOrders(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.length).toBeLessThanOrEqual(5)
    })
    
    it('订单应该按时间降序排列', async () => {
      req.query.limit = 10
      
      await StatisticsController.getRecentOrders(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      
      if (responseData.length > 1) {
        const firstOrderDate = new Date(responseData[0].created_at)
        const secondOrderDate = new Date(responseData[1].created_at)
        expect(firstOrderDate.getTime()).toBeGreaterThanOrEqual(secondOrderDate.getTime())
      }
    })
  })
  
  describe('getSalesTrend 获取销售趋势', () => {
    let req, res
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      // 创建不同日期的订单
      const today = new Date()
      
      for (let i = 0; i < 7; i++) {
        const orderDate = new Date(today.getTime() - i * 24 * 60 * 60 * 1000)
        
        const orderData = TestDataFactory.createOrder(user.id, {
          status: 'completed',
          payment_amount: (i + 1) * 100,
          created_at: orderDate
        })
        await Order.create(orderData)
      }
      
      req = {
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回销售趋势数据', async () => {
      await StatisticsController.getSalesTrend(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      
      expect(Array.isArray(responseData)).toBe(true)
      expect(responseData.length).toBeGreaterThan(0)
      
      if (responseData.length > 0) {
        expect(responseData[0]).toHaveProperty('date')
        expect(responseData[0]).toHaveProperty('order_count')
        expect(responseData[0]).toHaveProperty('revenue')
      }
    })
    
    it('应该支持按天统计', async () => {
      req.query.period = 'day'
      req.query.days = 7
      
      await StatisticsController.getSalesTrend(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.length).toBeLessThanOrEqual(7)
    })
    
    it('应该支持按月统计', async () => {
      req.query.period = 'month'
      req.query.months = 6
      
      await StatisticsController.getSalesTrend(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
    })
  })
})
