import { describe, it, expect, beforeEach, vi } from 'vitest'
import ProductController from '@server/controllers/productController.js'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('ProductController 单元测试', () => {
  let sequelize, Product
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    Product = sequelize.models.Product
  })
  
  describe('getProducts 获取商品列表', () => {
    let req, res, testProducts
    
    beforeEach(async () => {
      testProducts = []
      const categories = ['电子产品', '服装', '食品']
      
      for (let i = 0; i < 9; i++) {
        const productData = TestDataFactory.createProduct({
          name: `商品${i + 1}`,
          category: categories[i % 3],
          price: (i + 1) * 100,
          stock: 10,
          status: i < 6 ? 'active' : 'inactive'
        })
        const product = await Product.create(productData)
        testProducts.push(product)
      }
      
      req = {
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回所有商品', async () => {
      await ProductController.getProducts(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.products.length).toBeGreaterThan(0)
      expect(responseData.total).toBe(9)
    })
    
    it('应该支持按分类筛选', async () => {
      req.query.category = '电子产品'
      
      await ProductController.getProducts(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.products.every(p => p.category === '电子产品')).toBe(true)
    })
    
    it('应该支持按状态筛选', async () => {
      req.query.status = 'active'
      
      await ProductController.getProducts(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.products.every(p => p.status === 'active')).toBe(true)
    })
    
    it('应该支持按名称搜索', async () => {
      req.query.search = '商品1'
      
      await ProductController.getProducts(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.products.some(p => p.name.includes('商品1'))).toBe(true)
    })
    
    it('应该支持价格区间筛选', async () => {
      req.query.min_price = 200
      req.query.max_price = 500
      
      await ProductController.getProducts(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      responseData.products.forEach(p => {
        expect(p.price).toBeGreaterThanOrEqual(200)
        expect(p.price).toBeLessThanOrEqual(500)
      })
    })
    
    it('应该支持分页', async () => {
      req.query.page = 1
      req.query.page_size = 5
      
      await ProductController.getProducts(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.products.length).toBeLessThanOrEqual(5)
    })
    
    it('应该支持排序', async () => {
      req.query.sort_by = 'price'
      req.query.order = 'DESC'
      
      await ProductController.getProducts(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      if (responseData.products.length > 1) {
        expect(responseData.products[0].price).toBeGreaterThanOrEqual(
          responseData.products[1].price
        )
      }
    })
  })
  
  describe('getProductById 获取商品详情', () => {
    let req, res, testProduct
    
    beforeEach(async () => {
      const productData = TestDataFactory.createProduct()
      testProduct = await Product.create(productData)
      
      req = {
        params: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回商品详情', async () => {
      req.params.id = testProduct.id
      
      await ProductController.getProductById(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: testProduct.id,
          name: testProduct.name
        })
      })
    })
    
    it('应该返回404当商品不存在', async () => {
      req.params.id = 99999
      
      await ProductController.getProductById(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '商品不存在'
      })
    })
  })
  
  describe('createProduct 创建商品', () => {
    let req, res
    
    beforeEach(() => {
      req = {
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该创建新商品', async () => {
      const productData = TestDataFactory.createProduct()
      req.body = productData
      
      await ProductController.createProduct(req, res)
      
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '商品创建成功',
        data: expect.objectContaining({
          name: productData.name,
          price: productData.price
        })
      })
    })
    
    it('应该验证必填字段', async () => {
      req.body = {
        name: '测试商品'
        // 缺少其他必填字段
      }
      
      await ProductController.createProduct(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('必填')
      })
    })
    
    it('应该验证价格为正数', async () => {
      const productData = TestDataFactory.createProduct({ price: -100 })
      req.body = productData
      
      await ProductController.createProduct(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
    })
    
    it('应该验证库存为非负数', async () => {
      const productData = TestDataFactory.createProduct({ stock: -10 })
      req.body = productData
      
      await ProductController.createProduct(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
    })
  })
  
  describe('updateProduct 更新商品', () => {
    let req, res, testProduct
    
    beforeEach(async () => {
      const productData = TestDataFactory.createProduct()
      testProduct = await Product.create(productData)
      
      req = {
        params: { id: testProduct.id },
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该更新商品信息', async () => {
      req.body = {
        name: '更新后的商品名',
        price: 999
      }
      
      await ProductController.updateProduct(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '商品更新成功'
      })
      
      await testProduct.reload()
      expect(testProduct.name).toBe('更新后的商品名')
      expect(testProduct.price).toBe(999)
    })
    
    it('应该返回404当商品不存在', async () => {
      req.params.id = 99999
      req.body = { name: '更新' }
      
      await ProductController.updateProduct(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
    })
    
    it('应该验证更新数据的有效性', async () => {
      req.body = {
        price: -100
      }
      
      await ProductController.updateProduct(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
    })
  })
  
  describe('deleteProduct 下架商品（逻辑删除）', () => {
    let req, res, testProduct
    
    beforeEach(async () => {
      const productData = TestDataFactory.createProduct()
      testProduct = await Product.create(productData)
      
      req = {
        params: { id: testProduct.id }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该逻辑下架商品', async () => {
      await ProductController.deleteProduct(req, res)

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '产品已下架'
      })
      
      const notVisible = await Product.findByPk(testProduct.id)
      expect(notVisible).toBeNull()

      const archived = await Product.findByPk(testProduct.id, { paranoid: false })
      expect(archived).not.toBeNull()
      expect(archived.deleted_at).toBeTruthy()
    })
    
    it('应该返回404当商品不存在', async () => {
      req.params.id = 99999
      
      await ProductController.deleteProduct(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
    })

    it('已有订单明细引用时仍可下架', async () => {
      const Order = sequelize.models.Order
      const OrderItem = sequelize.models.OrderItem
      const User = sequelize.models.User
      const user = await User.create(await TestDataFactory.createUser())
      const order = await Order.create(TestDataFactory.createOrder(user.id))
      await OrderItem.create(TestDataFactory.createOrderItem(order.id, testProduct.id))

      await ProductController.deleteProduct(req, res)

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '产品已下架'
      })
      const archived = await Product.findByPk(testProduct.id, { paranoid: false })
      expect(archived).not.toBeNull()
      expect(archived.deleted_at).toBeTruthy()
    })
  })
  
  describe('updateStock 更新库存', () => {
    let req, res, testProduct
    
    beforeEach(async () => {
      const productData = TestDataFactory.createProduct({ stock: 100 })
      testProduct = await Product.create(productData)
      
      req = {
        params: { id: testProduct.id },
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该增加库存', async () => {
      req.body = {
        type: 'increase',
        quantity: 50
      }
      
      await ProductController.updateStock(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      await testProduct.reload()
      expect(testProduct.stock).toBe(150)
    })
    
    it('应该减少库存', async () => {
      req.body = {
        type: 'decrease',
        quantity: 30
      }
      
      await ProductController.updateStock(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      await testProduct.reload()
      expect(testProduct.stock).toBe(70)
    })
    
    it('应该拒绝库存不足时的减少操作', async () => {
      req.body = {
        type: 'decrease',
        quantity: 150
      }
      
      await ProductController.updateStock(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('库存不足')
      })
    })
    
    it('应该验证数量为正数', async () => {
      req.body = {
        type: 'increase',
        quantity: -10
      }
      
      await ProductController.updateStock(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
    })
  })
  
  describe('checkStock 检查库存', () => {
    let req, res, testProduct
    
    beforeEach(async () => {
      const productData = TestDataFactory.createProduct({ stock: 50 })
      testProduct = await Product.create(productData)
      
      req = {
        params: { id: testProduct.id },
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回库存信息', async () => {
      await ProductController.checkStock(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          product_id: testProduct.id,
          stock: 50,
          available: true
        })
      })
    })
    
    it('应该检查指定数量是否可用', async () => {
      req.query.quantity = 30
      
      await ProductController.checkStock(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.available).toBe(true)
    })
    
    it('应该返回库存不足信息', async () => {
      req.query.quantity = 100
      
      await ProductController.checkStock(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.available).toBe(false)
    })
  })
  
  describe('getCategories 获取商品分类', () => {
    let req, res
    
    beforeEach(async () => {
      // 创建不同分类的商品
      const categories = ['电子产品', '服装', '食品', '电子产品', '服装']
      
      for (let i = 0; i < categories.length; i++) {
        const productData = TestDataFactory.createProduct({
          name: `商品${i + 1}`,
          category: categories[i]
        })
        await Product.create(productData)
      }
      
      req = {}
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回所有分类', async () => {
      await ProductController.getCategories(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.categories).toContain('电子产品')
      expect(responseData.categories).toContain('服装')
      expect(responseData.categories).toContain('食品')
    })
    
    it('分类应该去重', async () => {
      await ProductController.getCategories(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      const uniqueCategories = [...new Set(responseData.categories)]
      expect(responseData.categories.length).toBe(uniqueCategories.length)
    })
  })
  
  describe('updateProductStatus 更新商品状态', () => {
    let req, res, testProduct
    
    beforeEach(async () => {
      const productData = TestDataFactory.createProduct({ status: 'active' })
      testProduct = await Product.create(productData)
      
      req = {
        params: { id: testProduct.id },
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该上架商品', async () => {
      await testProduct.update({ status: 'inactive' })
      
      req.body.status = 'active'
      
      await ProductController.updateProductStatus(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      await testProduct.reload()
      expect(testProduct.status).toBe('active')
    })
    
    it('应该下架商品', async () => {
      req.body.status = 'inactive'
      
      await ProductController.updateProductStatus(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      await testProduct.reload()
      expect(testProduct.status).toBe('inactive')
    })
    
    it('应该验证状态值', async () => {
      req.body.status = 'invalid_status'
      
      await ProductController.updateProductStatus(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
    })
  })
  
  describe('batchUpdateProducts 批量更新商品', () => {
    let req, res, testProducts
    
    beforeEach(async () => {
      testProducts = []
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          name: `商品${i + 1}`,
          status: 'active'
        })
        const product = await Product.create(productData)
        testProducts.push(product)
      }
      
      req = {
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该批量更新商品状态', async () => {
      req.body = {
        product_ids: testProducts.map(p => p.id),
        updates: {
          status: 'inactive'
        }
      }
      
      await ProductController.batchUpdateProducts(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      for (const product of testProducts) {
        await product.reload()
        expect(product.status).toBe('inactive')
      }
    })
    
    it('应该批量更新商品价格', async () => {
      req.body = {
        product_ids: testProducts.map(p => p.id),
        updates: {
          price: 999
        }
      }
      
      await ProductController.batchUpdateProducts(req, res)
      
      for (const product of testProducts) {
        await product.reload()
        expect(product.price).toBe(999)
      }
    })
    
    it('应该验证商品ID数组', async () => {
      req.body = {
        product_ids: [],
        updates: { status: 'inactive' }
      }
      
      await ProductController.batchUpdateProducts(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
    })
  })
  
  describe('getProductStatistics 商品统计', () => {
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
    
    it('应该返回商品统计信息', async () => {
      await ProductController.getProductStatistics(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      
      expect(responseData).toHaveProperty('total_products')
      expect(responseData).toHaveProperty('active_products')
      expect(responseData).toHaveProperty('inactive_products')
      expect(responseData).toHaveProperty('out_of_stock')
      expect(responseData).toHaveProperty('category_count')
      
      expect(responseData.total_products).toBe(9)
      expect(responseData.active_products).toBe(6)
      expect(responseData.inactive_products).toBe(3)
      expect(responseData.out_of_stock).toBe(3)
    })
  })
})
