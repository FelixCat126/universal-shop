import Product from '../models/Product.js'
import { Op } from 'sequelize'

class ProductController {
  // 获取所有产品（分页和搜索）
  static async getProducts(req, res) {
    try {
      const {
        page = 1,
        pageSize = 20,
        name = '',
        category = '',
        stockStatus = ''
      } = req.query

      const offset = (page - 1) * pageSize
      const limit = parseInt(pageSize)

      // 构建查询条件
      const where = {}

      // 名称搜索（支持中文和泰文）
      if (name) {
        where[Op.or] = [
          { name: { [Op.like]: `%${name}%` } },
          { name_th: { [Op.like]: `%${name}%` } }
        ]
      }

      // 分类筛选
      if (category) {
        where.category = category
      }

      // 库存状态筛选
      if (stockStatus) {
        switch (stockStatus) {
          case 'normal':
            where.stock = { [Op.gt]: 10 }
            break
          case 'low':
            where.stock = { [Op.and]: [{ [Op.gt]: 0 }, { [Op.lte]: 10 }] }
            break
          case 'out':
            where.stock = 0
            break
        }
      }

      // 查询数据
      const { count, rows } = await Product.findAndCountAll({
        where,
        offset,
        limit,
        order: [['created_at', 'DESC']]
      })

      // 转换数据格式，将 image 字段映射为 image_url
      const products = rows.map(product => {
        const productData = product.toJSON()
        if (productData.image) {
          productData.image_url = productData.image
        }
        return productData
      })

      res.json({
        success: true,
        data: {
          products: products,
          total: count,
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          totalPages: Math.ceil(count / pageSize)
        }
      })
    } catch (error) {
      console.error('获取产品列表失败:', error)
      res.status(500).json({
        success: false,
        message: '获取产品列表失败',
        error: error.message
      })
    }
  }

  // 获取单个产品
  static async getProduct(req, res) {
    try {
      const { id } = req.params
      const product = await Product.findByPk(id)

      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      // 转换数据格式，将 image 字段映射为 image_url
      const productData = product.toJSON()
      if (productData.image) {
        productData.image_url = productData.image
      }

      res.json({
        success: true,
        data: productData
      })
    } catch (error) {
      console.error('获取产品详情失败:', error)
      res.status(500).json({
        success: false,
        message: '获取产品详情失败',
        error: error.message
      })
    }
  }

  // 创建产品
  static async createProduct(req, res) {
    try {
      const {
        name,
        description,
        category,
        price,
        stock,
        discount,
        image
      } = req.body

      // 验证必填字段
      if (!name || !category || price === undefined || stock === undefined) {
        return res.status(400).json({
          success: false,
          message: '请填写所有必填字段'
        })
      }

      const product = await Product.create({
        name,
        description,
        category,
        price: parseFloat(price),
        stock: parseInt(stock),
        discount: discount !== undefined && discount !== null && discount !== '' ? parseInt(discount) : null,
        image: image || null
      })

      res.status(201).json({
        success: true,
        message: '产品创建成功',
        data: product
      })
    } catch (error) {
      console.error('创建产品失败:', error)
      res.status(500).json({
        success: false,
        message: '创建产品失败',
        error: error.message
      })
    }
  }

  // 更新产品
  static async updateProduct(req, res) {
    try {
      const { id } = req.params
      const {
        name,
        description,
        category,
        price,
        stock,
        discount,
        image
      } = req.body

      const product = await Product.findByPk(id)
      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      // 更新产品信息
      await product.update({
        name: name || product.name,
        description: description !== undefined ? description : product.description,
        category: category || product.category,
        price: price !== undefined ? parseFloat(price) : product.price,
        stock: stock !== undefined ? parseInt(stock) : product.stock,
        discount: discount !== undefined ? (discount === null || discount === '' ? null : parseInt(discount)) : product.discount,
        image: image !== undefined ? image : product.image
      })

      res.json({
        success: true,
        message: '产品更新成功',
        data: product
      })
    } catch (error) {
      console.error('更新产品失败:', error)
      res.status(500).json({
        success: false,
        message: '更新产品失败',
        error: error.message
      })
    }
  }

  // 删除产品
  static async deleteProduct(req, res) {
    try {
      const { id } = req.params
      const product = await Product.findByPk(id)

      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      await product.destroy()

      res.json({
        success: true,
        message: '产品删除成功'
      })
    } catch (error) {
      console.error('删除产品失败:', error)
      res.status(500).json({
        success: false,
        message: '删除产品失败',
        error: error.message
      })
    }
  }

  // 调整库存
  static async adjustStock(req, res) {
    try {
      const { id } = req.params
      const { type, quantity } = req.body // type: 'set' | 'add' | 'subtract'

      const product = await Product.findByPk(id)
      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      let newStock = product.stock
      switch (type) {
        case 'set':
          newStock = parseInt(quantity)
          break
        case 'add':
          newStock = product.stock + parseInt(quantity)
          break
        case 'subtract':
          newStock = Math.max(0, product.stock - parseInt(quantity))
          break
        default:
          return res.status(400).json({
            success: false,
            message: '无效的调整类型'
          })
      }

      await product.update({ stock: newStock })

      res.json({
        success: true,
        message: '库存调整成功',
        data: {
          oldStock: product.stock,
          newStock: newStock,
          product: product
        }
      })
    } catch (error) {
      console.error('调整库存失败:', error)
      res.status(500).json({
        success: false,
        message: '调整库存失败',
        error: error.message
      })
    }
  }

  // 批量检查商品库存
  static async checkStock(req, res) {
    try {
      const { productIds } = req.body

      if (!productIds || !Array.isArray(productIds)) {
        return res.status(400).json({
          success: false,
          message: '产品ID列表不能为空'
        })
      }

      const products = await Product.findAll({
        where: {
          id: productIds
        },
        attributes: ['id', 'stock']
      })

      res.json({
        success: true,
        data: products
      })
    } catch (error) {
      console.error('检查库存失败:', error)
      res.status(500).json({
        success: false,
        message: '检查库存失败',
        error: error.message
      })
    }
  }
}

export default ProductController