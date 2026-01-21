import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

describe('商品管理 API', () => {
  let sequelize
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
  })
  
  describe('GET /api/products - 获取商品列表', () => {
    beforeEach(async () => {
      const { Product } = sequelize.models
      
      // 创建测试商品
      const testProducts = [
        { name: '手机', category: '电子产品', price: 1000, stock: 10, status: 'active' },
        { name: '耳机', category: '电子产品', price: 200, stock: 0, status: 'active' },
        { name: '充电器', category: '电子产品', price: 50, stock: 5, status: 'inactive' },
        { name: '保护套', category: '配件', price: 30, stock: 20, status: 'active' }
      ]
      
      for (const data of testProducts) {
        const productData = TestDataFactory.createProduct(data)
        await Product.create(productData)
      }
    })
    
    it('应该返回所有激活状态的商品', async () => {
      const response = await request(app)
        .get('/api/products')
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.products.length).toBeGreaterThan(0)
      
      // 确保只返回激活状态的商品
      response.body.data.products.forEach(product => {
        expect(product.status).toBe('active')
      })
    })
    
    it('应该支持分页查询', async () => {
      const response = await request(app)
        .get('/api/products?page=1&pageSize=2')
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.products.length).toBeLessThanOrEqual(2)
      expect(response.body.data.pagination).toBeDefined()
      expect(response.body.data.pagination.page).toBe(1)
      expect(response.body.data.pagination.pageSize).toBe(2)
    })
    
    it('应该支持按分类筛选', async () => {
      const response = await request(app)
        .get('/api/products?category=电子产品')
        .expect(200)
      
      expect(response.body.success).toBe(true)
      response.body.data.products.forEach(product => {
        expect(product.category).toBe('电子产品')
      })
    })
    
    it('应该支持价格范围筛选', async () => {
      const response = await request(app)
        .get('/api/products?minPrice=100&maxPrice=500')
        .expect(200)
      
      expect(response.body.success).toBe(true)
      response.body.data.products.forEach(product => {
        expect(product.price).toBeGreaterThanOrEqual(100)
        expect(product.price).toBeLessThanOrEqual(500)
      })
    })
    
    it('应该支持关键词搜索', async () => {
      const response = await request(app)
        .get('/api/products?search=手机')
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.products.length).toBeGreaterThan(0)
      
      // 搜索结果应该包含关键词
      const hasKeyword = response.body.data.products.some(product => 
        product.name.includes('手机') || product.description?.includes('手机')
      )
      expect(hasKeyword).toBe(true)
    })
    
    it('应该支持库存状态筛选', async () => {
      const response = await request(app)
        .get('/api/products?inStock=true')
        .expect(200)
      
      expect(response.body.success).toBe(true)
      response.body.data.products.forEach(product => {
        expect(product.stock).toBeGreaterThan(0)
      })
    })
    
    it('应该支持排序', async () => {
      const response = await request(app)
        .get('/api/products?sortBy=price&sortOrder=desc')
        .expect(200)
      
      expect(response.body.success).toBe(true)
      
      // 验证价格降序排列
      const prices = response.body.data.products.map(p => p.price)
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).toBeLessThanOrEqual(prices[i - 1])
      }
    })
    
    it('应该正确处理无结果的查询', async () => {
      const response = await request(app)
        .get('/api/products?search=不存在的商品')
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.products).toHaveLength(0)
      expect(response.body.data.pagination.total).toBe(0)
    })
  })
  
  describe('GET /api/products/:id - 获取单个商品', () => {
    let testProduct
    
    beforeEach(async () => {
      const { Product } = sequelize.models
      const productData = TestDataFactory.createProduct({
        name: '测试商品',
        price: 100,
        stock: 10,
        status: 'active'
      })
      testProduct = await Product.create(productData)
    })
    
    it('应该返回指定商品的详细信息', async () => {
      const response = await request(app)
        .get(`/api/products/${testProduct.id}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBe(testProduct.id)
      expect(response.body.data.name).toBe(testProduct.name)
      expect(response.body.data.price).toBe(testProduct.price)
      expect(response.body.data.stock).toBe(testProduct.stock)
    })
    
    it('应该返回404对于不存在的商品', async () => {
      const response = await request(app)
        .get('/api/products/99999')
        .expect(404)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('商品不存在')
    })
    
    it('应该返回404对于已禁用的商品', async () => {
      // 禁用商品
      await testProduct.update({ status: 'inactive' })
      
      const response = await request(app)
        .get(`/api/products/${testProduct.id}`)
        .expect(404)
      
      expect(response.body.success).toBe(false)
    })
    
    it('应该返回商品的完整信息包括计算后的价格', async () => {
      // 设置折扣
      await testProduct.update({ discount: 20 })
      
      const response = await request(app)
        .get(`/api/products/${testProduct.id}`)
        .expect(200)
      
      expect(response.body.data.discount).toBe(20)
      expect(response.body.data.discounted_price).toBe(80) // 100 * 0.8
      expect(response.body.data.original_price).toBe(100)
    })
  })
  
  describe('POST /api/products/check-stock - 批量检查库存', () => {
    let testProducts
    
    beforeEach(async () => {
      const { Product } = sequelize.models
      testProducts = []
      
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          stock: 10,
          status: 'active'
        })
        const product = await Product.create(productData)
        testProducts.push(product)
      }
    })
    
    it('应该返回所有商品的库存状态', async () => {
      const response = await request(app)
        .post('/api/products/check-stock')
        .send({
          items: [
            { product_id: testProducts[0].id, quantity: 5 },
            { product_id: testProducts[1].id, quantity: 8 },
            { product_id: testProducts[2].id, quantity: 2 }
          ]
        })
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.items).toHaveLength(3)
      
      response.body.data.items.forEach(item => {
        expect(item.available).toBe(true)
        expect(item.stock).toBe(10)
      })
    })
    
    it('应该识别库存不足的商品', async () => {
      const response = await request(app)
        .post('/api/products/check-stock')
        .send({
          items: [
            { product_id: testProducts[0].id, quantity: 5 },   // 足够
            { product_id: testProducts[1].id, quantity: 15 },  // 不足
            { product_id: testProducts[2].id, quantity: 2 }    // 足够
          ]
        })
        .expect(200)
      
      expect(response.body.success).toBe(true)
      
      const insufficientItems = response.body.data.items.filter(item => !item.available)
      expect(insufficientItems).toHaveLength(1)
      expect(insufficientItems[0].product_id).toBe(testProducts[1].id)
    })
    
    it('应该处理不存在的商品', async () => {
      const response = await request(app)
        .post('/api/products/check-stock')
        .send({
          items: [
            { product_id: testProducts[0].id, quantity: 5 },
            { product_id: 99999, quantity: 1 }  // 不存在的商品
          ]
        })
        .expect(200)
      
      expect(response.body.success).toBe(true)
      
      const nonexistentItems = response.body.data.items.filter(item => !item.exists)
      expect(nonexistentItems).toHaveLength(1)
      expect(nonexistentItems[0].product_id).toBe(99999)
    })
    
    it('应该验证请求格式', async () => {
      const response = await request(app)
        .post('/api/products/check-stock')
        .send({
          // 缺少items字段
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('商品列表不能为空')
    })
    
    it('应该处理空商品列表', async () => {
      const response = await request(app)
        .post('/api/products/check-stock')
        .send({
          items: []
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('商品列表不能为空')
    })
  })
  
  describe('商品数据完整性', () => {
    it('应该返回商品的所有必要字段', async () => {
      const { Product } = sequelize.models
      const productData = TestDataFactory.createProduct({
        name: '完整商品信息',
        name_th: 'สินค้าทดสอบ',
        description: '详细描述',
        category: '测试分类',
        price: 199.99,
        discount: 15,
        stock: 25,
        status: 'active',
        image: '/uploads/test-image.jpg'
      })
      const product = await Product.create(productData)
      
      const response = await request(app)
        .get(`/api/products/${product.id}`)
        .expect(200)
      
      const productData2 = response.body.data
      expect(productData2).toHaveProperty('id')
      expect(productData2).toHaveProperty('name')
      expect(productData2).toHaveProperty('name_th')
      expect(productData2).toHaveProperty('description')
      expect(productData2).toHaveProperty('category')
      expect(productData2).toHaveProperty('price')
      expect(productData2).toHaveProperty('discount')
      expect(productData2).toHaveProperty('stock')
      expect(productData2).toHaveProperty('status')
      expect(productData2).toHaveProperty('image')
      expect(productData2).toHaveProperty('created_at')
      expect(productData2).toHaveProperty('updated_at')
      
      // 计算字段
      expect(productData2).toHaveProperty('discounted_price')
      expect(productData2).toHaveProperty('original_price')
      expect(productData2.discounted_price).toBe(169.99) // 199.99 * 0.85
    })
    
    it('应该正确处理无折扣的商品', async () => {
      const { Product } = sequelize.models
      const productData = TestDataFactory.createProduct({
        price: 100,
        discount: null
      })
      const product = await Product.create(productData)
      
      const response = await request(app)
        .get(`/api/products/${product.id}`)
        .expect(200)
      
      expect(response.body.data.discount).toBeNull()
      expect(response.body.data.discounted_price).toBe(100)
      expect(response.body.data.original_price).toBe(100)
    })
  })
  
  describe('商品搜索功能', () => {
    beforeEach(async () => {
      const { Product } = sequelize.models
      
      const testProducts = [
        { name: 'iPhone 15 Pro Max', category: '手机', price: 8999, description: '苹果最新旗舰手机' },
        { name: 'Samsung Galaxy S24', category: '手机', price: 7999, description: '三星旗舰Android手机' },
        { name: 'MacBook Pro', category: '笔记本', price: 12999, description: '苹果专业笔记本电脑' },
        { name: 'Dell XPS 13', category: '笔记本', price: 8999, description: '戴尔超薄笔记本' },
        { name: 'AirPods Pro', category: '耳机', price: 1999, description: '苹果无线降噪耳机' }
      ]
      
      for (const data of testProducts) {
        const productData = TestDataFactory.createProduct(data)
        await Product.create(productData)
      }
    })
    
    it('应该支持商品名称搜索', async () => {
      const response = await request(app)
        .get('/api/products?search=iPhone')
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.products.length).toBeGreaterThan(0)
      expect(response.body.data.products[0].name).toContain('iPhone')
    })
    
    it('应该支持描述内容搜索', async () => {
      const response = await request(app)
        .get('/api/products?search=苹果')
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.products.length).toBeGreaterThan(1)
    })
    
    it('应该支持不区分大小写搜索', async () => {
      const response = await request(app)
        .get('/api/products?search=macbook')
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.products.length).toBeGreaterThan(0)
    })
    
    it('应该支持复合搜索条件', async () => {
      const response = await request(app)
        .get('/api/products?search=手机&category=手机&minPrice=7000&maxPrice=9000')
        .expect(200)
      
      expect(response.body.success).toBe(true)
      response.body.data.products.forEach(product => {
        expect(product.category).toBe('手机')
        expect(product.price).toBeGreaterThanOrEqual(7000)
        expect(product.price).toBeLessThanOrEqual(9000)
      })
    })
  })
})
