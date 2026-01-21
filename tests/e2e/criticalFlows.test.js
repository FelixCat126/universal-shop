import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

describe('关键业务流程 E2E 测试', () => {
  let sequelize
  let testProducts = []
  
  beforeAll(async () => {
    sequelize = TestDatabase.getSequelize()
  })
  
  beforeEach(async () => {
    await TestDatabase.clearAllData()
    
    // 创建测试商品
    const { Product } = sequelize.models
    testProducts = []
    
    for (let i = 1; i <= 3; i++) {
      const productData = TestDataFactory.createProduct({
        name: `测试商品${i}`,
        price: i * 100,
        stock: 10,
        status: 'active'
      })
      const product = await Product.create(productData)
      testProducts.push(product)
    }
  })
  
  describe('完整购买流程 - 新用户注册下单', () => {
    it('应该完成从注册到下单的完整流程', async () => {
      // Step 1: 用户注册
      console.log('🔄 Step 1: 用户注册')
      const userData = {
        nickname: '测试用户',
        country_code: '+86',
        phone: TestHelpers.generatePhoneNumber('+86'),
        email: TestHelpers.generateEmail(),
        password: '123456',
        referral_code: 'FRIEND2024'
      }
      
      const registerResponse = await request(app)
        .post('/api/users/register')
        .send(userData)
        .expect(201)
      
      expect(registerResponse.body.success).toBe(true)
      expect(registerResponse.body.data.token).toBeDefined()
      expect(registerResponse.body.data.user.email).toBe(userData.email)
      
      const { userId, token } = {
        userId: registerResponse.body.data.user.id,
        token: registerResponse.body.data.token
      }
      
      // Step 2: 验证用户认证
      console.log('🔄 Step 2: 验证用户认证')
      const verifyResponse = await request(app)
        .get('/api/users/verify')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      
      expect(verifyResponse.body.success).toBe(true)
      expect(verifyResponse.body.data.user.id).toBe(userId)
      
      // Step 3: 查看商品列表
      console.log('🔄 Step 3: 查看商品列表')
      const productsResponse = await request(app)
        .get('/api/products')
        .expect(200)
      
      expect(productsResponse.body.success).toBe(true)
      expect(productsResponse.body.data.products.length).toBeGreaterThan(0)
      
      // Step 4: 添加商品到购物车
      console.log('🔄 Step 4: 添加商品到购物车')
      const cartItems = [
        { product_id: testProducts[0].id, quantity: 2 },
        { product_id: testProducts[1].id, quantity: 1 }
      ]
      
      for (const item of cartItems) {
        const addToCartResponse = await request(app)
          .post('/api/cart/add')
          .set('Authorization', `Bearer ${token}`)
          .send(item)
          .expect(200)
        
        expect(addToCartResponse.body.success).toBe(true)
      }
      
      // Step 5: 查看购物车
      console.log('🔄 Step 5: 查看购物车')
      const cartResponse = await request(app)
        .get('/api/cart')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      
      expect(cartResponse.body.success).toBe(true)
      expect(cartResponse.body.data.items).toHaveLength(2)
      
      const totalAmount = cartResponse.body.data.items.reduce(
        (sum, item) => sum + (item.Product.price * item.quantity), 0
      )
      
      // Step 6: 创建地址
      console.log('🔄 Step 6: 创建收货地址')
      const addressData = {
        province: '北京市',
        city: '北京市',
        district: '朝阳区',
        detail_address: '测试街道123号',
        postal_code: '100000',
        contact_name: '测试收货人',
        contact_phone: '13800138001',
        is_default: true
      }
      
      const addressResponse = await request(app)
        .post('/api/addresses')
        .set('Authorization', `Bearer ${token}`)
        .send(addressData)
        .expect(201)
      
      expect(addressResponse.body.success).toBe(true)
      expect(addressResponse.body.data.id).toBeDefined()
      
      const addressId = addressResponse.body.data.id
      
      // Step 7: 创建订单
      console.log('🔄 Step 7: 创建订单')
      const orderData = {
        items: cartItems,
        address_id: addressId,
        notes: '测试订单备注'
      }
      
      const orderResponse = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send(orderData)
        .expect(201)
      
      expect(orderResponse.body.success).toBe(true)
      expect(orderResponse.body.data.order.user_id).toBe(userId)
      expect(orderResponse.body.data.order.total_amount).toBe(totalAmount)
      expect(orderResponse.body.data.order.status).toBe('pending')
      expect(orderResponse.body.data.order.order_no).toBeDefined()
      
      const orderId = orderResponse.body.data.order.id
      
      // Step 8: 验证订单详情
      console.log('🔄 Step 8: 验证订单详情')
      const orderDetailResponse = await request(app)
        .get(`/api/orders/${orderId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      
      expect(orderDetailResponse.body.success).toBe(true)
      expect(orderDetailResponse.body.data.id).toBe(orderId)
      expect(orderDetailResponse.body.data.province).toBe('北京市')
      expect(orderDetailResponse.body.data.city).toBe('北京市')
      expect(orderDetailResponse.body.data.district).toBe('朝阳区')
      expect(orderDetailResponse.body.data.postal_code).toBe('100000')
      expect(orderDetailResponse.body.data.delivery_address).toContain('100000')
      
      // Step 9: 验证库存扣减
      console.log('🔄 Step 9: 验证库存扣减')
      await testProducts[0].reload()
      await testProducts[1].reload()
      
      expect(testProducts[0].stock).toBe(8) // 10 - 2
      expect(testProducts[1].stock).toBe(9) // 10 - 1
      
      // Step 10: 验证购物车已清空
      console.log('🔄 Step 10: 验证购物车已清空')
      const emptyCartResponse = await request(app)
        .get('/api/cart')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      
      expect(emptyCartResponse.body.data.items).toHaveLength(0)
      
      // Step 11: 查看用户订单列表
      console.log('🔄 Step 11: 查看用户订单列表')
      const ordersResponse = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      
      expect(ordersResponse.body.success).toBe(true)
      expect(ordersResponse.body.data.orders).toHaveLength(1)
      expect(ordersResponse.body.data.orders[0].id).toBe(orderId)
      
      console.log('✅ 完整购买流程测试通过')
    })
  })
  
  describe('游客下单流程', () => {
    it('应该支持游客直接下单并自动注册', async () => {
      // Step 1: 游客下单（包含用户信息）
      console.log('🔄 Step 1: 游客下单')
      const guestOrderData = {
        items: [{
          product_id: testProducts[0].id,
          quantity: 1
        }],
        contact_name: '游客用户',
        contact_phone: '13900139001',
        delivery_address: '游客地址详情',
        province: '上海市',
        city: '上海市',
        district: '浦东新区',
        postal_code: '200000',
        user_info: {
          nickname: '游客测试',
          country_code: '+86',
          phone: '13900139001',
          password: '123456',
          referral_code: 'GUEST2024'
        }
      }
      
      const orderResponse = await request(app)
        .post('/api/orders')
        .send(guestOrderData)
        .expect(201)
      
      expect(orderResponse.body.success).toBe(true)
      expect(orderResponse.body.data.order.user_id).toBeDefined()
      expect(orderResponse.body.data.order.contact_name).toBe('游客用户')
      expect(orderResponse.body.data.order.province).toBe('上海市')
      expect(orderResponse.body.data.order.delivery_address).toContain('200000')
      
      const createdUserId = orderResponse.body.data.order.user_id
      
      // Step 2: 验证自动创建的用户
      console.log('🔄 Step 2: 验证自动创建的用户')
      const { User } = sequelize.models
      const createdUser = await User.findByPk(createdUserId)
      
      expect(createdUser).toBeTruthy()
      expect(createdUser.nickname).toBe('游客测试')
      expect(createdUser.phone).toBe('13900139001')
      expect(createdUser.referral_from).toBe('GUEST2024')
      
      // Step 3: 验证用户可以用创建的账号登录
      console.log('🔄 Step 3: 验证用户可以登录')
      const loginResponse = await request(app)
        .post('/api/users/login')
        .send({
          country_code: '+86',
          phone: '13900139001',
          password: '123456'
        })
        .expect(200)
      
      expect(loginResponse.body.success).toBe(true)
      expect(loginResponse.body.data.token).toBeDefined()
      expect(loginResponse.body.data.user.id).toBe(createdUserId)
      
      // Step 4: 登录后查看订单
      console.log('🔄 Step 4: 登录后查看订单')
      const token = loginResponse.body.data.token
      const ordersResponse = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      
      expect(ordersResponse.body.success).toBe(true)
      expect(ordersResponse.body.data.orders).toHaveLength(1)
      expect(ordersResponse.body.data.orders[0].user_id).toBe(createdUserId)
      
      console.log('✅ 游客下单流程测试通过')
    })
  })
  
  describe('用户登录购物流程', () => {
    it('应该支持已有用户登录后购物', async () => {
      // Step 1: 创建测试用户
      console.log('🔄 Step 1: 创建测试用户和地址')
      const { user, address } = await TestHelpers.createUserWithAddress()
      
      // Step 2: 用户登录
      console.log('🔄 Step 2: 用户登录')
      const loginResponse = await request(app)
        .post('/api/users/login')
        .send({
          country_code: user.country_code,
          phone: user.phone,
          password: '123456'
        })
        .expect(200)
      
      expect(loginResponse.body.success).toBe(true)
      const token = loginResponse.body.data.token
      
      // Step 3: 添加多个商品到购物车
      console.log('🔄 Step 3: 添加商品到购物车')
      const cartOperations = [
        { product_id: testProducts[0].id, quantity: 1 },
        { product_id: testProducts[1].id, quantity: 2 },
        { product_id: testProducts[2].id, quantity: 1 }
      ]
      
      for (const operation of cartOperations) {
        await request(app)
          .post('/api/cart/add')
          .set('Authorization', `Bearer ${token}`)
          .send(operation)
          .expect(200)
      }
      
      // Step 4: 修改购物车数量
      console.log('🔄 Step 4: 修改购物车数量')
      await request(app)
        .put('/api/cart/update')
        .set('Authorization', `Bearer ${token}`)
        .send({
          product_id: testProducts[0].id,
          quantity: 3
        })
        .expect(200)
      
      // Step 5: 删除一个商品
      console.log('🔄 Step 5: 删除购物车商品')
      await request(app)
        .delete(`/api/cart/remove/${testProducts[2].id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      
      // Step 6: 查看最终购物车
      console.log('🔄 Step 6: 查看购物车')
      const cartResponse = await request(app)
        .get('/api/cart')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      
      expect(cartResponse.body.data.items).toHaveLength(2)
      
      // Step 7: 使用已有地址下单
      console.log('🔄 Step 7: 使用已有地址下单')
      const orderResponse = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { product_id: testProducts[0].id, quantity: 3 },
            { product_id: testProducts[1].id, quantity: 2 }
          ],
          address_id: address.id
        })
        .expect(201)
      
      expect(orderResponse.body.success).toBe(true)
      expect(orderResponse.body.data.order.contact_name).toBe(address.contact_name)
      expect(orderResponse.body.data.order.contact_phone).toBe(address.contact_phone)
      expect(orderResponse.body.data.order.province).toBe(address.province)
      
      console.log('✅ 已有用户购物流程测试通过')
    })
  })
  
  describe('管理员操作流程', () => {
    it('应该支持管理员查看和管理订单', async () => {
      // Step 1: 创建管理员
      console.log('🔄 Step 1: 创建管理员')
      const admin = await TestHelpers.createAdminUser()
      const adminToken = TestHelpers.generateAdminToken(admin)
      
      // Step 2: 创建一些测试订单
      console.log('🔄 Step 2: 创建测试订单')
      const { user, products, order } = await TestHelpers.createOrderWithItems()
      
      // Step 3: 管理员查看订单列表
      console.log('🔄 Step 3: 管理员查看订单列表')
      const ordersResponse = await request(app)
        .get('/api/admin/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      
      expect(ordersResponse.body.success).toBe(true)
      expect(ordersResponse.body.data.orders).toHaveLength(1)
      
      // Step 4: 管理员查看订单详情
      console.log('🔄 Step 4: 管理员查看订单详情')
      const orderDetailResponse = await request(app)
        .get(`/api/admin/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      
      expect(orderDetailResponse.body.success).toBe(true)
      expect(orderDetailResponse.body.data.id).toBe(order.id)
      
      // Step 5: 管理员更新订单状态
      console.log('🔄 Step 5: 管理员更新订单状态')
      const updateResponse = await request(app)
        .put(`/api/admin/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200)
      
      expect(updateResponse.body.success).toBe(true)
      
      // Step 6: 验证状态更新
      console.log('🔄 Step 6: 验证状态更新')
      await order.reload()
      expect(order.status).toBe('confirmed')
      
      console.log('✅ 管理员操作流程测试通过')
    })
  })
  
  describe('异常情况处理', () => {
    it('应该正确处理库存不足的情况', async () => {
      // Step 1: 创建用户和低库存商品
      console.log('🔄 Step 1: 创建低库存商品')
      const { Product } = sequelize.models
      const lowStockProduct = await Product.create(
        TestDataFactory.createProduct({ stock: 1 })
      )
      
      const userData = await TestDataFactory.createUser()
      const { User } = sequelize.models
      const user = await User.create(userData)
      const token = TestHelpers.generateToken(user)
      
      // Step 2: 尝试购买超出库存的数量
      console.log('🔄 Step 2: 尝试购买超出库存')
      const orderResponse = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [{
            product_id: lowStockProduct.id,
            quantity: 5 // 超出库存
          }],
          contact_name: '测试用户',
          contact_phone: '13800138001',
          delivery_address: '测试地址'
        })
        .expect(400)
      
      expect(orderResponse.body.success).toBe(false)
      expect(orderResponse.body.message).toContain('库存不足')
      
      // Step 3: 验证库存未被扣减
      console.log('🔄 Step 3: 验证库存未变化')
      await lowStockProduct.reload()
      expect(lowStockProduct.stock).toBe(1)
      
      console.log('✅ 库存不足处理测试通过')
    })
  })
})
