import { describe, it, expect, beforeEach, vi } from 'vitest'
import OrderController from '@server/controllers/orderController.js'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('OrderController 单元测试', () => {
  let sequelize, Order, OrderItem, Product, User, Address
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    
    Order = sequelize.models.Order
    OrderItem = sequelize.models.OrderItem
    Product = sequelize.models.Product
    User = sequelize.models.User
    Address = sequelize.models.Address
  })
  
  describe('createOrder 创建订单', () => {
    let req, res, testUser, testProducts, testAddress
    
    beforeEach(async () => {
      // 创建测试用户
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      // 创建测试商品
      testProducts = []
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          name: `商品${i + 1}`,
          price: (i + 1) * 100,
          stock: 10
        })
        const product = await Product.create(productData)
        testProducts.push(product)
      }
      
      // 创建测试地址
      const addressData = TestDataFactory.createAddress(testUser.id)
      testAddress = await Address.create(addressData)
      
      req = {
        user: testUser,
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('登录用户应该能创建订单', async () => {
      req.body = {
        address_id: testAddress.id,
        items: [
          {
            product_id: testProducts[0].id,
            quantity: 2
          }
        ],
        payment_method: 'alipay'
      }
      
      await OrderController.createOrder(req, res)
      
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '订单创建成功',
        data: expect.objectContaining({
          order_no: expect.any(String),
          total_amount: expect.any(Number),
          status: 'pending_payment'
        })
      })
    })
    
    it('游客应该能创建订单并自动注册', async () => {
      req.user = null
      req.body = {
        nickname: '游客用户',
        country_code: '+86',
        phone: '13900139999',
        email: 'guest@example.com',
        password: '123456',
        province: '广东省',
        city: '深圳市',
        district: '南山区',
        detail_address: '科技园南区',
        postal_code: '518000',
        contact_name: '张三',
        contact_phone: '13900139999',
        items: [
          {
            product_id: testProducts[0].id,
            quantity: 1
          }
        ],
        payment_method: 'wechat'
      }
      
      await OrderController.createOrder(req, res)
      
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '订单创建成功',
        data: expect.objectContaining({
          order_no: expect.any(String),
          delivery_address: expect.stringContaining('518000')
        })
      })
    })
    
    it('应该检查商品库存', async () => {
      req.body = {
        address_id: testAddress.id,
        items: [
          {
            product_id: testProducts[0].id,
            quantity: 999 // 超过库存
          }
        ]
      }
      
      await OrderController.createOrder(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('库存不足')
      })
    })
    
    it('应该验证必填字段', async () => {
      req.body = {
        // 缺少items
        address_id: testAddress.id
      }
      
      await OrderController.createOrder(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('订单商品不能为空')
      })
    })
    
    it('应该正确计算订单总额', async () => {
      req.body = {
        address_id: testAddress.id,
        items: [
          {
            product_id: testProducts[0].id,
            quantity: 2
          },
          {
            product_id: testProducts[1].id,
            quantity: 1
          }
        ]
      }
      
      await OrderController.createOrder(req, res)
      
      expect(res.status).toHaveBeenCalledWith(201)
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.total_amount).toBe(400) // 100*2 + 200*1
    })
    
    it('应该扣减商品库存', async () => {
      const originalStock = testProducts[0].stock
      
      req.body = {
        address_id: testAddress.id,
        items: [
          {
            product_id: testProducts[0].id,
            quantity: 3
          }
        ]
      }
      
      await OrderController.createOrder(req, res)
      
      await testProducts[0].reload()
      expect(testProducts[0].stock).toBe(originalStock - 3)
    })
    
    it('应该处理推荐码', async () => {
      req.user = null
      req.body = {
        nickname: '推荐用户',
        country_code: '+86',
        phone: '13900130001',
        email: 'referred@example.com',
        password: '123456',
        referral_code: 'FRIEND2024',
        province: '北京市',
        city: '北京市',
        district: '朝阳区',
        detail_address: '建国门外大街1号',
        postal_code: '100000',
        contact_name: '李四',
        contact_phone: '13900130001',
        items: [
          {
            product_id: testProducts[0].id,
            quantity: 1
          }
        ]
      }
      
      await OrderController.createOrder(req, res)
      
      expect(res.status).toHaveBeenCalledWith(201)
      
      // 验证用户的推荐码被记录
      const createdUser = await User.findOne({
        where: { phone: '13900130001' }
      })
      expect(createdUser.referral_from).toBe('FRIEND2024')
    })
  })
  
  describe('getUserOrders 获取用户订单', () => {
    let req, res, testUser, testOrders
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      // 创建多个订单
      testOrders = []
      for (let i = 0; i < 3; i++) {
        const orderData = TestDataFactory.createOrder(testUser.id, {
          order_no: `ORD${Date.now()}${i}`,
          status: i === 0 ? 'pending_payment' : 'completed'
        })
        const order = await Order.create(orderData)
        testOrders.push(order)
        
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      
      req = {
        user: testUser,
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回用户的所有订单', async () => {
      await OrderController.getUserOrders(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          orders: expect.any(Array),
          total: 3
        })
      })
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.orders).toHaveLength(3)
    })
    
    it('应该支持按状态筛选', async () => {
      req.query.status = 'pending_payment'
      
      await OrderController.getUserOrders(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.orders).toHaveLength(1)
      expect(responseData.orders[0].status).toBe('pending_payment')
    })
    
    it('应该支持分页', async () => {
      req.query.page = 1
      req.query.page_size = 2
      
      await OrderController.getUserOrders(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.orders.length).toBeLessThanOrEqual(2)
      expect(responseData.total).toBe(3)
    })
    
    it('应该包含订单项信息', async () => {
      // 为第一个订单创建订单项
      const productData = TestDataFactory.createProduct()
      const product = await Product.create(productData)
      
      const orderItemData = TestDataFactory.createOrderItem(
        testOrders[0].id,
        product.id
      )
      await OrderItem.create(orderItemData)
      
      await OrderController.getUserOrders(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      const orderWithItems = responseData.orders.find(o => o.id === testOrders[0].id)
      expect(orderWithItems.OrderItems).toBeDefined()
    })
  })
  
  describe('getOrderById 获取订单详情', () => {
    let req, res, testUser, testOrder
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const orderData = TestDataFactory.createOrder(testUser.id)
      testOrder = await Order.create(orderData)
      
      req = {
        user: testUser,
        params: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回订单详情', async () => {
      req.params.id = testOrder.id
      
      await OrderController.getOrderById(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: testOrder.id,
          order_no: testOrder.order_no
        })
      })
    })
    
    it('应该拒绝访问其他用户的订单', async () => {
      // 创建另一个用户的订单
      const otherUserData = await TestDataFactory.createUser({
        phone: '13900130002',
        email: 'other@example.com'
      })
      const otherUser = await User.create(otherUserData)
      
      const otherOrderData = TestDataFactory.createOrder(otherUser.id)
      const otherOrder = await Order.create(otherOrderData)
      
      req.params.id = otherOrder.id
      
      await OrderController.getOrderById(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '订单不存在'
      })
    })
    
    it('应该返回404当订单不存在', async () => {
      req.params.id = 99999
      
      await OrderController.getOrderById(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '订单不存在'
      })
    })
  })
  
  describe('cancelOrder 取消订单', () => {
    let req, res, testUser, testOrder, testProduct
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const productData = TestDataFactory.createProduct({ stock: 10 })
      testProduct = await Product.create(productData)
      
      const orderData = TestDataFactory.createOrder(testUser.id, {
        status: 'pending_payment'
      })
      testOrder = await Order.create(orderData)
      
      // 创建订单项
      const orderItemData = TestDataFactory.createOrderItem(
        testOrder.id,
        testProduct.id,
        { quantity: 3 }
      )
      await OrderItem.create(orderItemData)
      
      // 扣减库存
      await testProduct.update({ stock: 7 })
      
      req = {
        user: testUser,
        params: { id: testOrder.id },
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该能取消待支付订单', async () => {
      req.body.cancel_reason = '不想要了'
      
      await OrderController.cancelOrder(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '订单取消成功'
      })
      
      await testOrder.reload()
      expect(testOrder.status).toBe('cancelled')
      expect(testOrder.cancel_reason).toBe('不想要了')
    })
    
    it('应该恢复商品库存', async () => {
      req.body.cancel_reason = '取消订单'
      
      await OrderController.cancelOrder(req, res)
      
      await testProduct.reload()
      expect(testProduct.stock).toBe(10) // 7 + 3
    })
    
    it('应该拒绝取消已发货订单', async () => {
      await testOrder.update({ status: 'shipped' })
      
      req.body.cancel_reason = '取消'
      
      await OrderController.cancelOrder(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('无法取消')
      })
    })
    
    it('应该拒绝取消其他用户的订单', async () => {
      const otherUserData = await TestDataFactory.createUser({
        phone: '13900130003',
        email: 'other2@example.com'
      })
      const otherUser = await User.create(otherUserData)
      
      const otherOrderData = TestDataFactory.createOrder(otherUser.id)
      const otherOrder = await Order.create(otherOrderData)
      
      req.params.id = otherOrder.id
      req.body.cancel_reason = '取消'
      
      await OrderController.cancelOrder(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
    })
  })
  
  describe('getAllOrders 管理员获取所有订单', () => {
    let req, res, testUsers, testOrders
    
    beforeEach(async () => {
      testUsers = []
      testOrders = []
      
      // 创建多个用户和订单
      for (let i = 0; i < 3; i++) {
        const userData = await TestDataFactory.createUser({
          phone: `1390013${i.toString().padStart(4, '0')}`,
          email: `adminorder${i}@example.com`
        })
        const user = await User.create(userData)
        testUsers.push(user)
        
        for (let j = 0; j < 2; j++) {
          const orderData = TestDataFactory.createOrder(user.id, {
            order_no: `ORD${Date.now()}${i}${j}`,
            status: j === 0 ? 'pending_payment' : 'completed'
          })
          const order = await Order.create(orderData)
          testOrders.push(order)
          
          await new Promise(resolve => setTimeout(resolve, 5))
        }
      }
      
      req = {
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回所有订单', async () => {
      await OrderController.getAllOrders(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.orders.length).toBeGreaterThan(0)
      expect(responseData.total).toBe(6)
    })
    
    it('应该支持按状态筛选', async () => {
      req.query.status = 'completed'
      
      await OrderController.getAllOrders(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.orders.every(o => o.status === 'completed')).toBe(true)
    })
    
    it('应该支持按用户筛选', async () => {
      req.query.user_id = testUsers[0].id
      
      await OrderController.getAllOrders(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.orders.every(o => o.user_id === testUsers[0].id)).toBe(true)
    })
    
    it('应该支持按订单号搜索', async () => {
      const targetOrder = testOrders[0]
      req.query.order_no = targetOrder.order_no
      
      await OrderController.getAllOrders(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.orders).toHaveLength(1)
      expect(responseData.orders[0].order_no).toBe(targetOrder.order_no)
    })
    
    it('应该支持按手机号搜索', async () => {
      const targetOrder = testOrders[0]
      req.query.contact_phone = targetOrder.contact_phone
      
      await OrderController.getAllOrders(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.orders.length).toBeGreaterThan(0)
      expect(responseData.orders.some(o => o.contact_phone === targetOrder.contact_phone)).toBe(true)
    })
    
    it('应该支持分页', async () => {
      req.query.page = 1
      req.query.page_size = 3
      
      await OrderController.getAllOrders(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.orders.length).toBeLessThanOrEqual(3)
    })
  })
  
  describe('updateOrderStatus 更新订单状态', () => {
    let req, res, testUser, testOrder
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const orderData = TestDataFactory.createOrder(testUser.id, {
        status: 'pending_payment'
      })
      testOrder = await Order.create(orderData)
      
      req = {
        params: { id: testOrder.id },
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该能更新订单状态', async () => {
      req.body.status = 'pending_shipment'
      
      await OrderController.updateOrderStatus(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '订单状态更新成功'
      })
      
      await testOrder.reload()
      expect(testOrder.status).toBe('pending_shipment')
    })
    
    it('应该能更新物流信息', async () => {
      await testOrder.update({ status: 'pending_shipment' })
      
      req.body.status = 'shipped'
      req.body.shipping_company = '顺丰快递'
      req.body.shipping_no = 'SF1234567890'
      
      await OrderController.updateOrderStatus(req, res)
      
      await testOrder.reload()
      expect(testOrder.status).toBe('shipped')
      expect(testOrder.shipping_company).toBe('顺丰快递')
      expect(testOrder.shipping_no).toBe('SF1234567890')
    })
    
    it('应该验证状态转换的合法性', async () => {
      // 待支付状态不能直接变为已发货
      req.body.status = 'shipped'
      
      await OrderController.updateOrderStatus(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('状态转换')
      })
    })
    
    it('应该返回404当订单不存在', async () => {
      req.params.id = 99999
      req.body.status = 'shipped'
      
      await OrderController.updateOrderStatus(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
    })
  })
  
  describe('getOrderStatistics 订单统计', () => {
    let req, res
    
    beforeEach(async () => {
      // 创建测试数据
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      const statuses = ['pending_payment', 'pending_shipment', 'shipped', 'completed', 'cancelled']
      
      for (const status of statuses) {
        for (let i = 0; i < 2; i++) {
          const orderData = TestDataFactory.createOrder(user.id, {
            status,
            total_amount: 100,
            payment_amount: 100
          })
          await Order.create(orderData)
        }
      }
      
      req = {
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回订单统计数据', async () => {
      await OrderController.getOrderStatistics(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      
      expect(responseData).toHaveProperty('total_orders')
      expect(responseData).toHaveProperty('total_amount')
      expect(responseData).toHaveProperty('status_count')
      expect(responseData.total_orders).toBe(10)
    })
    
    it('应该支持按日期范围统计', async () => {
      const today = new Date()
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
      
      req.query.start_date = yesterday.toISOString()
      req.query.end_date = today.toISOString()
      
      await OrderController.getOrderStatistics(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.total_orders).toBeGreaterThan(0)
    })
  })
})
