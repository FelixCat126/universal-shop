import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('Order 模型', () => {
  let sequelize, Order, User, Product
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    Order = sequelize.models.Order
    User = sequelize.models.User
    Product = sequelize.models.Product
  })
  
  describe('基本功能', () => {
    let testUser
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
    })
    
    it('应该创建订单', async () => {
      const orderData = TestDataFactory.createOrder(testUser.id)
      const order = await Order.create(orderData)
      
      expect(order.id).toBeDefined()
      expect(order.user_id).toBe(testUser.id)
      expect(order.order_no).toBeDefined()
      expect(order.status).toBe('pending')
      expect(order.total_amount).toBe(orderData.total_amount)
    })
    
    it('应该生成唯一的订单号', async () => {
      const orders = []
      for (let i = 0; i < 5; i++) {
        const orderData = TestDataFactory.createOrder(testUser.id)
        const order = await Order.create(orderData)
        orders.push(order)
      }
      
      const orderNos = orders.map(o => o.order_no)
      const uniqueOrderNos = new Set(orderNos)
      expect(uniqueOrderNos.size).toBe(orderNos.length)
    })
    
    it('应该设置创建和更新时间', async () => {
      const orderData = TestDataFactory.createOrder(testUser.id)
      const order = await Order.create(orderData)
      
      expect(order.created_at).toBeDefined()
      expect(order.updated_at).toBeDefined()
      expect(order.created_at instanceof Date).toBe(true)
      expect(order.updated_at instanceof Date).toBe(true)
    })
  })
  
  describe('订单状态管理', () => {
    let testUser, testOrder
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const orderData = TestDataFactory.createOrder(testUser.id)
      testOrder = await Order.create(orderData)
    })
    
    it('应该支持更新订单状态', async () => {
      await testOrder.update({ status: 'confirmed' })
      expect(testOrder.status).toBe('confirmed')
      
      await testOrder.update({ status: 'shipped' })
      expect(testOrder.status).toBe('shipped')
      
      await testOrder.update({ status: 'delivered' })
      expect(testOrder.status).toBe('delivered')
    })
    
    it('应该验证订单状态值', async () => {
      await expect(testOrder.update({ status: 'invalid_status' }))
        .rejects.toThrow()
    })
    
    it('应该支持取消订单', async () => {
      await testOrder.update({ status: 'cancelled' })
      expect(testOrder.status).toBe('cancelled')
    })
  })
  
  describe('订单金额处理', () => {
    let testUser
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
    })
    
    it('应该正确存储金额', async () => {
      const orderData = TestDataFactory.createOrder(testUser.id, {
        total_amount: 199.99
      })
      const order = await Order.create(orderData)
      
      expect(order.total_amount).toBe(199.99)
    })
    
    it('应该支持汇率设置', async () => {
      const orderData = TestDataFactory.createOrder(testUser.id, {
        total_amount: 100,
        exchange_rate: 0.14 // 人民币对泰铢汇率
      })
      const order = await Order.create(orderData)
      
      expect(order.exchange_rate).toBe(0.14)
    })
    
    it('应该验证金额为正数', async () => {
      const orderData = TestDataFactory.createOrder(testUser.id, {
        total_amount: -100
      })
      
      await expect(Order.create(orderData)).rejects.toThrow()
    })
  })
  
  describe('收货信息', () => {
    let testUser
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
    })
    
    it('应该存储完整的收货信息', async () => {
      const orderData = TestDataFactory.createOrder(testUser.id, {
        contact_name: '张三',
        contact_phone: '13800138001',
        delivery_address: '北京市朝阳区测试街道123号',
        province: '北京市',
        city: '北京市',
        district: '朝阳区',
        postal_code: '100000'
      })
      const order = await Order.create(orderData)
      
      expect(order.contact_name).toBe('张三')
      expect(order.contact_phone).toBe('13800138001')
      expect(order.delivery_address).toBe('北京市朝阳区测试街道123号')
      expect(order.province).toBe('北京市')
      expect(order.city).toBe('北京市')
      expect(order.district).toBe('朝阳区')
      expect(order.postal_code).toBe('100000')
    })
    
    it('应该验证必填的收货信息', async () => {
      const orderData = TestDataFactory.createOrder(testUser.id)
      delete orderData.contact_name
      
      await expect(Order.create(orderData)).rejects.toThrow()
    })
    
    it('应该验证手机号格式', async () => {
      const orderData = TestDataFactory.createOrder(testUser.id, {
        contact_phone: '123' // 无效手机号
      })
      
      await expect(Order.create(orderData)).rejects.toThrow()
    })
  })
  
  describe('模型关联', () => {
    let testUser, testOrder
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const orderData = TestDataFactory.createOrder(testUser.id)
      testOrder = await Order.create(orderData)
    })
    
    it('应该关联到用户', async () => {
      const order = await Order.findByPk(testOrder.id, {
        include: [{ model: User, as: 'User' }]
      })
      
      expect(order.User).toBeDefined()
      expect(order.User.id).toBe(testUser.id)
      expect(order.User.email).toBe(testUser.email)
    })
    
    it('应该关联到订单项', async () => {
      const { OrderItem } = sequelize.models
      
      // 创建商品
      const productData = TestDataFactory.createProduct()
      const product = await Product.create(productData)
      
      // 创建订单项
      const orderItemData = TestDataFactory.createOrderItem(testOrder.id, product.id)
      await OrderItem.create(orderItemData)
      
      const order = await Order.findByPk(testOrder.id, {
        include: [{ model: OrderItem, as: 'OrderItems' }]
      })
      
      expect(order.OrderItems).toBeDefined()
      expect(order.OrderItems).toHaveLength(1)
      expect(order.OrderItems[0].product_id).toBe(product.id)
    })
  })
  
  describe('查询功能', () => {
    let testUser, testOrders
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      // 创建多个订单
      testOrders = []
      const statuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']
      
      for (let i = 0; i < 5; i++) {
        const orderData = TestDataFactory.createOrder(testUser.id, {
          status: statuses[i],
          total_amount: (i + 1) * 100,
          order_no: `TEST${Date.now()}-${i}`
        })
        const order = await Order.create(orderData)
        testOrders.push(order)
      }
    })
    
    it('应该能按状态查询订单', async () => {
      const pendingOrders = await Order.findAll({
        where: { status: 'pending' }
      })
      
      expect(pendingOrders).toHaveLength(1)
      expect(pendingOrders[0].status).toBe('pending')
    })
    
    it('应该能按用户查询订单', async () => {
      const userOrders = await Order.findAll({
        where: { user_id: testUser.id }
      })
      
      expect(userOrders).toHaveLength(5)
      userOrders.forEach(order => {
        expect(order.user_id).toBe(testUser.id)
      })
    })
    
    it('应该能按金额范围查询', async () => {
      const expensiveOrders = await Order.findAll({
        where: { 
          total_amount: { 
            [sequelize.Sequelize.Op.gte]: 300 
          }
        }
      })
      
      expect(expensiveOrders.length).toBeGreaterThan(0)
      expensiveOrders.forEach(order => {
        expect(order.total_amount).toBeGreaterThanOrEqual(300)
      })
    })
    
    it('应该能按订单号查询', async () => {
      const targetOrder = testOrders[0]
      const order = await Order.findOne({
        where: { order_no: targetOrder.order_no }
      })
      
      expect(order).toBeTruthy()
      expect(order.id).toBe(targetOrder.id)
    })
    
    it('应该能按时间范围查询', async () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      
      const recentOrders = await Order.findAll({
        where: { 
          created_at: { 
            [sequelize.Sequelize.Op.gte]: yesterday 
          }
        }
      })
      
      expect(recentOrders).toHaveLength(5) // 所有订单都是今天创建的
    })
  })
  
  describe('订单号生成', () => {
    let testUser
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
    })
    
    it('应该生成符合格式的订单号', async () => {
      const orderData = TestDataFactory.createOrder(testUser.id)
      const order = await Order.create(orderData)
      
      // 订单号应该是字符串
      expect(typeof order.order_no).toBe('string')
      expect(order.order_no.length).toBeGreaterThan(0)
    })
    
    it('应该确保订单号唯一性', async () => {
      const orders = []
      
      // 并发创建多个订单
      const promises = Array(10).fill().map(async () => {
        const orderData = TestDataFactory.createOrder(testUser.id)
        return Order.create(orderData)
      })
      
      const createdOrders = await Promise.all(promises)
      const orderNos = createdOrders.map(o => o.order_no)
      const uniqueOrderNos = new Set(orderNos)
      
      expect(uniqueOrderNos.size).toBe(orderNos.length)
    })
  })
  
  describe('数据验证', () => {
    let testUser
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
    })
    
    it('应该验证必填字段', async () => {
      const incompleteData = {
        user_id: testUser.id
        // 缺少其他必填字段
      }
      
      await expect(Order.create(incompleteData)).rejects.toThrow()
    })
    
    it('应该验证金额格式', async () => {
      const orderData = TestDataFactory.createOrder(testUser.id, {
        total_amount: 'invalid_amount'
      })
      
      await expect(Order.create(orderData)).rejects.toThrow()
    })
    
    it('应该验证用户存在', async () => {
      const orderData = TestDataFactory.createOrder(99999) // 不存在的用户ID
      
      await expect(Order.create(orderData)).rejects.toThrow()
    })
    
    it('应该验证邮编格式', async () => {
      const orderData = TestDataFactory.createOrder(testUser.id, {
        postal_code: '123' // 无效邮编
      })
      
      await expect(Order.create(orderData)).rejects.toThrow()
    })
  })
  
  describe('订单统计', () => {
    let testUser
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      // 创建不同状态的订单
      const orderStates = [
        { status: 'pending', total_amount: 100 },
        { status: 'confirmed', total_amount: 200 },
        { status: 'shipped', total_amount: 300 },
        { status: 'delivered', total_amount: 400 },
        { status: 'cancelled', total_amount: 150 }
      ]
      
      for (const state of orderStates) {
        const orderData = TestDataFactory.createOrder(testUser.id, state)
        await Order.create(orderData)
      }
    })
    
    it('应该能统计订单数量', async () => {
      const totalCount = await Order.count()
      expect(totalCount).toBe(5)
      
      const deliveredCount = await Order.count({
        where: { status: 'delivered' }
      })
      expect(deliveredCount).toBe(1)
    })
    
    it('应该能统计订单金额', async () => {
      const totalAmount = await Order.sum('total_amount')
      expect(totalAmount).toBe(1150) // 100+200+300+400+150
      
      const confirmedAmount = await Order.sum('total_amount', {
        where: { status: 'confirmed' }
      })
      expect(confirmedAmount).toBe(200)
    })
    
    it('应该能按状态分组统计', async () => {
      const stats = await Order.findAll({
        attributes: [
          'status',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('SUM', sequelize.col('total_amount')), 'total_amount']
        ],
        group: ['status']
      })
      
      expect(stats).toHaveLength(5)
      
      const deliveredStat = stats.find(s => s.status === 'delivered')
      expect(deliveredStat.get('count')).toBe(1)
      expect(deliveredStat.get('total_amount')).toBe(400)
    })
  })
})
