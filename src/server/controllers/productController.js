import Product from '../models/Product.js'
import Cart from '../models/Cart.js'
import sequelize from '../config/database.js'
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
        stockStatus = '',
        listingStatus = '' // 管理端：all | on_shelf | delisted
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

      const isAdmin = !!req.admin
      const paranoid = !isAdmin

      if (isAdmin && listingStatus === 'on_shelf') {
        where.deleted_at = { [Op.is]: null }
      } else if (isAdmin && listingStatus === 'delisted') {
        where.deleted_at = { [Op.ne]: null }
      }

      // 管理端：先按是否已下架（在售优先），再按 status（active 优先），再按创建时间倒序
      const order = isAdmin
        ? [
            [sequelize.literal('(CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END)'), 'ASC'],
            [sequelize.literal("(CASE WHEN status = 'active' THEN 0 ELSE 1 END)"), 'ASC'],
            ['created_at', 'DESC']
          ]
        : [['created_at', 'DESC']]

      const { count, rows } = await Product.findAndCountAll({
        where,
        offset,
        limit,
        order,
        paranoid,
        subQuery: false
      })

      // 转换数据格式，将 image 字段映射为 image_url
      const products = rows.map(product => {
        const productData = product.toJSON()
        if (productData.image) {
          productData.image_url = productData.image
        }
        if (isAdmin) {
          const del = productData.deleted_at ?? productData.deletedAt
          productData.delisted = !!del
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
      const product = await Product.findByPk(id, { paranoid: !req.admin })

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
      if (req.admin) {
        const del = productData.deleted_at ?? productData.deletedAt
        productData.delisted = !!del
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
        alias,
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
        alias: alias || null,
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
        alias,
        description,
        category,
        price,
        stock,
        discount,
        image
      } = req.body

      const product = await Product.findByPk(id, { paranoid: !req.admin })
      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      // 更新产品信息
      await product.update({
        name: name || product.name,
        alias: alias !== undefined ? (alias || null) : product.alias,
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

  // 下架产品：逻辑删除（保留行与订单外键），并清理购物车中该商品
  static async deleteProduct(req, res) {
    try {
      const { id } = req.params
      const productId = parseInt(id, 10)
      if (Number.isNaN(productId)) {
        return res.status(400).json({
          success: false,
          message: '无效的产品ID'
        })
      }

      const product = await Product.findByPk(productId, { paranoid: false })

      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      if (product.deleted_at || product.deletedAt) {
        return res.status(400).json({
          success: false,
          message: '该商品已下架'
        })
      }

      await sequelize.transaction(async (t) => {
        await Cart.destroy({ where: { product_id: productId }, transaction: t })
        await product.destroy({ transaction: t })
      })

      res.json({
        success: true,
        message: '产品已下架'
      })
    } catch (error) {
      console.error('下架产品失败:', error)
      res.status(500).json({
        success: false,
        message: '下架产品失败',
        error: error.message
      })
    }
  }

  // 重新上架（清除软删除）
  static async restoreProduct(req, res) {
    try {
      if (!req.admin) {
        return res.status(403).json({
          success: false,
          message: '需要管理员登录后才能重新上架'
        })
      }

      const productId = parseInt(req.params.id, 10)
      if (Number.isNaN(productId)) {
        return res.status(400).json({
          success: false,
          message: '无效的产品ID'
        })
      }

      const product = await Product.findByPk(productId, { paranoid: false })
      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      if (!product.deleted_at && !product.deletedAt) {
        return res.status(400).json({
          success: false,
          message: '商品未下架，无需重新上架'
        })
      }

      await product.restore()

      res.json({
        success: true,
        message: '商品已重新上架',
        data: product
      })
    } catch (error) {
      console.error('重新上架失败:', error)
      res.status(500).json({
        success: false,
        message: '重新上架失败',
        error: error.message
      })
    }
  }

  // 调整库存
  static async adjustStock(req, res) {
    try {
      const { id } = req.params
      const { type, quantity } = req.body // type: 'set' | 'add' | 'subtract'

      const product = await Product.findByPk(id, { paranoid: !req.admin })
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