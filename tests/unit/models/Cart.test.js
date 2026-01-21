import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('Cart 模型', () => {
  let sequelize, Cart, User, Product
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    Cart = sequelize.models.Cart
    User = sequelize.models.User
    Product = sequelize.models.Product
  })
  
  describe('基本功能', () => {
    let testUser, testProduct
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const productData = TestDataFactory.createProduct({ stock: 10 })
      testProduct = await Product.create(productData)
    })
    
    it('应该创建购物车项目', async () => {
      const cartData = TestDataFactory.createCart(testUser.id, testProduct.id, { quantity: 2 })
      const cartItem = await Cart.create(cartData)
      
      expect(cartItem.id).toBeDefined()
      expect(cartItem.user_id).toBe(testUser.id)
      expect(cartItem.product_id).toBe(testProduct.id)
      expect(cartItem.quantity).toBe(2)
      expect(cartItem.created_at).toBeDefined()
      expect(cartItem.updated_at).toBeDefined()
    })
    
    it('应该设置默认数量为1', async () => {
      const cartData = TestDataFactory.createCart(testUser.id, testProduct.id)
      delete cartData.quantity // 测试默认值
      
      const cartItem = await Cart.create({ ...cartData, quantity: 1 })
      expect(cartItem.quantity).toBe(1)
    })
    
    it('应该关联到用户和商品', async () => {
      const cartData = TestDataFactory.createCart(testUser.id, testProduct.id)
      const cartItem = await Cart.create(cartData)
      
      const cartWithAssociations = await Cart.findByPk(cartItem.id, {
        include: [
          { model: User, as: 'User' },
          { model: Product, as: 'Product' }
        ]
      })
      
      expect(cartWithAssociations.User).toBeDefined()
      expect(cartWithAssociations.User.id).toBe(testUser.id)
      expect(cartWithAssociations.Product).toBeDefined()
      expect(cartWithAssociations.Product.id).toBe(testProduct.id)
    })
  })
  
  describe('数据验证', () => {
    let testUser, testProduct
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const productData = TestDataFactory.createProduct()
      testProduct = await Product.create(productData)
    })
    
    it('应该验证必填字段', async () => {
      const incompleteData = {
        user_id: testUser.id
        // 缺少product_id和quantity
      }
      
      await expect(Cart.create(incompleteData)).rejects.toThrow()
    })
    
    it('应该验证数量范围', async () => {
      const invalidQuantities = [-1, 0, 101]
      
      for (const quantity of invalidQuantities) {
        const cartData = TestDataFactory.createCart(testUser.id, testProduct.id, { quantity })
        await expect(Cart.create(cartData)).rejects.toThrow()
      }
    })
    
    it('应该验证数量为整数', async () => {
      const cartData = TestDataFactory.createCart(testUser.id, testProduct.id, { 
        quantity: 2.5 // 非整数
      })
      
      await expect(Cart.create(cartData)).rejects.toThrow()
    })
    
    it('应该验证用户存在', async () => {
      const cartData = TestDataFactory.createCart(99999, testProduct.id) // 不存在的用户
      
      await expect(Cart.create(cartData)).rejects.toThrow()
    })
    
    it('应该验证商品存在', async () => {
      const cartData = TestDataFactory.createCart(testUser.id, 99999) // 不存在的商品
      
      await expect(Cart.create(cartData)).rejects.toThrow()
    })
  })
  
  describe('唯一性约束', () => {
    let testUser, testProduct
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const productData = TestDataFactory.createProduct()
      testProduct = await Product.create(productData)
    })
    
    it('应该确保用户+商品的唯一性', async () => {
      // 创建第一个购物车项目
      const cartData1 = TestDataFactory.createCart(testUser.id, testProduct.id)
      await Cart.create(cartData1)
      
      // 尝试创建重复的购物车项目
      const cartData2 = TestDataFactory.createCart(testUser.id, testProduct.id)
      await expect(Cart.create(cartData2)).rejects.toThrow()
    })
    
    it('应该允许不同用户添加相同商品', async () => {
      // 创建另一个用户
      const user2Data = await TestDataFactory.createUser({
        phone: '13900139001',
        email: 'user2@example.com'
      })
      const user2 = await User.create(user2Data)
      
      // 两个用户添加相同商品应该成功
      const cartData1 = TestDataFactory.createCart(testUser.id, testProduct.id)
      const cartItem1 = await Cart.create(cartData1)
      
      const cartData2 = TestDataFactory.createCart(user2.id, testProduct.id)
      const cartItem2 = await Cart.create(cartData2)
      
      expect(cartItem1.id).toBeDefined()
      expect(cartItem2.id).toBeDefined()
      expect(cartItem1.id).not.toBe(cartItem2.id)
    })
    
    it('应该允许同一用户添加不同商品', async () => {
      // 创建另一个商品
      const product2Data = TestDataFactory.createProduct()
      const product2 = await Product.create(product2Data)
      
      // 同一用户添加不同商品应该成功
      const cartData1 = TestDataFactory.createCart(testUser.id, testProduct.id)
      const cartItem1 = await Cart.create(cartData1)
      
      const cartData2 = TestDataFactory.createCart(testUser.id, product2.id)
      const cartItem2 = await Cart.create(cartData2)
      
      expect(cartItem1.id).toBeDefined()
      expect(cartItem2.id).toBeDefined()
      expect(cartItem1.product_id).not.toBe(cartItem2.product_id)
    })
  })
  
  describe('购物车操作', () => {
    let testUser, testProducts
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      // 创建多个商品
      testProducts = []
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({ stock: 10 })
        const product = await Product.create(productData)
        testProducts.push(product)
      }
    })
    
    it('应该能更新购物车项目数量', async () => {
      const cartData = TestDataFactory.createCart(testUser.id, testProducts[0].id, { quantity: 2 })
      const cartItem = await Cart.create(cartData)
      
      // 更新数量
      await cartItem.update({ quantity: 5 })
      expect(cartItem.quantity).toBe(5)
      
      // 验证数据库更新
      await cartItem.reload()
      expect(cartItem.quantity).toBe(5)
    })
    
    it('应该能获取用户的所有购物车项目', async () => {
      // 添加多个商品到购物车
      for (const product of testProducts) {
        const cartData = TestDataFactory.createCart(testUser.id, product.id)
        await Cart.create(cartData)
      }
      
      const userCartItems = await Cart.findAll({
        where: { user_id: testUser.id },
        include: [{ model: Product, as: 'Product' }]
      })
      
      expect(userCartItems).toHaveLength(3)
      userCartItems.forEach(item => {
        expect(item.user_id).toBe(testUser.id)
        expect(item.Product).toBeDefined()
      })
    })
    
    it('应该能删除购物车项目', async () => {
      const cartData = TestDataFactory.createCart(testUser.id, testProducts[0].id)
      const cartItem = await Cart.create(cartData)
      
      // 删除项目
      await cartItem.destroy()
      
      // 验证已删除
      const deletedItem = await Cart.findByPk(cartItem.id)
      expect(deletedItem).toBeNull()
    })
    
    it('应该能清空用户购物车', async () => {
      // 添加多个商品到购物车
      for (const product of testProducts) {
        const cartData = TestDataFactory.createCart(testUser.id, product.id)
        await Cart.create(cartData)
      }
      
      // 清空购物车
      await Cart.destroy({ where: { user_id: testUser.id } })
      
      // 验证购物车已清空
      const remainingItems = await Cart.findAll({
        where: { user_id: testUser.id }
      })
      expect(remainingItems).toHaveLength(0)
    })
  })
  
  describe('购物车计算', () => {
    let testUser, testProducts
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      // 创建不同价格的商品
      testProducts = []
      const prices = [100, 200, 300]
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({ 
          price: prices[i],
          discount: i === 1 ? 10 : null, // 第二个商品有10%折扣
          stock: 10 
        })
        const product = await Product.create(productData)
        testProducts.push(product)
      }
    })
    
    it('应该能计算购物车总数量', async () => {
      // 添加商品到购物车
      const quantities = [2, 3, 1]
      for (let i = 0; i < testProducts.length; i++) {
        const cartData = TestDataFactory.createCart(testUser.id, testProducts[i].id, {
          quantity: quantities[i]
        })
        await Cart.create(cartData)
      }
      
      // 计算总数量
      const totalQuantity = await Cart.sum('quantity', {
        where: { user_id: testUser.id }
      })
      expect(totalQuantity).toBe(6) // 2 + 3 + 1
    })
    
    it('应该能获取购物车详细信息用于金额计算', async () => {
      // 添加商品到购物车
      await Cart.create(TestDataFactory.createCart(testUser.id, testProducts[0].id, { quantity: 2 }))
      await Cart.create(TestDataFactory.createCart(testUser.id, testProducts[1].id, { quantity: 1 }))
      
      // 获取购物车详情（包含商品信息）
      const cartItems = await Cart.findAll({
        where: { user_id: testUser.id },
        include: [{ model: Product, as: 'Product' }]
      })
      
      expect(cartItems).toHaveLength(2)
      
      // 验证可以计算总金额
      let totalAmount = 0
      cartItems.forEach(item => {
        const product = item.Product
        const price = product.discount ? 
          product.price * (1 - product.discount / 100) : 
          product.price
        totalAmount += price * item.quantity
      })
      
      // 第一个商品: 100 * 2 = 200
      // 第二个商品: 200 * 0.9 * 1 = 180
      // 总计: 380
      expect(totalAmount).toBe(380)
    })
  })
  
  describe('购物车统计', () => {
    let testUsers, testProducts
    
    beforeEach(async () => {
      // 创建多个用户
      testUsers = []
      for (let i = 0; i < 3; i++) {
        const userData = await TestDataFactory.createUser({
          phone: `138001380${i}`,
          email: `cartuser${i}@example.com`
        })
        const user = await User.create(userData)
        testUsers.push(user)
      }
      
      // 创建多个商品
      testProducts = []
      for (let i = 0; i < 2; i++) {
        const productData = TestDataFactory.createProduct()
        const product = await Product.create(productData)
        testProducts.push(product)
      }
      
      // 创建购物车数据
      for (let i = 0; i < testUsers.length; i++) {
        for (let j = 0; j < testProducts.length; j++) {
          const cartData = TestDataFactory.createCart(testUsers[i].id, testProducts[j].id, {
            quantity: (i + 1) * (j + 1) // 不同的数量
          })
          await Cart.create(cartData)
        }
      }
    })
    
    it('应该能统计购物车项目总数', async () => {
      const totalItems = await Cart.count()
      expect(totalItems).toBe(6) // 3用户 * 2商品 = 6项目
    })
    
    it('应该能按用户统计购物车', async () => {
      const userStats = await Cart.findAll({
        attributes: [
          'user_id',
          [sequelize.fn('COUNT', sequelize.col('id')), 'item_count'],
          [sequelize.fn('SUM', sequelize.col('quantity')), 'total_quantity']
        ],
        group: ['user_id']
      })
      
      expect(userStats).toHaveLength(3)
      
      // 验证第一个用户的统计
      const user1Stats = userStats.find(s => s.user_id === testUsers[0].id)
      expect(user1Stats.get('item_count')).toBe(2)
      expect(user1Stats.get('total_quantity')).toBe(3) // 1*1 + 1*2 = 3
    })
    
    it('应该能按商品统计购物车', async () => {
      const productStats = await Cart.findAll({
        attributes: [
          'product_id',
          [sequelize.fn('COUNT', sequelize.col('id')), 'user_count'],
          [sequelize.fn('SUM', sequelize.col('quantity')), 'total_quantity']
        ],
        group: ['product_id']
      })
      
      expect(productStats).toHaveLength(2)
      
      // 验证第一个商品的统计
      const product1Stats = productStats.find(s => s.product_id === testProducts[0].id)
      expect(product1Stats.get('user_count')).toBe(3)
      expect(product1Stats.get('total_quantity')).toBe(6) // 1*1 + 2*1 + 3*1 = 6
    })
  })
  
  describe('购物车清理', () => {
    let testUser, testProduct
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const productData = TestDataFactory.createProduct()
      testProduct = await Product.create(productData)
    })
    
    it('应该在用户删除时清理相关购物车', async () => {
      // 添加商品到购物车
      const cartData = TestDataFactory.createCart(testUser.id, testProduct.id)
      await Cart.create(cartData)
      
      // 验证购物车项目存在
      let cartItems = await Cart.findAll({ where: { user_id: testUser.id } })
      expect(cartItems).toHaveLength(1)
      
      // 删除用户（应该级联删除购物车项目）
      await testUser.destroy()
      
      // 验证购物车项目被清理
      cartItems = await Cart.findAll({ where: { user_id: testUser.id } })
      expect(cartItems).toHaveLength(0)
    })
    
    it('应该在商品删除时清理相关购物车', async () => {
      // 添加商品到购物车
      const cartData = TestDataFactory.createCart(testUser.id, testProduct.id)
      await Cart.create(cartData)
      
      // 验证购物车项目存在
      let cartItems = await Cart.findAll({ where: { product_id: testProduct.id } })
      expect(cartItems).toHaveLength(1)
      
      // 删除商品（应该级联删除购物车项目）
      await testProduct.destroy()
      
      // 验证购物车项目被清理
      cartItems = await Cart.findAll({ where: { product_id: testProduct.id } })
      expect(cartItems).toHaveLength(0)
    })
  })
})
