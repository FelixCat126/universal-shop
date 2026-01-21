import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

describe('订单管理 API', () => {
  let sequelize
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
  })
  
  describe('POST /api/orders - 创建订单', () => {
    let testUser, testProduct, authToken
    
    beforeEach(async () => {
      const { User, Product } = sequelize.models
      
      // 创建测试用户
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
      
      // 创建测试商品
      const productData = TestDataFactory.createProduct({ stock: 10, price: 100 })
      testProduct = await Product.create(productData)
    })
    
    it('应该成功创建订单（已登录用户）', async () => {
      const orderData = {
        items: [{
          product_id: testProduct.id,
          quantity: 2
        }],
        contact_name: '测试收货人',
        contact_phone: '13800138001',
        delivery_address: '测试地址',
        province: '北京市',
        city: '北京市', 
        district: '朝阳区',
        postal_code: '100000'
      }
      
      const response = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(orderData)
        .expect(201)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.order.user_id).toBe(testUser.id)
      expect(response.body.data.order.total_amount).toBe(200) // 100 * 2
      expect(response.body.data.order.contact_name).toBe('测试收货人')
      expect(response.body.data.order.order_no).toBeDefined()
      
      // 验证商品库存被正确扣减
      await testProduct.reload()
      expect(testProduct.stock).toBe(8)
      
      // 验证订单项被创建
      const { OrderItem } = sequelize.models
      const orderItems = await OrderItem.findAll({
        where: { order_id: response.body.data.order.id }
      })
      expect(orderItems).toHaveLength(1)
      expect(orderItems[0].quantity).toBe(2)
      expect(orderItems[0].price).toBe(100)
    })
    
    it('应该支持游客下单（自动注册用户）', async () => {
      const orderData = {
        items: [{
          product_id: testProduct.id,
          quantity: 1
        }],
        contact_name: '游客用户',
        contact_phone: '13800138002',
        delivery_address: '游客地址',
        user_info: {
          nickname: '游客',
          country_code: '+86',
          phone: '13800138002',
          password: '123456'
        }
      }
      
      const response = await request(app)
        .post('/api/orders')
        .send(orderData)
        .expect(201)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.order.user_id).toBeDefined()
      
      // 验证自动创建了用户
      const { User } = sequelize.models
      const createdUser = await User.findByPk(response.body.data.order.user_id)
      expect(createdUser.phone).toBe('13800138002')
      expect(createdUser.nickname).toBe('游客')
    })
    
    it('应该支持游客使用推荐码下单', async () => {
      const orderData = {
        items: [{
          product_id: testProduct.id,
          quantity: 1
        }],
        contact_name: '游客用户',
        contact_phone: '13800138003',
        delivery_address: '游客地址',
        user_info: {
          nickname: '推荐游客',
          country_code: '+86',
          phone: '13800138003',
          password: '123456',
          referral_code: 'FRIEND123'
        }
      }
      
      const response = await request(app)
        .post('/api/orders')
        .send(orderData)
        .expect(201)
      
      // 验证推荐码被正确保存
      const { User } = sequelize.models
      const createdUser = await User.findByPk(response.body.data.order.user_id)
      expect(createdUser.referral_from).toBe('FRIEND123')
    })
    
    it('应该检查库存不足', async () => {
      const orderData = {
        items: [{
          product_id: testProduct.id,
          quantity: 20 // 超过库存
        }],
        contact_name: '测试收货人',
        contact_phone: '13800138001',
        delivery_address: '测试地址'
      }
      
      const response = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(orderData)
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('库存不足')
      
      // 验证库存没有被扣减
      await testProduct.reload()
      expect(testProduct.stock).toBe(10)
    })
    
    it('应该检查商品是否存在', async () => {
      const orderData = {
        items: [{
          product_id: 99999, // 不存在的商品ID
          quantity: 1
        }],
        contact_name: '测试收货人',
        contact_phone: '13800138001',
        delivery_address: '测试地址'
      }
      
      const response = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(orderData)
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('不存在')
    })
    
    it('应该验证必填字段', async () => {
      const orderData = {
        items: [{
          product_id: testProduct.id,
          quantity: 1
        }]
        // 缺少收货信息
      }
      
      const response = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(orderData)
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('收货信息不能为空')
    })
    
    it('应该正确计算折扣价格', async () => {
      // 创建有折扣的商品
      const { Product } = sequelize.models
      const discountProductData = TestDataFactory.createProduct({ 
        price: 100, 
        discount: 20, // 20%折扣
        stock: 10 
      })
      const discountProduct = await Product.create(discountProductData)
      
      const orderData = {
        items: [{
          product_id: discountProduct.id,
          quantity: 1
        }],
        contact_name: '测试收货人',
        contact_phone: '13800138001',
        delivery_address: '测试地址'
      }
      
      const response = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(orderData)
        .expect(201)
      
      // 折扣后价格应该是80
      expect(response.body.data.order.total_amount).toBe(80)
      
      // 验证订单项价格
      const { OrderItem } = sequelize.models
      const orderItem = await OrderItem.findOne({
        where: { order_id: response.body.data.order.id }
      })
      expect(orderItem.price).toBe(80) // 实际支付价格
      expect(orderItem.original_price).toBe(100) // 原价
      expect(orderItem.discount).toBe(20) // 折扣百分比
    })
    
    it('应该支持多商品订单', async () => {
      const { Product } = sequelize.models
      
      // 创建第二个商品
      const product2Data = TestDataFactory.createProduct({ stock: 5, price: 50 })
      const product2 = await Product.create(product2Data)
      
      const orderData = {
        items: [
          { product_id: testProduct.id, quantity: 2 },
          { product_id: product2.id, quantity: 1 }
        ],
        contact_name: '测试收货人',
        contact_phone: '13800138001',
        delivery_address: '测试地址'
      }
      
      const response = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(orderData)
        .expect(201)
      
      // 总金额应该是 (100*2) + (50*1) = 250
      expect(response.body.data.order.total_amount).toBe(250)
      
      // 验证两个订单项都被创建
      const { OrderItem } = sequelize.models
      const orderItems = await OrderItem.findAll({
        where: { order_id: response.body.data.order.id }
      })
      expect(orderItems).toHaveLength(2)
    })
  })
  
  describe('GET /api/orders - 查询订单', () => {
    let testUser, authToken, testOrders
    
    beforeEach(async () => {
      const { User, Order } = sequelize.models
      
      // 创建测试用户
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
      
      // 创建几个测试订单
      testOrders = []
      for (let i = 0; i < 3; i++) {
        const orderData = TestDataFactory.createOrder(testUser.id, {
          order_no: `TEST${Date.now()}-${i}`,
          total_amount: (i + 1) * 100
        })
        const order = await Order.create(orderData)
        testOrders.push(order)
      }
    })
    
    it('应该返回用户的订单列表', async () => {
      const response = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.orders).toHaveLength(3)
      
      // 验证所有订单都属于当前用户
      response.body.data.orders.forEach(order => {
        expect(order.user_id).toBe(testUser.id)
      })
      
      // 验证分页信息
      expect(response.body.data.pagination).toBeDefined()
      expect(response.body.data.pagination.total).toBe(3)
    })
    
    it('应该支持分页查询', async () => {
      const response = await request(app)
        .get('/api/orders?page=1&pageSize=2')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.orders).toHaveLength(2)
      expect(response.body.data.pagination.page).toBe(1)
      expect(response.body.data.pagination.pageSize).toBe(2)
      expect(response.body.data.pagination.total).toBe(3)
    })
    
    it('应该支持按状态筛选', async () => {
      // 更新一个订单的状态
      await testOrders[0].update({ status: 'confirmed' })
      
      const response = await request(app)
        .get('/api/orders?status=confirmed')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.orders).toHaveLength(1)
      expect(response.body.data.orders[0].status).toBe('confirmed')
    })
    
    it('应该拒绝未认证的请求', async () => {
      const response = await request(app)
        .get('/api/orders')
        .expect(401)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('认证令牌')
    })
    
    it('应该只返回当前用户的订单', async () => {
      // 创建另一个用户和订单
      const { User, Order } = sequelize.models
      const otherUserData = await TestDataFactory.createUser({
        phone: '13900139001',
        email: 'other@example.com'
      })
      const otherUser = await User.create(otherUserData)
      
      const otherOrderData = TestDataFactory.createOrder(otherUser.id)
      await Order.create(otherOrderData)
      
      const response = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      // 应该只返回当前用户的3个订单，不包括其他用户的订单
      expect(response.body.data.orders).toHaveLength(3)
      response.body.data.orders.forEach(order => {
        expect(order.user_id).toBe(testUser.id)
      })
    })
  })
  
  describe('GET /api/orders/:id - 查询单个订单', () => {
    let testUser, authToken, testOrder
    
    beforeEach(async () => {
      const { User, Order } = sequelize.models
      
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
      
      const orderData = TestDataFactory.createOrder(testUser.id)
      testOrder = await Order.create(orderData)
    })
    
    it('应该返回订单详情', async () => {
      const response = await request(app)
        .get(`/api/orders/${testOrder.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBe(testOrder.id)
      expect(response.body.data.user_id).toBe(testUser.id)
    })
    
    it('应该拒绝访问其他用户的订单', async () => {
      // 创建另一个用户的订单
      const { User, Order } = sequelize.models
      const otherUserData = await TestDataFactory.createUser({
        phone: '13900139002',
        email: 'other2@example.com'
      })
      const otherUser = await User.create(otherUserData)
      
      const otherOrderData = TestDataFactory.createOrder(otherUser.id)
      const otherOrder = await Order.create(otherOrderData)
      
      const response = await request(app)
        .get(`/api/orders/${otherOrder.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404)
      
      expect(response.body.success).toBe(false)
    })
    
    it('应该返回404对于不存在的订单', async () => {
      const response = await request(app)
        .get('/api/orders/99999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('订单不存在')
    })
  })
})
