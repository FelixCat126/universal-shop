import Product from '../models/Product.js'
import ProductCategory from '../models/ProductCategory.js'
import Cart from '../models/Cart.js'
import sequelize from '../config/database.js'
import { Op } from 'sequelize'
import { logger } from '../utils/logger.js'
import { resolvePagination } from '../utils/pagination.js'

class ProductController {
  // 获取所有产品（分页和搜索）
  static async getProducts(req, res) {
    try {
      const {
        name = '',
        category_id: categoryIdParam = '',
        category: categoryLegacy = '',
        stockStatus = '',
        listingStatus = ''
      } = req.query

      // 公开接口：分页参数统一 clamp，防止负 offset / 超大 limit 打到数据库
      const { page, pageSize, limit, offset } = resolvePagination(req.query, { maxPageSize: 100 })

      // 构建查询条件
      const where = {}

      const categoryKey = categoryIdParam !== '' && categoryIdParam != null
        ? categoryIdParam
        : categoryLegacy
      if (categoryKey !== '' && categoryKey != null) {
        const cid = parseInt(String(categoryKey), 10)
        if (!Number.isNaN(cid)) {
          where.category_id = cid
        }
      }

      // 名称搜索（支持中文和泰文）
      if (name) {
        where[Op.or] = [
          { name: { [Op.like]: `%${name}%` } },
          { name_th: { [Op.like]: `%${name}%` } }
        ]
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
        include: [
          {
            model: ProductCategory,
            as: 'productCategory',
            attributes: ['id', 'name'],
            required: false
          }
        ],
        offset,
        limit,
        order,
        paranoid,
        subQuery: false,
        distinct: true
      })

      // 转换数据格式，将 image 字段映射为 image_url
      const products = rows.map(product => {
        const productData = product.toJSON()
        if (productData.productCategory) {
          productData.category = {
            id: productData.productCategory.id,
            name: productData.productCategory.name
          }
        }
        delete productData.productCategory
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
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize)
        }
      })
    } catch (error) {
      logger.error('获取产品列表失败', { err: error?.message, stack: error?.stack })
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
      const product = await Product.findByPk(id, {
        paranoid: !req.admin,
        include: [
          {
            model: ProductCategory,
            as: 'productCategory',
            attributes: ['id', 'name'],
            required: false
          }
        ]
      })

      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      // 转换数据格式，将 image 字段映射为 image_url
      const productData = product.toJSON()
      if (productData.productCategory) {
        productData.category = {
          id: productData.productCategory.id,
          name: productData.productCategory.name
        }
      }
      delete productData.productCategory
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
      logger.error('获取产品详情失败', { err: error?.message, stack: error?.stack })
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
        category_id: category_id_raw,
        price,
        stock,
        discount,
        image,
        points
      } = req.body

      // 兼容旧字段 category（数字字符串仅作兼容）
      const category_id = category_id_raw !== undefined ? category_id_raw : req.body.category

      // 验证必填字段
      if (!name || category_id === undefined || category_id === null || category_id === '' || price === undefined || stock === undefined) {
        return res.status(400).json({
          success: false,
          message: '请填写所有必填字段'
        })
      }

      const cid = parseInt(String(category_id), 10)
      if (!Number.isInteger(cid) || cid < 1) {
        return res.status(400).json({
          success: false,
          message: '请选择有效的产品分类'
        })
      }
      const cat = await ProductCategory.findByPk(cid)
      if (!cat) {
        return res.status(400).json({
          success: false,
          message: '产品分类不存在'
        })
      }

      const pts = points === undefined || points === null || points === ''
        ? 0
        : Number(points)
      if (!Number.isInteger(pts) || pts < 0) {
        return res.status(400).json({
          success: false,
          message: '积分必须为非负整数'
        })
      }

      // 价格：0-99999999 的有限数值，拒绝 NaN/Infinity/null/空串（Number(null|Number('') 为 0，需显式拦截）
      const priceNum = (price === null || price === '') ? NaN : Number(price)
      if (!Number.isFinite(priceNum) || priceNum < 0 || priceNum > 99999999) {
        return res.status(400).json({
          success: false,
          message: '价格必须为 0-99999999 之间的有效数字'
        })
      }

      // 库存：0-100000000 的非负整数，拒绝小数与字符串拼接（如 "10abc"）
      const stockNum = (stock === null || stock === '') ? NaN : Number(stock)
      if (!Number.isInteger(stockNum) || stockNum < 0 || stockNum > 100000000) {
        return res.status(400).json({
          success: false,
          message: '库存必须为 0-100000000 之间的整数'
        })
      }

      // 折扣：null/'' 视为无折扣；否则必须是 0-100 的整数（在控制器层拦截，避免落到模型校验变 500）
      let discountNum = null
      if (discount !== undefined && discount !== null && discount !== '') {
        const d = Number(discount)
        if (!Number.isInteger(d) || d < 0 || d > 100) {
          return res.status(400).json({
            success: false,
            message: '折扣必须为 0-100 之间的整数'
          })
        }
        discountNum = d
      }

      const product = await Product.create({
        name,
        alias: alias || null,
        description,
        category_id: cid,
        price: priceNum,
        stock: stockNum,
        discount: discountNum,
        image: image || null,
        points: pts
      })

      await product.reload({
        include: [
          {
            model: ProductCategory,
            as: 'productCategory',
            attributes: ['id', 'name'],
            required: false
          }
        ]
      })
      const created = product.toJSON()
      if (created.productCategory) {
        created.category = {
          id: created.productCategory.id,
          name: created.productCategory.name
        }
      }
      delete created.productCategory

      res.status(201).json({
        success: true,
        message: '产品创建成功',
        data: created
      })
    } catch (error) {
      logger.error('创建产品失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '创建产品失败',
        error: error.message
      })
    }
  }

  // 更新产品
  static async updateProduct (req, res) {
    try {
      const { id } = req.params
      const {
        name,
        alias,
        description,
        category_id: patchCidRaw,
        price,
        stock,
        discount,
        image,
        points
      } = req.body

      const legacyCat = req.body.category

      const product = await Product.findByPk(id, { paranoid: !req.admin })
      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      let nextPoints = product.points
      if (points !== undefined) {
        const pts = points === null || points === '' ? 0 : Number(points)
        if (!Number.isInteger(pts) || pts < 0) {
          return res.status(400).json({
            success: false,
            message: '积分必须为非负整数'
          })
        }
        nextPoints = pts
      }

      const cidInput = patchCidRaw !== undefined && patchCidRaw !== null && patchCidRaw !== ''
        ? patchCidRaw
        : legacyCat

      let nextCategoryId = product.category_id
      if (cidInput !== undefined && cidInput !== null && cidInput !== '') {
        const u = parseInt(String(cidInput), 10)
        if (!Number.isInteger(u) || u < 1) {
          return res.status(400).json({
            success: false,
            message: '请选择有效的产品分类'
          })
        }
        const exists = await ProductCategory.findByPk(u)
        if (!exists) {
          return res.status(400).json({
            success: false,
            message: '产品分类不存在'
          })
        }
        nextCategoryId = u
      }

      // 价格：仅在传入时校验，0-99999999 的有限数值
      let nextPrice = product.price
      if (price !== undefined) {
        const p = (price === null || price === '') ? NaN : Number(price)
        if (!Number.isFinite(p) || p < 0 || p > 99999999) {
          return res.status(400).json({
            success: false,
            message: '价格必须为 0-99999999 之间的有效数字'
          })
        }
        nextPrice = p
      }

      // 库存：仅在传入时校验，0-100000000 的非负整数，拒绝小数与字符串拼接
      let nextStock = product.stock
      if (stock !== undefined) {
        const s = (stock === null || stock === '') ? NaN : Number(stock)
        if (!Number.isInteger(s) || s < 0 || s > 100000000) {
          return res.status(400).json({
            success: false,
            message: '库存必须为 0-100000000 之间的整数'
          })
        }
        nextStock = s
      }

      // 折扣：null/'' 表示清除折扣；否则必须是 0-100 的整数（在控制器层拦截，避免落到模型校验变 500）
      let nextDiscount = product.discount
      if (discount !== undefined) {
        if (discount === null || discount === '') {
          nextDiscount = null
        } else {
          const d = Number(discount)
          if (!Number.isInteger(d) || d < 0 || d > 100) {
            return res.status(400).json({
              success: false,
              message: '折扣必须为 0-100 之间的整数'
            })
          }
          nextDiscount = d
        }
      }

      await product.update({
        name: name || product.name,
        alias: alias !== undefined ? (alias || null) : product.alias,
        description: description !== undefined ? description : product.description,
        category_id: nextCategoryId,
        price: nextPrice,
        stock: nextStock,
        discount: nextDiscount,
        image: image !== undefined ? image : product.image,
        points: nextPoints
      })

      await product.reload({
        paranoid: !req.admin,
        include: [
          {
            model: ProductCategory,
            as: 'productCategory',
            attributes: ['id', 'name'],
            required: false
          }
        ]
      })

      const out = product.toJSON()
      if (out.productCategory) {
        out.category = {
          id: out.productCategory.id,
          name: out.productCategory.name
        }
      }
      delete out.productCategory

      res.json({
        success: true,
        message: '产品更新成功',
        data: out
      })
    } catch (error) {
      logger.error('更新产品失败', { err: error?.message, stack: error?.stack })
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
      logger.error('下架产品失败', { err: error?.message, stack: error?.stack })
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
      logger.error('重新上架失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '重新上架失败',
        error: error.message
      })
    }
  }

  /**
   * 调整库存：原子化（不再 read-then-write 丢更新）
   * - set:      UPDATE stock = q
   * - add:      UPDATE stock = stock + q
   * - subtract: UPDATE stock = stock - q WHERE stock >= q（不足直接拒绝）
   */
  static async adjustStock (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      const q = parseInt(req.body.quantity, 10)
      const { type } = req.body
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的产品 ID' })
      }
      if (!['set', 'add', 'subtract'].includes(type)) {
        return res.status(400).json({ success: false, message: '无效的调整类型' })
      }
      if (!Number.isInteger(q) || q < 0 || q > 1000000) {
        return res.status(400).json({ success: false, message: '调整数量无效（0-1000000）' })
      }

      const product = await Product.findByPk(id, { paranoid: !req.admin })
      if (!product) {
        return res.status(404).json({ success: false, message: '产品不存在' })
      }
      const oldStock = product.stock

      let affected = 0
      if (type === 'set') {
        ;[affected] = await Product.update({ stock: q }, { where: { id } })
      } else if (type === 'add') {
        ;[affected] = await Product.update(
          { stock: sequelize.literal(`stock + ${q}`) },
          { where: { id } }
        )
      } else {
        ;[affected] = await Product.update(
          { stock: sequelize.literal(`stock - ${q}`) },
          { where: { id, stock: { [Op.gte]: q } } }
        )
        if (!affected) {
          return res.status(400).json({ success: false, message: '库存不足，无法扣减' })
        }
      }

      const fresh = await Product.findByPk(id, { paranoid: !req.admin })
      res.json({
        success: true,
        message: '库存调整成功',
        data: {
          oldStock,
          newStock: fresh ? fresh.stock : null,
          product: fresh
        }
      })
    } catch (error) {
      logger.error('调整库存失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({ success: false, message: '调整库存失败' })
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
      logger.error('检查库存失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '检查库存失败',
        error: error.message
      })
    }
  }
}

export default ProductController