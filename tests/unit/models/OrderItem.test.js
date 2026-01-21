import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('OrderItem 模型', () => {
  let sequelize, OrderItem, Order, Product, User
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    
    OrderItem = sequelize.models.OrderItem
    Order = sequelize.models.Order
    Product = sequelize.models.Product
    User = sequelize.models.User
  })
  
  describe('基本功能', () => {
    let testOrder, testProduct
    
    beforeEach(async () => {
      // 创建测试用户
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      // 创建测试订单
      const orderData = TestDataFactory.createOrder(user.id)
      testOrder = await Order.create(orderData)
      
      // 创建测试商品
      const productData = TestDataFactory.createProduct()
      testProduct = await Product.create(productData)
    })
    
    it('应该创建订单项', async () => {
      const orderItemData = TestDataFactory.createOrderItem(
        testOrder.id,
        testProduct.id
      )
      
      const orderItem = await OrderItem.create(orderItemData)
      
      expect(orderItem.id).toBeDefined()
      expect(orderItem.order_id).toBe(testOrder.id)
      expect(orderItem.product_id).toBe(testProduct.id)
      expect(orderItem.product_name).toBe(orderItemData.product_name)
      expect(orderItem.price).toBe(orderItemData.price)
      expect(orderItem.quantity).toBe(orderItemData.quantity)
      expect(orderItem.subtotal).toBe(orderItemData.subtotal)
      expect(orderItem.created_at).toBeDefined()
      expect(orderItem.updated_at).toBeDefined()
    })
    
    it('应该正确计算小计', async () => {
      const price = 100
      const quantity = 3
      const subtotal = price * quantity
      
      const orderItemData = TestDataFactory.createOrderItem(
        testOrder.id,
        testProduct.id,
        { price, quantity, subtotal }
      )
      
      const orderItem = await OrderItem.create(orderItemData)
      
      expect(orderItem.subtotal).toBe(300)
      expect(orderItem.price * orderItem.quantity).toBe(orderItem.subtotal)
    })
    
    it('应该关联到订单', async () => {
      const orderItemData = TestDataFactory.createOrderItem(
        testOrder.id,
        testProduct.id
      )
      const orderItem = await OrderItem.create(orderItemData)
      
      const itemWithOrder = await OrderItem.findByPk(orderItem.id, {
        include: [{ model: Order, as: 'Order' }]
      })
      
      expect(itemWithOrder.Order).toBeDefined()
      expect(itemWithOrder.Order.id).toBe(testOrder.id)
    })
    
    it('应该关联到商品', async () => {
      const orderItemData = TestDataFactory.createOrderItem(
        testOrder.id,
        testProduct.id
      )
      const orderItem = await OrderItem.create(orderItemData)
      
      const itemWithProduct = await OrderItem.findByPk(orderItem.id, {
        include: [{ model: Product, as: 'Product' }]
      })
      
      expect(itemWithProduct.Product).toBeDefined()
      expect(itemWithProduct.Product.id).toBe(testProduct.id)
    })
  })
  
  describe('数据验证', () => {
    let testOrder, testProduct
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      const orderData = TestDataFactory.createOrder(user.id)
      testOrder = await Order.create(orderData)
      
      const productData = TestDataFactory.createProduct()
      testProduct = await Product.create(productData)
    })
    
    it('应该验证必填字段', async () => {
      const incompleteData = {
        order_id: testOrder.id
        // 缺少其他必填字段
      }
      
      await expect(OrderItem.create(incompleteData)).rejects.toThrow()
    })
    
    it('应该验证数量为正数', async () => {
      const orderItemData = TestDataFactory.createOrderItem(
        testOrder.id,
        testProduct.id,
        { quantity: -1 }
      )
      
      await expect(OrderItem.create(orderItemData)).rejects.toThrow()
    })
    
    it('应该验证价格为非负数', async () => {
      const orderItemData = TestDataFactory.createOrderItem(
        testOrder.id,
        testProduct.id,
        { price: -100 }
      )
      
      await expect(OrderItem.create(orderItemData)).rejects.toThrow()
    })
    
    it('应该验证小计为非负数', async () => {
      const orderItemData = TestDataFactory.createOrderItem(
        testOrder.id,
        testProduct.id,
        { subtotal: -300 }
      )
      
      await expect(OrderItem.create(orderItemData)).rejects.toThrow()
    })
  })
  
  describe('订单项查询', () => {
    let testOrder, testProducts, testOrderItems
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      const orderData = TestDataFactory.createOrder(user.id)
      testOrder = await Order.create(orderData)
      
      // 创建多个商品和订单项
      testProducts = []
      testOrderItems = []
      
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          name: `商品${i + 1}`,
          price: (i + 1) * 100
        })
        const product = await Product.create(productData)
        testProducts.push(product)
        
        const orderItemData = TestDataFactory.createOrderItem(
          testOrder.id,
          product.id,
          {
            product_name: product.name,
            price: product.price,
            quantity: i + 1,
            subtotal: product.price * (i + 1)
          }
        )
        const orderItem = await OrderItem.create(orderItemData)
        testOrderItems.push(orderItem)
      }
    })
    
    it('应该能按订单查询订单项', async () => {
      const orderItems = await OrderItem.findAll({
        where: { order_id: testOrder.id }
      })
      
      expect(orderItems).toHaveLength(3)
      orderItems.forEach(item => {
        expect(item.order_id).toBe(testOrder.id)
      })
    })
    
    it('应该能按商品查询订单项', async () => {
      const productId = testProducts[0].id
      const orderItems = await OrderItem.findAll({
        where: { product_id: productId }
      })
      
      expect(orderItems.length).toBeGreaterThan(0)
      orderItems.forEach(item => {
        expect(item.product_id).toBe(productId)
      })
    })
    
    it('应该能统计订单总金额', async () => {
      const result = await OrderItem.findAll({
        attributes: [
          [sequelize.fn('SUM', sequelize.col('subtotal')), 'total']
        ],
        where: { order_id: testOrder.id }
      })
      
      const total = result[0].get('total')
      expect(total).toBe(1400) // 100*1 + 200*2 + 300*3
    })
    
    it('应该能统计订单商品数量', async () => {
      const result = await OrderItem.findAll({
        attributes: [
          [sequelize.fn('SUM', sequelize.col('quantity')), 'total_quantity']
        ],
        where: { order_id: testOrder.id }
      })
      
      const totalQuantity = result[0].get('total_quantity')
      expect(totalQuantity).toBe(6) // 1 + 2 + 3
    })
  })
  
  describe('订单项统计', () => {
    beforeEach(async () => {
      // 创建多个用户和订单
      const users = []
      for (let i = 0; i < 2; i++) {
        const userData = await TestDataFactory.createUser({
          phone: `1390013${i.toString().padStart(4, '0')}`,
          email: `itemuser${i}@example.com`
        })
        const user = await User.create(userData)
        users.push(user)
      }
      
      // 创建商品
      const products = []
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          name: `热销商品${i + 1}`,
          price: (i + 1) * 100
        })
        const product = await Product.create(productData)
        products.push(product)
      }
      
      // 为每个用户创建订单和订单项
      for (const user of users) {
        const orderData = TestDataFactory.createOrder(user.id)
        const order = await Order.create(orderData)
        
        // 每个订单包含2个商品
        for (let i = 0; i < 2; i++) {
          const product = products[i]
          const orderItemData = TestDataFactory.createOrderItem(
            order.id,
            product.id,
            {
              product_name: product.name,
              price: product.price,
              quantity: 2,
              subtotal: product.price * 2
            }
          )
          await OrderItem.create(orderItemData)
        }
      }
    })
    
    it('应该能统计每个商品的销售数量', async () => {
      const productStats = await OrderItem.findAll({
        attributes: [
          'product_id',
          'product_name',
          [sequelize.fn('SUM', sequelize.col('quantity')), 'total_sold']
        ],
        group: ['product_id', 'product_name'],
        order: [[sequelize.literal('total_sold'), 'DESC']]
      })
      
      expect(productStats.length).toBeGreaterThan(0)
      productStats.forEach(stat => {
        expect(stat.get('total_sold')).toBeGreaterThan(0)
      })
    })
    
    it('应该能统计每个商品的销售额', async () => {
      const revenueStats = await OrderItem.findAll({
        attributes: [
          'product_id',
          'product_name',
          [sequelize.fn('SUM', sequelize.col('subtotal')), 'total_revenue']
        ],
        group: ['product_id', 'product_name'],
        order: [[sequelize.literal('total_revenue'), 'DESC']]
      })
      
      expect(revenueStats.length).toBeGreaterThan(0)
      revenueStats.forEach(stat => {
        expect(stat.get('total_revenue')).toBeGreaterThan(0)
      })
    })
    
    it('应该能查找热销商品', async () => {
      const topProducts = await OrderItem.findAll({
        attributes: [
          'product_id',
          'product_name',
          [sequelize.fn('SUM', sequelize.col('quantity')), 'total_sold']
        ],
        group: ['product_id', 'product_name'],
        order: [[sequelize.literal('total_sold'), 'DESC']],
        limit: 5
      })
      
      expect(topProducts.length).toBeGreaterThan(0)
      
      // 验证排序正确
      if (topProducts.length > 1) {
        expect(topProducts[0].get('total_sold')).toBeGreaterThanOrEqual(
          topProducts[1].get('total_sold')
        )
      }
    })
  })
  
  describe('订单项更新', () => {
    let testOrder, testProduct, testOrderItem
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      const orderData = TestDataFactory.createOrder(user.id)
      testOrder = await Order.create(orderData)
      
      const productData = TestDataFactory.createProduct()
      testProduct = await Product.create(productData)
      
      const orderItemData = TestDataFactory.createOrderItem(
        testOrder.id,
        testProduct.id
      )
      testOrderItem = await OrderItem.create(orderItemData)
    })
    
    it('应该能更新订单项数量和小计', async () => {
      const newQuantity = 5
      const newSubtotal = testOrderItem.price * newQuantity
      
      await testOrderItem.update({
        quantity: newQuantity,
        subtotal: newSubtotal
      })
      
      expect(testOrderItem.quantity).toBe(newQuantity)
      expect(testOrderItem.subtotal).toBe(newSubtotal)
    })
    
    it('更新时应该验证数据有效性', async () => {
      await expect(testOrderItem.update({
        quantity: -1
      })).rejects.toThrow()
      
      await expect(testOrderItem.update({
        price: -100
      })).rejects.toThrow()
    })
  })
  
  describe('订单项删除', () => {
    let testOrder, testProduct, testOrderItem
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      const orderData = TestDataFactory.createOrder(user.id)
      testOrder = await Order.create(orderData)
      
      const productData = TestDataFactory.createProduct()
      testProduct = await Product.create(productData)
      
      const orderItemData = TestDataFactory.createOrderItem(
        testOrder.id,
        testProduct.id
      )
      testOrderItem = await OrderItem.create(orderItemData)
    })
    
    it('应该能删除订单项', async () => {
      await testOrderItem.destroy()
      
      const deletedItem = await OrderItem.findByPk(testOrderItem.id)
      expect(deletedItem).toBeNull()
    })
    
    it('删除订单时应该级联删除订单项', async () => {
      // 创建多个订单项
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          name: `商品${i + 1}`
        })
        const product = await Product.create(productData)
        
        const orderItemData = TestDataFactory.createOrderItem(
          testOrder.id,
          product.id
        )
        await OrderItem.create(orderItemData)
      }
      
      // 验证订单项存在
      let orderItems = await OrderItem.findAll({
        where: { order_id: testOrder.id }
      })
      expect(orderItems.length).toBeGreaterThan(0)
      
      // 删除订单
      await testOrder.destroy()
      
      // 验证订单项被级联删除
      orderItems = await OrderItem.findAll({
        where: { order_id: testOrder.id }
      })
      expect(orderItems).toHaveLength(0)
    })
  })
  
  describe('商品快照', () => {
    it('应该保存商品信息快照', async () => {
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      const orderData = TestDataFactory.createOrder(user.id)
      const order = await Order.create(orderData)
      
      const productData = TestDataFactory.createProduct({
        name: '原始商品名',
        price: 100
      })
      const product = await Product.create(productData)
      
      // 创建订单项（保存商品快照）
      const orderItemData = TestDataFactory.createOrderItem(
        order.id,
        product.id,
        {
          product_name: product.name,
          product_image: product.cover_image,
          price: product.price,
          quantity: 1,
          subtotal: product.price
        }
      )
      const orderItem = await OrderItem.create(orderItemData)
      
      // 修改商品信息
      await product.update({
        name: '新商品名',
        price: 200
      })
      
      // 验证订单项保存的是旧信息
      await orderItem.reload()
      expect(orderItem.product_name).toBe('原始商品名')
      expect(orderItem.price).toBe(100)
      
      // 验证商品已更新
      await product.reload()
      expect(product.name).toBe('新商品名')
      expect(product.price).toBe(200)
    })
  })
})
