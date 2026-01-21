import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

describe('购物车管理 API', () => {
  let sequelize
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
  })
  
  describe('GET /api/cart - 获取购物车', () => {
    let testUser, testProduct, authToken
    
    beforeEach(async () => {
      const { User, Product, Cart } = sequelize.models
      
      // 创建测试用户和商品
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
      
      const productData = TestDataFactory.createProduct({ stock: 10, price: 100 })
      testProduct = await Product.create(productData)
      
      // 添加商品到购物车
      await Cart.create({
        user_id: testUser.id,
        product_id: testProduct.id,
        quantity: 2
      })
    })
    
    it('应该返回用户的购物车内容', async () => {
      const response = await request(app)
        .get('/api/cart')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.items).toHaveLength(1)
      expect(response.body.data.items[0].quantity).toBe(2)
      expect(response.body.data.items[0].Product.id).toBe(testProduct.id)
      expect(response.body.data.total_amount).toBe(200) // 100 * 2
    })
    
    it('应该返回空购物车（新用户）', async () => {
      const { User } = sequelize.models
      const newUserData = await TestDataFactory.createUser({
        phone: '13900139001',
        email: 'newuser@example.com'
      })
      const newUser = await User.create(newUserData)
      const newToken = TestHelpers.generateToken(newUser)
      
      const response = await request(app)
        .get('/api/cart')
        .set('Authorization', `Bearer ${newToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.items).toHaveLength(0)
      expect(response.body.data.total_amount).toBe(0)
    })
    
    it('应该拒绝未认证的请求', async () => {
      const response = await request(app)
        .get('/api/cart')
        .expect(401)
      
      expect(response.body.success).toBe(false)
    })
  })
  
  describe('POST /api/cart - 添加到购物车', () => {
    let testUser, testProduct, authToken
    
    beforeEach(async () => {
      const { User, Product } = sequelize.models
      
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
      
      const productData = TestDataFactory.createProduct({ stock: 10, price: 100 })
      testProduct = await Product.create(productData)
    })
    
    it('应该成功添加商品到购物车', async () => {
      const response = await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          product_id: testProduct.id,
          quantity: 3
        })
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.message).toContain('成功添加到购物车')
      
      // 验证数据库中的记录
      const { Cart } = sequelize.models
      const cartItem = await Cart.findOne({
        where: { user_id: testUser.id, product_id: testProduct.id }
      })
      expect(cartItem.quantity).toBe(3)
    })
    
    it('应该累加已存在商品的数量', async () => {
      const { Cart } = sequelize.models
      
      // 先添加商品到购物车
      await Cart.create({
        user_id: testUser.id,
        product_id: testProduct.id,
        quantity: 2
      })
      
      // 再次添加同一商品
      const response = await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          product_id: testProduct.id,
          quantity: 1
        })
        .expect(200)
      
      expect(response.body.success).toBe(true)
      
      // 验证数量被累加
      const cartItem = await Cart.findOne({
        where: { user_id: testUser.id, product_id: testProduct.id }
      })
      expect(cartItem.quantity).toBe(3) // 2 + 1
    })
    
    it('应该检查库存限制', async () => {
      const response = await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          product_id: testProduct.id,
          quantity: 15 // 超过库存
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('库存不足')
    })
    
    it('应该检查商品是否存在', async () => {
      const response = await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          product_id: 99999, // 不存在的商品
          quantity: 1
        })
        .expect(404)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('商品不存在')
    })
    
    it('应该验证必填字段', async () => {
      const response = await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          product_id: testProduct.id
          // 缺少quantity
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('数量不能为空')
    })
    
    it('应该验证数量范围', async () => {
      const invalidQuantities = [0, -1, 101]
      
      for (const quantity of invalidQuantities) {
        const response = await request(app)
          .post('/api/cart')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            product_id: testProduct.id,
            quantity
          })
          .expect(400)
        
        expect(response.body.success).toBe(false)
      }
    })
  })
  
  describe('PUT /api/cart/:id - 更新购物车项目', () => {
    let testUser, testProduct, cartItem, authToken
    
    beforeEach(async () => {
      const { User, Product, Cart } = sequelize.models
      
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
      
      const productData = TestDataFactory.createProduct({ stock: 10, price: 100 })
      testProduct = await Product.create(productData)
      
      cartItem = await Cart.create({
        user_id: testUser.id,
        product_id: testProduct.id,
        quantity: 2
      })
    })
    
    it('应该成功更新购物车项目数量', async () => {
      const response = await request(app)
        .put(`/api/cart/${cartItem.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          quantity: 5
        })
        .expect(200)
      
      expect(response.body.success).toBe(true)
      
      // 验证数据库更新
      await cartItem.reload()
      expect(cartItem.quantity).toBe(5)
    })
    
    it('应该拒绝更新不属于自己的购物车项目', async () => {
      // 创建另一个用户
      const { User } = sequelize.models
      const otherUserData = await TestDataFactory.createUser({
        phone: '13900139002',
        email: 'other@example.com'
      })
      const otherUser = await User.create(otherUserData)
      const otherToken = TestHelpers.generateToken(otherUser)
      
      const response = await request(app)
        .put(`/api/cart/${cartItem.id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          quantity: 5
        })
        .expect(404)
      
      expect(response.body.success).toBe(false)
    })
    
    it('应该检查库存限制', async () => {
      const response = await request(app)
        .put(`/api/cart/${cartItem.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          quantity: 15 // 超过库存
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('库存不足')
    })
  })
  
  describe('DELETE /api/cart/:id - 删除购物车项目', () => {
    let testUser, testProduct, cartItem, authToken
    
    beforeEach(async () => {
      const { User, Product, Cart } = sequelize.models
      
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
      
      const productData = TestDataFactory.createProduct({ stock: 10, price: 100 })
      testProduct = await Product.create(productData)
      
      cartItem = await Cart.create({
        user_id: testUser.id,
        product_id: testProduct.id,
        quantity: 2
      })
    })
    
    it('应该成功删除购物车项目', async () => {
      const response = await request(app)
        .delete(`/api/cart/${cartItem.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      
      // 验证项目已删除
      const { Cart } = sequelize.models
      const deletedItem = await Cart.findByPk(cartItem.id)
      expect(deletedItem).toBeNull()
    })
    
    it('应该返回404对于不存在的项目', async () => {
      const response = await request(app)
        .delete('/api/cart/99999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404)
      
      expect(response.body.success).toBe(false)
    })
  })
  
  describe('DELETE /api/cart - 清空购物车', () => {
    let testUser, authToken
    
    beforeEach(async () => {
      const { User, Product, Cart } = sequelize.models
      
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
      
      // 添加多个商品到购物车
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct()
        const product = await Product.create(productData)
        
        await Cart.create({
          user_id: testUser.id,
          product_id: product.id,
          quantity: 1
        })
      }
    })
    
    it('应该成功清空购物车', async () => {
      const response = await request(app)
        .delete('/api/cart')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      
      // 验证购物车已清空
      const { Cart } = sequelize.models
      const remainingItems = await Cart.findAll({
        where: { user_id: testUser.id }
      })
      expect(remainingItems).toHaveLength(0)
    })
    
    it('应该正确处理空购物车', async () => {
      // 先清空购物车
      const { Cart } = sequelize.models
      await Cart.destroy({ where: { user_id: testUser.id } })
      
      const response = await request(app)
        .delete('/api/cart')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
    })
  })
  
  describe('购物车计算逻辑', () => {
    let testUser, authToken
    
    beforeEach(async () => {
      const { User } = sequelize.models
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      authToken = TestHelpers.generateToken(testUser)
    })
    
    it('应该正确计算折扣商品的总价', async () => {
      const { Product, Cart } = sequelize.models
      
      // 创建有折扣的商品
      const productData = TestDataFactory.createProduct({
        price: 100,
        discount: 20, // 20%折扣
        stock: 10
      })
      const product = await Product.create(productData)
      
      // 添加到购物车
      await Cart.create({
        user_id: testUser.id,
        product_id: product.id,
        quantity: 2
      })
      
      const response = await request(app)
        .get('/api/cart')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      // 折扣后价格: 100 * 0.8 * 2 = 160
      expect(response.body.data.total_amount).toBe(160)
      expect(response.body.data.items[0].discounted_price).toBe(80)
      expect(response.body.data.items[0].original_price).toBe(100)
    })
    
    it('应该正确计算多商品混合的总价', async () => {
      const { Product, Cart } = sequelize.models
      
      // 创建普通商品
      const product1 = await Product.create(
        TestDataFactory.createProduct({ price: 100, discount: null, stock: 10 })
      )
      
      // 创建折扣商品
      const product2 = await Product.create(
        TestDataFactory.createProduct({ price: 200, discount: 10, stock: 10 })
      )
      
      // 添加到购物车
      await Cart.create({ user_id: testUser.id, product_id: product1.id, quantity: 1 })
      await Cart.create({ user_id: testUser.id, product_id: product2.id, quantity: 2 })
      
      const response = await request(app)
        .get('/api/cart')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      
      // 总价: 100 * 1 + (200 * 0.9) * 2 = 100 + 360 = 460
      expect(response.body.data.total_amount).toBe(460)
      expect(response.body.data.items).toHaveLength(2)
    })
  })
})
