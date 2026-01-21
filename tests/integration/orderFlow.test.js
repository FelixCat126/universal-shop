import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'

describe('订单流程集成测试', () => {
  let sequelize, User, Product, Order, OrderItem, Cart, Address
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    
    User = sequelize.models.User
    Product = sequelize.models.Product
    Order = sequelize.models.Order
    OrderItem = sequelize.models.OrderItem
    Cart = sequelize.models.Cart
    Address = sequelize.models.Address
  })
  
  describe('完整订单流程', () => {
    let testUser, testProducts, testAddress
    
    beforeEach(async () => {
      // 创建测试用户
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      // 创建测试商品
      testProducts = []
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          name: `测试商品${i + 1}`,
          price: (i + 1) * 100,
          stock: 10
        })
        const product = await Product.create(productData)
        testProducts.push(product)
      }
      
      // 创建测试地址
      const addressData = TestDataFactory.createAddress(testUser.id)
      testAddress = await Address.create(addressData)
    })
    
    it('应该完成完整的订单流程：加购物车 -> 创建订单 -> 扣减库存', async () => {
      // Step 1: 添加商品到购物车
      const cart1 = await Cart.create({
        user_id: testUser.id,
        product_id: testProducts[0].id,
        quantity: 2
      })
      
      const cart2 = await Cart.create({
        user_id: testUser.id,
        product_id: testProducts[1].id,
        quantity: 1
      })
      
      // 验证购物车
      const cartItems = await Cart.findAll({
        where: { user_id: testUser.id },
        include: [{ model: Product, as: 'Product' }]
      })
      expect(cartItems).toHaveLength(2)
      
      // Step 2: 计算订单总金额
      let totalAmount = 0
      for (const item of cartItems) {
        totalAmount += item.Product.price * item.quantity
      }
      expect(totalAmount).toBe(300) // 2*100 + 1*200
      
      // Step 3: 创建订单
      const orderData = {
        user_id: testUser.id,
        order_no: `ORD${Date.now()}`,
        province: testAddress.province,
        city: testAddress.city,
        district: testAddress.district,
        delivery_address: testAddress.full_address || `${testAddress.province}${testAddress.city}${testAddress.district}${testAddress.detail_address}`,
        contact_name: testAddress.contact_name,
        contact_phone: testAddress.contact_phone,
        postal_code: testAddress.postal_code,
        total_amount: totalAmount,
        payment_amount: totalAmount,
        status: 'pending_payment',
        remark: '测试订单'
      }
      
      const order = await Order.create(orderData)
      expect(order.id).toBeDefined()
      expect(order.total_amount).toBe(totalAmount)
      
      // Step 4: 创建订单项并扣减库存
      const orderItems = []
      for (const cartItem of cartItems) {
        const product = cartItem.Product
        
        // 检查库存
        if (product.stock < cartItem.quantity) {
          throw new Error(`商品 ${product.name} 库存不足`)
        }
        
        // 创建订单项
        const orderItem = await OrderItem.create({
          order_id: order.id,
          product_id: product.id,
          product_name: product.name,
          product_image: product.cover_image,
          price: product.price,
          quantity: cartItem.quantity,
          subtotal: product.price * cartItem.quantity
        })
        orderItems.push(orderItem)
        
        // 扣减库存
        await product.update({
          stock: product.stock - cartItem.quantity
        })
      }
      
      expect(orderItems).toHaveLength(2)
      
      // Step 5: 清空购物车
      await Cart.destroy({
        where: { user_id: testUser.id }
      })
      
      const remainingCartItems = await Cart.findAll({
        where: { user_id: testUser.id }
      })
      expect(remainingCartItems).toHaveLength(0)
      
      // Step 6: 验证库存变化
      await testProducts[0].reload()
      await testProducts[1].reload()
      
      expect(testProducts[0].stock).toBe(8) // 10 - 2
      expect(testProducts[1].stock).toBe(9) // 10 - 1
      
      // Step 7: 验证订单数据完整性
      const createdOrder = await Order.findByPk(order.id, {
        include: [
          {
            model: OrderItem,
            as: 'OrderItems',
            include: [{ model: Product, as: 'Product' }]
          }
        ]
      })
      
      expect(createdOrder.OrderItems).toHaveLength(2)
      expect(createdOrder.total_amount).toBe(300)
      expect(createdOrder.status).toBe('pending_payment')
    })
    
    it('应该处理库存不足的情况', async () => {
      // 创建库存不足的商品
      const lowStockProduct = await Product.create(
        TestDataFactory.createProduct({
          name: '低库存商品',
          price: 100,
          stock: 1
        })
      )
      
      // 尝试购买超过库存的数量
      const cart = await Cart.create({
        user_id: testUser.id,
        product_id: lowStockProduct.id,
        quantity: 5 // 超过库存
      })
      
      // 创建订单时应该检查库存
      const cartItems = await Cart.findAll({
        where: { user_id: testUser.id },
        include: [{ model: Product, as: 'Product' }]
      })
      
      expect(cartItems).toHaveLength(1)
      expect(cartItems[0].Product.stock).toBe(1)
      expect(cartItems[0].quantity).toBe(5)
      
      // 验证库存不足
      expect(cartItems[0].quantity).toBeGreaterThan(cartItems[0].Product.stock)
    })
    
    it('应该支持多地址订单', async () => {
      // 创建多个地址
      const address1Data = TestDataFactory.createAddress(testUser.id, {
        province: '北京市',
        city: '北京市',
        is_default: true
      })
      const address1 = await Address.create(address1Data)
      
      const address2Data = TestDataFactory.createAddress(testUser.id, {
        province: '上海市',
        city: '上海市',
        is_default: false,
        detail_address: '浦东新区陆家嘴'
      })
      const address2 = await Address.create(address2Data)
      
      // 使用不同地址创建订单
      const order1 = await Order.create({
        user_id: testUser.id,
        order_no: `ORD${Date.now()}1`,
        province: address1.province,
        city: address1.city,
        district: address1.district,
        delivery_address: `${address1.province}${address1.city}${address1.district}${address1.detail_address}`,
        contact_name: address1.contact_name,
        contact_phone: address1.contact_phone,
        postal_code: address1.postal_code,
        total_amount: 100,
        payment_amount: 100,
        status: 'pending_payment'
      })
      
      const order2 = await Order.create({
        user_id: testUser.id,
        order_no: `ORD${Date.now()}2`,
        province: address2.province,
        city: address2.city,
        district: address2.district,
        delivery_address: `${address2.province}${address2.city}${address2.district}${address2.detail_address}`,
        contact_name: address2.contact_name,
        contact_phone: address2.contact_phone,
        postal_code: address2.postal_code,
        total_amount: 200,
        payment_amount: 200,
        status: 'pending_payment'
      })
      
      // 验证订单地址不同
      expect(order1.province).toBe('北京市')
      expect(order2.province).toBe('上海市')
      expect(order1.delivery_address).toContain('北京市')
      expect(order2.delivery_address).toContain('浦东新区陆家嘴')
    })
    
    it('应该正确计算订单总额（包括优惠）', async () => {
      // 添加商品到购物车
      await Cart.create({
        user_id: testUser.id,
        product_id: testProducts[0].id,
        quantity: 2
      })
      
      await Cart.create({
        user_id: testUser.id,
        product_id: testProducts[1].id,
        quantity: 1
      })
      
      // 获取购物车商品
      const cartItems = await Cart.findAll({
        where: { user_id: testUser.id },
        include: [{ model: Product, as: 'Product' }]
      })
      
      // 计算总额
      let totalAmount = 0
      for (const item of cartItems) {
        totalAmount += item.Product.price * item.quantity
      }
      
      // 应用优惠（例如：满200减20）
      let discount = 0
      if (totalAmount >= 200) {
        discount = 20
      }
      
      const paymentAmount = totalAmount - discount
      
      // 创建订单
      const order = await Order.create({
        user_id: testUser.id,
        order_no: `ORD${Date.now()}`,
        province: testAddress.province,
        city: testAddress.city,
        district: testAddress.district,
        delivery_address: testAddress.full_address || `${testAddress.province}${testAddress.city}${testAddress.district}${testAddress.detail_address}`,
        contact_name: testAddress.contact_name,
        contact_phone: testAddress.contact_phone,
        postal_code: testAddress.postal_code,
        total_amount: totalAmount,
        discount_amount: discount,
        payment_amount: paymentAmount,
        status: 'pending_payment'
      })
      
      expect(order.total_amount).toBe(300)
      expect(order.discount_amount).toBe(20)
      expect(order.payment_amount).toBe(280)
    })
  })
  
  describe('游客订单流程', () => {
    let testProducts
    
    beforeEach(async () => {
      // 创建测试商品
      testProducts = []
      for (let i = 0; i < 2; i++) {
        const productData = TestDataFactory.createProduct({
          name: `测试商品${i + 1}`,
          price: (i + 1) * 100,
          stock: 10
        })
        const product = await Product.create(productData)
        testProducts.push(product)
      }
    })
    
    it('应该支持游客下单并自动注册', async () => {
      // Step 1: 游客信息
      const guestInfo = {
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
        referral_code: 'GUEST2024'
      }
      
      // Step 2: 自动注册用户
      const existingUser = await User.findOne({
        where: {
          country_code: guestInfo.country_code,
          phone: guestInfo.phone
        }
      })
      
      let user
      if (existingUser) {
        user = existingUser
      } else {
        user = await User.create({
          nickname: guestInfo.nickname,
          country_code: guestInfo.country_code,
          phone: guestInfo.phone,
          email: guestInfo.email,
          password: guestInfo.password,
          referral_from: guestInfo.referral_code
        })
      }
      
      expect(user.id).toBeDefined()
      expect(user.referral_from).toBe('GUEST2024')
      
      // Step 3: 创建订单
      const orderData = {
        user_id: user.id,
        order_no: `ORD${Date.now()}`,
        province: guestInfo.province,
        city: guestInfo.city,
        district: guestInfo.district,
        delivery_address: `${guestInfo.province}${guestInfo.city}${guestInfo.district}${guestInfo.detail_address} ${guestInfo.postal_code}`,
        contact_name: guestInfo.contact_name,
        contact_phone: guestInfo.contact_phone,
        postal_code: guestInfo.postal_code,
        total_amount: testProducts[0].price,
        payment_amount: testProducts[0].price,
        status: 'pending_payment'
      }
      
      const order = await Order.create(orderData)
      
      // Step 4: 创建订单项
      await OrderItem.create({
        order_id: order.id,
        product_id: testProducts[0].id,
        product_name: testProducts[0].name,
        product_image: testProducts[0].cover_image,
        price: testProducts[0].price,
        quantity: 1,
        subtotal: testProducts[0].price
      })
      
      // Step 5: 验证订单完整性
      const createdOrder = await Order.findByPk(order.id, {
        include: [
          { model: User, as: 'User' },
          { model: OrderItem, as: 'OrderItems' }
        ]
      })
      
      expect(createdOrder.User.id).toBe(user.id)
      expect(createdOrder.User.referral_from).toBe('GUEST2024')
      expect(createdOrder.delivery_address).toContain(guestInfo.postal_code)
      expect(createdOrder.OrderItems).toHaveLength(1)
    })
    
    it('游客下单时地址应包含邮编', async () => {
      // 创建游客用户
      const guestUser = await User.create(
        await TestDataFactory.createUser({
          nickname: '游客测试',
          phone: '13900130001',
          email: 'guesttest@example.com'
        })
      )
      
      // 创建订单
      const orderData = {
        user_id: guestUser.id,
        order_no: `ORD${Date.now()}`,
        province: '北京市',
        city: '北京市',
        district: '朝阳区',
        detail_address: '建国门外大街1号',
        postal_code: '100000',
        delivery_address: '北京市北京市朝阳区建国门外大街1号 100000',
        contact_name: '测试用户',
        contact_phone: '13900130001',
        total_amount: 100,
        payment_amount: 100,
        status: 'pending_payment'
      }
      
      const order = await Order.create(orderData)
      
      // 验证邮编存在
      expect(order.postal_code).toBe('100000')
      expect(order.delivery_address).toContain('100000')
    })
  })
  
  describe('订单状态流转', () => {
    let testUser, testProduct, testOrder
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const productData = TestDataFactory.createProduct()
      testProduct = await Product.create(productData)
      
      const addressData = TestDataFactory.createAddress(testUser.id)
      const address = await Address.create(addressData)
      
      const orderData = {
        user_id: testUser.id,
        order_no: `ORD${Date.now()}`,
        province: address.province,
        city: address.city,
        district: address.district,
        delivery_address: `${address.province}${address.city}${address.district}${address.detail_address}`,
        contact_name: address.contact_name,
        contact_phone: address.contact_phone,
        postal_code: address.postal_code,
        total_amount: testProduct.price,
        payment_amount: testProduct.price,
        status: 'pending_payment'
      }
      
      testOrder = await Order.create(orderData)
      
      await OrderItem.create({
        order_id: testOrder.id,
        product_id: testProduct.id,
        product_name: testProduct.name,
        price: testProduct.price,
        quantity: 1,
        subtotal: testProduct.price
      })
    })
    
    it('应该支持订单状态流转：待支付 -> 待发货 -> 已发货 -> 已完成', async () => {
      // 初始状态：待支付
      expect(testOrder.status).toBe('pending_payment')
      
      // 支付完成 -> 待发货
      await testOrder.update({
        status: 'pending_shipment',
        payment_method: 'alipay',
        paid_at: new Date()
      })
      await testOrder.reload()
      expect(testOrder.status).toBe('pending_shipment')
      expect(testOrder.paid_at).toBeDefined()
      
      // 发货 -> 已发货
      await testOrder.update({
        status: 'shipped',
        shipping_company: '顺丰快递',
        shipping_no: 'SF1234567890',
        shipped_at: new Date()
      })
      await testOrder.reload()
      expect(testOrder.status).toBe('shipped')
      expect(testOrder.shipping_no).toBe('SF1234567890')
      expect(testOrder.shipped_at).toBeDefined()
      
      // 完成 -> 已完成
      await testOrder.update({
        status: 'completed',
        completed_at: new Date()
      })
      await testOrder.reload()
      expect(testOrder.status).toBe('completed')
      expect(testOrder.completed_at).toBeDefined()
    })
    
    it('应该支持订单取消并恢复库存', async () => {
      // 记录原始库存
      const originalStock = testProduct.stock
      
      // 扣减库存（模拟支付成功）
      await testProduct.update({
        stock: testProduct.stock - 1
      })
      expect(testProduct.stock).toBe(originalStock - 1)
      
      // 取消订单
      await testOrder.update({
        status: 'cancelled',
        cancelled_at: new Date(),
        cancel_reason: '用户取消'
      })
      
      // 恢复库存
      const orderItems = await OrderItem.findAll({
        where: { order_id: testOrder.id }
      })
      
      for (const item of orderItems) {
        const product = await Product.findByPk(item.product_id)
        await product.update({
          stock: product.stock + item.quantity
        })
      }
      
      // 验证库存恢复
      await testProduct.reload()
      expect(testProduct.stock).toBe(originalStock)
      expect(testOrder.status).toBe('cancelled')
      expect(testOrder.cancel_reason).toBe('用户取消')
    })
    
    it('应该支持订单退款', async () => {
      // 支付订单
      await testOrder.update({
        status: 'pending_shipment',
        payment_method: 'wechat',
        paid_at: new Date()
      })
      
      // 申请退款
      await testOrder.update({
        status: 'refunding',
        refund_reason: '不想要了',
        refund_requested_at: new Date()
      })
      await testOrder.reload()
      expect(testOrder.status).toBe('refunding')
      
      // 退款完成
      await testOrder.update({
        status: 'refunded',
        refund_amount: testOrder.payment_amount,
        refunded_at: new Date()
      })
      await testOrder.reload()
      expect(testOrder.status).toBe('refunded')
      expect(testOrder.refund_amount).toBe(testOrder.payment_amount)
      expect(testOrder.refunded_at).toBeDefined()
    })
  })
  
  describe('订单查询和统计', () => {
    let testUsers, testProducts, testOrders
    
    beforeEach(async () => {
      // 创建多个用户
      testUsers = []
      for (let i = 0; i < 3; i++) {
        const userData = await TestDataFactory.createUser({
          phone: `1390013${i.toString().padStart(4, '0')}`,
          email: `orderuser${i}@example.com`
        })
        const user = await User.create(userData)
        testUsers.push(user)
      }
      
      // 创建多个商品
      testProducts = []
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          name: `订单商品${i + 1}`,
          price: (i + 1) * 100
        })
        const product = await Product.create(productData)
        testProducts.push(product)
      }
      
      // 为每个用户创建订单
      testOrders = []
      const statuses = ['pending_payment', 'pending_shipment', 'shipped', 'completed']
      
      for (let i = 0; i < testUsers.length; i++) {
        const user = testUsers[i]
        const addressData = TestDataFactory.createAddress(user.id)
        const address = await Address.create(addressData)
        
        // 每个用户创建2个订单
        for (let j = 0; j < 2; j++) {
          const orderData = {
            user_id: user.id,
            order_no: `ORD${Date.now()}${i}${j}`,
            province: address.province,
            city: address.city,
            district: address.district,
            delivery_address: `${address.province}${address.city}${address.district}${address.detail_address}`,
            contact_name: address.contact_name,
            contact_phone: address.contact_phone,
            postal_code: address.postal_code,
            total_amount: testProducts[j].price,
            payment_amount: testProducts[j].price,
            status: statuses[i % statuses.length]
          }
          
          const order = await Order.create(orderData)
          testOrders.push(order)
          
          await OrderItem.create({
            order_id: order.id,
            product_id: testProducts[j].id,
            product_name: testProducts[j].name,
            price: testProducts[j].price,
            quantity: 1,
            subtotal: testProducts[j].price
          })
          
          // 延迟一点时间确保订单号不重复
          await new Promise(resolve => setTimeout(resolve, 5))
        }
      }
    })
    
    it('应该能按用户查询订单', async () => {
      const user1Orders = await Order.findAll({
        where: { user_id: testUsers[0].id }
      })
      
      expect(user1Orders).toHaveLength(2)
      user1Orders.forEach(order => {
        expect(order.user_id).toBe(testUsers[0].id)
      })
    })
    
    it('应该能按状态查询订单', async () => {
      const completedOrders = await Order.findAll({
        where: { status: 'completed' }
      })
      
      completedOrders.forEach(order => {
        expect(order.status).toBe('completed')
      })
    })
    
    it('应该能统计订单总金额', async () => {
      const result = await Order.findAll({
        attributes: [
          [sequelize.fn('SUM', sequelize.col('payment_amount')), 'total']
        ]
      })
      
      const totalAmount = result[0].get('total')
      expect(totalAmount).toBeGreaterThan(0)
    })
    
    it('应该能按用户统计订单数量和金额', async () => {
      const userStats = await Order.findAll({
        attributes: [
          'user_id',
          [sequelize.fn('COUNT', sequelize.col('id')), 'order_count'],
          [sequelize.fn('SUM', sequelize.col('payment_amount')), 'total_amount']
        ],
        group: ['user_id']
      })
      
      expect(userStats).toHaveLength(3)
      userStats.forEach(stat => {
        expect(stat.get('order_count')).toBe(2)
        expect(stat.get('total_amount')).toBeGreaterThan(0)
      })
    })
    
    it('应该能按时间范围查询订单', async () => {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      
      const recentOrders = await Order.findAll({
        where: {
          created_at: {
            [sequelize.Sequelize.Op.gte]: oneHourAgo
          }
        }
      })
      
      expect(recentOrders.length).toBeGreaterThan(0)
    })
    
    it('应该能按状态统计订单', async () => {
      const statusStats = await Order.findAll({
        attributes: [
          'status',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: ['status']
      })
      
      expect(statusStats.length).toBeGreaterThan(0)
      statusStats.forEach(stat => {
        expect(stat.get('count')).toBeGreaterThan(0)
      })
    })
  })
})
