import { describe, it, expect, beforeEach, vi } from 'vitest'
import CartController from '@server/controllers/cartController.js'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('CartController 单元测试', () => {
  let sequelize, Cart, Product, User
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    
    Cart = sequelize.models.Cart
    Product = sequelize.models.Product
    User = sequelize.models.User
  })
  
  describe('getCart 获取购物车', () => {
    let req, res, testUser, testProducts, testCartItems
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      testProducts = []
      testCartItems = []
      
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          name: `商品${i + 1}`,
          price: (i + 1) * 100,
          stock: 10
        })
        const product = await Product.create(productData)
        testProducts.push(product)
        
        const cartItem = await Cart.create({
          user_id: testUser.id,
          product_id: product.id,
          quantity: i + 1
        })
        testCartItems.push(cartItem)
      }
      
      req = {
        user: testUser
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回用户的购物车', async () => {
      await CartController.getCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          items: expect.any(Array),
          total_amount: expect.any(Number)
        })
      })
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.items).toHaveLength(3)
    })
    
    it('应该计算购物车总金额', async () => {
      await CartController.getCart(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      // 100*1 + 200*2 + 300*3 = 1400
      expect(responseData.total_amount).toBe(1400)
    })
    
    it('应该包含商品详细信息', async () => {
      await CartController.getCart(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      const firstItem = responseData.items[0]
      
      expect(firstItem).toHaveProperty('Product')
      expect(firstItem.Product).toHaveProperty('name')
      expect(firstItem.Product).toHaveProperty('price')
      expect(firstItem.Product).toHaveProperty('stock')
    })
    
    it('空购物车应该返回空数组', async () => {
      await Cart.destroy({ where: { user_id: testUser.id } })
      
      await CartController.getCart(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.items).toHaveLength(0)
      expect(responseData.total_amount).toBe(0)
    })
  })
  
  describe('addToCart 添加到购物车', () => {
    let req, res, testUser, testProduct
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const productData = TestDataFactory.createProduct({ stock: 10 })
      testProduct = await Product.create(productData)
      
      req = {
        user: testUser,
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该添加商品到购物车', async () => {
      req.body = {
        product_id: testProduct.id,
        quantity: 2
      }
      
      await CartController.addToCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '添加成功'
      })
      
      const cartItem = await Cart.findOne({
        where: {
          user_id: testUser.id,
          product_id: testProduct.id
        }
      })
      
      expect(cartItem).toBeTruthy()
      expect(cartItem.quantity).toBe(2)
    })
    
    it('重复添加应该增加数量', async () => {
      // 第一次添加
      await Cart.create({
        user_id: testUser.id,
        product_id: testProduct.id,
        quantity: 2
      })
      
      // 第二次添加
      req.body = {
        product_id: testProduct.id,
        quantity: 3
      }
      
      await CartController.addToCart(req, res)
      
      const cartItem = await Cart.findOne({
        where: {
          user_id: testUser.id,
          product_id: testProduct.id
        }
      })
      
      expect(cartItem.quantity).toBe(5) // 2 + 3
    })
    
    it('应该检查库存', async () => {
      req.body = {
        product_id: testProduct.id,
        quantity: 999
      }
      
      await CartController.addToCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('库存不足')
      })
    })
    
    it('应该验证商品存在', async () => {
      req.body = {
        product_id: 99999,
        quantity: 1
      }
      
      await CartController.addToCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '商品不存在'
      })
    })
    
    it('应该验证数量为正数', async () => {
      req.body = {
        product_id: testProduct.id,
        quantity: 0
      }
      
      await CartController.addToCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('数量必须大于0')
      })
    })
    
    it('应该拒绝已下架商品', async () => {
      await testProduct.update({ status: 'inactive' })
      
      req.body = {
        product_id: testProduct.id,
        quantity: 1
      }
      
      await CartController.addToCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('已下架')
      })
    })
  })
  
  describe('updateCartItem 更新购物车商品', () => {
    let req, res, testUser, testProduct, testCartItem
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const productData = TestDataFactory.createProduct({ stock: 10 })
      testProduct = await Product.create(productData)
      
      testCartItem = await Cart.create({
        user_id: testUser.id,
        product_id: testProduct.id,
        quantity: 2
      })
      
      req = {
        user: testUser,
        params: { id: testCartItem.id },
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该更新购物车商品数量', async () => {
      req.body.quantity = 5
      
      await CartController.updateCartItem(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '更新成功'
      })
      
      await testCartItem.reload()
      expect(testCartItem.quantity).toBe(5)
    })
    
    it('应该检查库存', async () => {
      req.body.quantity = 999
      
      await CartController.updateCartItem(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('库存不足')
      })
    })
    
    it('应该拒绝数量为0', async () => {
      req.body.quantity = 0
      
      await CartController.updateCartItem(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('数量必须大于0')
      })
    })
    
    it('应该拒绝访问其他用户的购物车项', async () => {
      const otherUserData = await TestDataFactory.createUser({
        phone: '13900130002',
        email: 'other@example.com'
      })
      const otherUser = await User.create(otherUserData)
      
      const otherCartItem = await Cart.create({
        user_id: otherUser.id,
        product_id: testProduct.id,
        quantity: 1
      })
      
      req.params.id = otherCartItem.id
      req.body.quantity = 3
      
      await CartController.updateCartItem(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
    })
  })
  
  describe('removeFromCart 从购物车移除', () => {
    let req, res, testUser, testProduct, testCartItem
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      const productData = TestDataFactory.createProduct()
      testProduct = await Product.create(productData)
      
      testCartItem = await Cart.create({
        user_id: testUser.id,
        product_id: testProduct.id,
        quantity: 2
      })
      
      req = {
        user: testUser,
        params: { id: testCartItem.id }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该移除购物车商品', async () => {
      await CartController.removeFromCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '删除成功'
      })
      
      const deletedItem = await Cart.findByPk(testCartItem.id)
      expect(deletedItem).toBeNull()
    })
    
    it('应该返回404当商品不存在', async () => {
      req.params.id = 99999
      
      await CartController.removeFromCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
    })
    
    it('应该拒绝删除其他用户的购物车项', async () => {
      const otherUserData = await TestDataFactory.createUser({
        phone: '13900130003',
        email: 'other2@example.com'
      })
      const otherUser = await User.create(otherUserData)
      
      const otherCartItem = await Cart.create({
        user_id: otherUser.id,
        product_id: testProduct.id,
        quantity: 1
      })
      
      req.params.id = otherCartItem.id
      
      await CartController.removeFromCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
      
      // 验证商品没有被删除
      const stillExists = await Cart.findByPk(otherCartItem.id)
      expect(stillExists).toBeTruthy()
    })
  })
  
  describe('clearCart 清空购物车', () => {
    let req, res, testUser, testCartItems
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      testCartItems = []
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          name: `商品${i + 1}`
        })
        const product = await Product.create(productData)
        
        const cartItem = await Cart.create({
          user_id: testUser.id,
          product_id: product.id,
          quantity: 1
        })
        testCartItems.push(cartItem)
      }
      
      req = {
        user: testUser
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该清空购物车', async () => {
      await CartController.clearCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '购物车已清空'
      })
      
      const remainingItems = await Cart.findAll({
        where: { user_id: testUser.id }
      })
      
      expect(remainingItems).toHaveLength(0)
    })
    
    it('清空空购物车应该成功', async () => {
      await Cart.destroy({ where: { user_id: testUser.id } })
      
      await CartController.clearCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
    })
  })
  
  describe('batchAddToCart 批量添加到购物车', () => {
    let req, res, testUser, testProducts
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      testProducts = []
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          name: `商品${i + 1}`,
          stock: 10
        })
        const product = await Product.create(productData)
        testProducts.push(product)
      }
      
      req = {
        user: testUser,
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该批量添加商品到购物车', async () => {
      req.body.items = [
        { product_id: testProducts[0].id, quantity: 1 },
        { product_id: testProducts[1].id, quantity: 2 },
        { product_id: testProducts[2].id, quantity: 3 }
      ]
      
      await CartController.batchAddToCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(201)
      
      const cartItems = await Cart.findAll({
        where: { user_id: testUser.id }
      })
      
      expect(cartItems).toHaveLength(3)
    })
    
    it('应该验证所有商品存在', async () => {
      req.body.items = [
        { product_id: testProducts[0].id, quantity: 1 },
        { product_id: 99999, quantity: 1 }
      ]
      
      await CartController.batchAddToCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('商品不存在')
      })
    })
    
    it('应该检查所有商品库存', async () => {
      req.body.items = [
        { product_id: testProducts[0].id, quantity: 1 },
        { product_id: testProducts[1].id, quantity: 999 }
      ]
      
      await CartController.batchAddToCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('库存不足')
      })
    })
  })
  
  describe('getCartCount 获取购物车商品数量', () => {
    let req, res, testUser
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      // 添加3个商品，数量分别为1, 2, 3
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          name: `商品${i + 1}`
        })
        const product = await Product.create(productData)
        
        await Cart.create({
          user_id: testUser.id,
          product_id: product.id,
          quantity: i + 1
        })
      }
      
      req = {
        user: testUser
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回购物车商品种类数', async () => {
      await CartController.getCartCount(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.count).toBe(3) // 3种商品
    })
    
    it('应该返回购物车商品总数量', async () => {
      await CartController.getCartCount(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.total_quantity).toBe(6) // 1+2+3
    })
    
    it('空购物车应该返回0', async () => {
      await Cart.destroy({ where: { user_id: testUser.id } })
      
      await CartController.getCartCount(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.count).toBe(0)
      expect(responseData.total_quantity).toBe(0)
    })
  })
  
  describe('validateCart 验证购物车', () => {
    let req, res, testUser, testProducts, testCartItems
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
      
      testProducts = []
      testCartItems = []
      
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          name: `商品${i + 1}`,
          stock: 5,
          status: 'active'
        })
        const product = await Product.create(productData)
        testProducts.push(product)
        
        const cartItem = await Cart.create({
          user_id: testUser.id,
          product_id: product.id,
          quantity: 3
        })
        testCartItems.push(cartItem)
      }
      
      req = {
        user: testUser
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该验证购物车所有商品可用', async () => {
      await CartController.validateCart(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.valid).toBe(true)
      expect(responseData.issues).toHaveLength(0)
    })
    
    it('应该检测库存不足', async () => {
      await testProducts[0].update({ stock: 1 })
      
      await CartController.validateCart(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.valid).toBe(false)
      expect(responseData.issues.length).toBeGreaterThan(0)
      expect(responseData.issues[0].type).toBe('insufficient_stock')
    })
    
    it('应该检测商品已下架', async () => {
      await testProducts[1].update({ status: 'inactive' })
      
      await CartController.validateCart(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.valid).toBe(false)
      expect(responseData.issues.some(issue => issue.type === 'product_unavailable')).toBe(true)
    })
    
    it('应该检测商品已删除', async () => {
      await testProducts[2].destroy()
      
      await CartController.validateCart(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.valid).toBe(false)
      expect(responseData.issues.some(issue => issue.type === 'product_not_found')).toBe(true)
    })
  })
})
