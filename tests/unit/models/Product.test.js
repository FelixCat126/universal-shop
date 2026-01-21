import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('Product 模型', () => {
  let sequelize, Product
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    Product = sequelize.models.Product
  })
  
  describe('基本功能', () => {
    it('应该创建商品', async () => {
      const productData = TestDataFactory.createProduct()
      const product = await Product.create(productData)
      
      expect(product.id).toBeDefined()
      expect(product.name).toBe(productData.name)
      expect(product.price).toBe(productData.price)
      expect(product.stock).toBe(productData.stock)
      expect(product.status).toBe('active')
    })
    
    it('应该正确处理商品别名', async () => {
      const productData = TestDataFactory.createProduct({
        name: '测试商品',
        alias: 'test-product'
      })
      const product = await Product.create(productData)
      
      expect(product.alias).toBe('test-product')
    })
    
    it('应该支持多语言商品名', async () => {
      const productData = TestDataFactory.createProduct({
        name: 'Test Product',
        name_th: 'สินค้าทดสอบ'
      })
      const product = await Product.create(productData)
      
      expect(product.name).toBe('Test Product')
      expect(product.name_th).toBe('สินค้าทดสอบ')
    })
  })
  
  describe('价格和折扣处理', () => {
    it('应该正确存储价格', async () => {
      const productData = TestDataFactory.createProduct({
        price: 99.99
      })
      const product = await Product.create(productData)
      
      expect(product.price).toBe(99.99)
    })
    
    it('应该支持折扣设置', async () => {
      const productData = TestDataFactory.createProduct({
        price: 100,
        discount: 20 // 20% 折扣
      })
      const product = await Product.create(productData)
      
      expect(product.discount).toBe(20)
    })
    
    it('应该允许没有折扣的商品', async () => {
      const productData = TestDataFactory.createProduct({
        price: 100,
        discount: null
      })
      const product = await Product.create(productData)
      
      expect(product.discount).toBeNull()
    })
    
    it('应该计算实际销售价格（含折扣）', async () => {
      const productData = TestDataFactory.createProduct({
        price: 100,
        discount: 25 // 25% 折扣
      })
      const product = await Product.create(productData)
      
      // 计算实际价格：100 * (1 - 0.25) = 75
      const actualPrice = product.discount ? 
        product.price * (1 - product.discount / 100) : 
        product.price
      
      expect(actualPrice).toBe(75)
    })
  })
  
  describe('库存管理', () => {
    it('应该正确设置初始库存', async () => {
      const productData = TestDataFactory.createProduct({
        stock: 50
      })
      const product = await Product.create(productData)
      
      expect(product.stock).toBe(50)
    })
    
    it('应该支持零库存', async () => {
      const productData = TestDataFactory.createProduct({
        stock: 0
      })
      const product = await Product.create(productData)
      
      expect(product.stock).toBe(0)
    })
    
    it('应该能够更新库存', async () => {
      const productData = TestDataFactory.createProduct({
        stock: 100
      })
      const product = await Product.create(productData)
      
      // 更新库存（模拟销售）
      await product.update({ stock: product.stock - 5 })
      expect(product.stock).toBe(95)
    })
  })
  
  describe('商品状态管理', () => {
    it('应该默认状态为active', async () => {
      const productData = TestDataFactory.createProduct()
      delete productData.status // 测试默认值
      
      const product = await Product.create(productData)
      expect(product.status).toBe('active')
    })
    
    it('应该支持inactive状态', async () => {
      const productData = TestDataFactory.createProduct({
        status: 'inactive'
      })
      const product = await Product.create(productData)
      
      expect(product.status).toBe('inactive')
    })
    
    it('应该能够切换商品状态', async () => {
      const productData = TestDataFactory.createProduct({
        status: 'active'
      })
      const product = await Product.create(productData)
      
      // 禁用商品
      await product.update({ status: 'inactive' })
      expect(product.status).toBe('inactive')
      
      // 重新启用商品
      await product.update({ status: 'active' })
      expect(product.status).toBe('active')
    })
  })
  
  describe('商品分类', () => {
    it('应该正确设置商品分类', async () => {
      const productData = TestDataFactory.createProduct({
        category: '电子产品'
      })
      const product = await Product.create(productData)
      
      expect(product.category).toBe('电子产品')
    })
    
    it('应该支持查找同分类商品', async () => {
      // 创建同分类的多个商品
      const category = '手机配件'
      const products = []
      
      for (let i = 0; i < 3; i++) {
        const productData = TestDataFactory.createProduct({
          category,
          name: `商品 ${i + 1}`
        })
        const product = await Product.create(productData)
        products.push(product)
      }
      
      // 查找同分类商品
      const categoryProducts = await Product.findAll({
        where: { category }
      })
      
      expect(categoryProducts).toHaveLength(3)
      categoryProducts.forEach(product => {
        expect(product.category).toBe(category)
      })
    })
  })
  
  describe('图片管理', () => {
    it('应该支持商品图片', async () => {
      const productData = TestDataFactory.createProduct({
        image: '/uploads/products/test-image.jpg'
      })
      const product = await Product.create(productData)
      
      expect(product.image).toBe('/uploads/products/test-image.jpg')
    })
    
    it('应该允许没有图片的商品', async () => {
      const productData = TestDataFactory.createProduct({
        image: null
      })
      const product = await Product.create(productData)
      
      expect(product.image).toBeNull()
    })
  })
  
  describe('数据验证', () => {
    it('应该验证必填字段', async () => {
      const incompleteData = {
        description: '只有描述'
        // 缺少必填字段如name, price等
      }
      
      await expect(Product.create(incompleteData)).rejects.toThrow()
    })
    
    it('应该验证价格为数字', async () => {
      const productData = TestDataFactory.createProduct({
        price: 'invalid_price'
      })
      
      await expect(Product.create(productData)).rejects.toThrow()
    })
    
    it('应该验证库存为整数', async () => {
      const productData = TestDataFactory.createProduct({
        stock: 'invalid_stock'
      })
      
      await expect(Product.create(productData)).rejects.toThrow()
    })
    
    it('应该验证状态值', async () => {
      const productData = TestDataFactory.createProduct({
        status: 'invalid_status'
      })
      
      await expect(Product.create(productData)).rejects.toThrow()
    })
  })
  
  describe('查询功能', () => {
    beforeEach(async () => {
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
    
    it('应该能按分类查询商品', async () => {
      const products = await Product.findAll({
        where: { category: '电子产品' }
      })
      
      expect(products).toHaveLength(3)
    })
    
    it('应该能查询有库存的商品', async () => {
      const products = await Product.findAll({
        where: { 
          stock: { [sequelize.Sequelize.Op.gt]: 0 },
          status: 'active'
        }
      })
      
      expect(products).toHaveLength(2) // 手机和保护套
    })
    
    it('应该能按价格范围查询', async () => {
      const products = await Product.findAll({
        where: { 
          price: { 
            [sequelize.Sequelize.Op.between]: [50, 500] 
          }
        }
      })
      
      expect(products).toHaveLength(2) // 耳机和充电器
    })
    
    it('应该能模糊搜索商品名称', async () => {
      const products = await Product.findAll({
        where: { 
          name: { 
            [sequelize.Sequelize.Op.like]: '%机%' 
          }
        }
      })
      
      expect(products).toHaveLength(2) // 手机和耳机
    })
  })
})
