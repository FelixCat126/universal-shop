import Cart from '../models/Cart.js'
import Product from '../models/Product.js'
import ProductCategory from '../models/ProductCategory.js'
import Bundle from '../models/Bundle.js'
import BundleItem from '../models/BundleItem.js'
import { Op } from 'sequelize'
import { logger } from '../utils/logger.js'

/** 组合包行组件 include（加购可售性校验与购物车组件摘要共用） */
const BUNDLE_ITEMS_INCLUDE = [{
  model: BundleItem,
  as: 'items',
  include: [{
    model: Product,
    as: 'product',
    attributes: ['id', 'name', 'name_th', 'price', 'discount', 'stock', 'status']
  }]
}]

/**
 * 组合包可售性校验：可售套数 = min(floor(组件 stock / 配比数量))，
 * 组件商品不存在/已下架视为不可售；返回 null 表示可售，否则返回错误消息
 */
function checkBundleAvailability (bundle, quantityNum) {
  const components = Array.isArray(bundle.items) ? bundle.items : []
  if (components.length === 0) {
    return '组合包没有组件商品'
  }
  for (const comp of components) {
    const p = comp.product
    if (!p || p.status !== 'active') {
      return `组件商品 ${p ? p.name : comp.product_id} 已下架`
    }
    if (Math.floor(Number(p.stock) / comp.quantity) < quantityNum) {
      return `组件商品 ${p.name} 库存不足`
    }
  }
  return null
}

class CartController {
  // 获取购物车内容
  static async getCart(req, res) {
    try {
      const userId = req.user?.userId
      const sessionId = req.headers['session-id'] || req.sessionID

      // 构建查询条件
      const where = {}
      
      if (userId) {
        where.user_id = userId
      } else if (sessionId) {
        where.session_id = sessionId
        where.user_id = null
      } else {
        return res.json({
          success: true,
          data: []
        })
      }

      const cartItems = await Cart.findAll({
        where,
        include: [
          {
            model: Product,
            as: 'product',
            attributes: ['id', 'name', 'description', 'price', 'points', 'discount', 'stock', 'image', 'category_id'],
            include: [{
              model: ProductCategory,
              as: 'productCategory',
              attributes: ['id', 'name'],
              required: false
            }]
          },
          // P4 组合包行：带 bundle 快照（名称/图片/组件摘要）
          {
            model: Bundle,
            as: 'bundle',
            attributes: ['id', 'name', 'name_th', 'image', 'price', 'status'],
            required: false,
            include: [{
              model: BundleItem,
              as: 'items',
              attributes: ['id', 'product_id', 'quantity'],
              required: false,
              include: [{
                model: Product,
                as: 'product',
                attributes: ['id', 'name', 'name_th', 'price', 'discount', 'stock'],
                required: false
              }]
            }]
          }
        ],
        order: [['created_at', 'DESC']]
      })

      // 转换数据格式，添加 image_url 字段
      const items = cartItems.map(item => {
        const itemData = item.toJSON()
        if (itemData.product && itemData.product.image) {
          itemData.product.image_url = itemData.product.image
        }
        if (itemData.bundle && itemData.bundle.image) {
          itemData.bundle.image_url = itemData.bundle.image
        }
        return itemData
      })

      res.json({
        success: true,
        data: items
      })
    } catch (error) {
      logger.error('获取购物车失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取购物车失败',
        error: error.message
      })
    }
  }

  // 添加商品到购物车
  static async addToCart(req, res) {
    try {
      const { product_id, bundle_id, quantity = 1 } = req.body
      const userId = req.user?.userId
      const sessionId = req.headers['session-id'] || req.sessionID

      // P4：product_id（单品）与 bundle_id（组合包）必须且只能传其一
      const hasProduct = !(product_id === undefined || product_id === null || product_id === '')
      const hasBundle = !(bundle_id === undefined || bundle_id === null || bundle_id === '')
      if (hasProduct === hasBundle) {
        return res.status(400).json({
          success: false,
          message: '商品与组合包必须且只能传其一'
        })
      }

      if (hasBundle) {
        return await CartController._addBundleToCart(req, res, { bundle_id, quantity, userId, sessionId })
      }

      // 产品ID：正整数（字符串数字先转数值再校验）
      if (product_id === undefined || product_id === null || product_id === '') {
        return res.status(400).json({
          success: false,
          message: '产品ID不能为空'
        })
      }
      const productId = Number(product_id)
      if (!Number.isInteger(productId) || productId < 1) {
        return res.status(400).json({
          success: false,
          message: '无效的产品ID'
        })
      }

      // 数量：1-5000 的整数，拒绝小数/非数字/超大值
      const quantityNum = Number(quantity)
      if (!Number.isInteger(quantityNum) || quantityNum < 1 || quantityNum > 5000) {
        return res.status(400).json({
          success: false,
          message: '数量必须为 1-5000 之间的整数'
        })
      }

      // 验证产品是否存在
      const product = await Product.findByPk(productId)
      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      // 检查库存
      if (product.stock < quantityNum) {
        return res.status(400).json({
          success: false,
          message: '库存不足'
        })
      }

      // 构建查询和创建条件
      const where = { product_id: productId }
      const cartData = {
        product_id: productId,
        quantity: quantityNum,
        price: product.price
      }

      if (userId) {
        where.user_id = userId
        cartData.user_id = userId
      } else {
        // 对于未登录用户，生成一个临时会话ID
        const tempSessionId = sessionId || `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        where.session_id = tempSessionId
        where.user_id = null
        cartData.session_id = tempSessionId
        
        // 返回会话ID给前端用于后续请求
        res.setHeader('Session-ID', tempSessionId)
      }

      // 检查是否已存在该商品
      let existingItem = await Cart.findOne({ where })

      if (!existingItem) {
        try {
          // 创建新的购物车项目
          const cartItem = await Cart.create(cartData)

          return res.json({
            success: true,
            message: '已加入购物车',
            data: cartItem
          })
        } catch (e) {
          // 并发下 findOne→create 间隙撞唯一索引（登录用户 unique_user_product，
          // 游客 unique_session_product_guest）：另一请求已建行，重读同一行后
          // 继续走下方"更新数量"分支，不再 500
          if (e?.name !== 'SequelizeUniqueConstraintError') throw e
          existingItem = await Cart.findOne({ where })
          if (!existingItem) throw e
        }
      }

      // 更新数量（数值相加，quantityNum 已校验为整数）
      const newQuantity = existingItem.quantity + quantityNum

      // 再次检查库存
      if (product.stock < newQuantity) {
        return res.status(400).json({
          success: false,
          message: `库存不足，当前库存：${product.stock}，购物车已有：${existingItem.quantity}`
        })
      }

      await existingItem.update({
        quantity: newQuantity,
        price: product.price // 更新价格为当前价格
      })

      res.json({
        success: true,
        message: '购物车已更新',
        data: existingItem
      })
    } catch (error) {
      logger.error('添加到购物车失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '添加到购物车失败',
        error: error.message
      })
    }
  }

  /**
   * P4：组合包加购（addToCart 的 bundle 分支）
   * 校验：bundle 存在且 active、数量整数 1-99、可售性（全部组件库存按配比足够）；
   * price 存组合价；existingItem 按 bundle_id 查找（唯一索引 unique_user_bundle /
   * unique_session_bundle_guest 兜底并发双插，与商品行同一套"撞索引后重读"模式）；
   * 响应结构与商品行一致
   */
  static async _addBundleToCart(req, res, { bundle_id, quantity, userId, sessionId }) {
    const bundleId = Number(bundle_id)
    if (!Number.isInteger(bundleId) || bundleId < 1) {
      return res.status(400).json({
        success: false,
        message: '无效的组合包ID'
      })
    }

    // 数量：1-99 的整数（组合包按套计，上限低于单品）
    const quantityNum = Number(quantity)
    if (!Number.isInteger(quantityNum) || quantityNum < 1 || quantityNum > 99) {
      return res.status(400).json({
        success: false,
        message: '组合包数量必须为 1-99 之间的整数'
      })
    }

    const bundle = await Bundle.findByPk(bundleId, { include: BUNDLE_ITEMS_INCLUDE })
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: '组合包不存在'
      })
    }
    if (bundle.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: '组合包已下架'
      })
    }

    const unavailableMsg = checkBundleAvailability(bundle, quantityNum)
    if (unavailableMsg) {
      return res.status(400).json({
        success: false,
        message: unavailableMsg
      })
    }

    // 构建查询和创建条件（组合包行 product_id 恒为 NULL）
    const where = { bundle_id: bundleId }
    const cartData = {
      product_id: null,
      bundle_id: bundleId,
      quantity: quantityNum,
      price: bundle.price
    }

    if (userId) {
      where.user_id = userId
      cartData.user_id = userId
    } else {
      // 对于未登录用户，生成一个临时会话ID
      const tempSessionId = sessionId || `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      where.session_id = tempSessionId
      where.user_id = null
      cartData.session_id = tempSessionId

      // 返回会话ID给前端用于后续请求
      res.setHeader('Session-ID', tempSessionId)
    }

    // 检查是否已存在该组合包
    let existingItem = await Cart.findOne({ where })

    if (!existingItem) {
      try {
        const cartItem = await Cart.create(cartData)

        return res.json({
          success: true,
          message: '已加入购物车',
          data: cartItem
        })
      } catch (e) {
        // 并发下 findOne→create 间隙撞 bundle 部分唯一索引：另一请求已建行，
        // 重读同一行后继续走下方"更新数量"分支，不再 500
        if (e?.name !== 'SequelizeUniqueConstraintError') throw e
        existingItem = await Cart.findOne({ where })
        if (!existingItem) throw e
      }
    }

    // 更新数量（数值相加，quantityNum 已校验为整数）
    const newQuantity = existingItem.quantity + quantityNum
    if (newQuantity > 99) {
      return res.status(400).json({
        success: false,
        message: `组合包数量不能超过 99，购物车已有：${existingItem.quantity}`
      })
    }

    // 按累加后数量重新校验可售性
    const unavailableMsg2 = checkBundleAvailability(bundle, newQuantity)
    if (unavailableMsg2) {
      return res.status(400).json({
        success: false,
        message: `${unavailableMsg2}，购物车已有：${existingItem.quantity}`
      })
    }

    await existingItem.update({
      quantity: newQuantity,
      price: bundle.price // 更新价格为当前组合价
    })

    return res.json({
      success: true,
      message: '购物车已更新',
      data: existingItem
    })
  }

  // 更新购物车商品数量
  static async updateCartItem(req, res) {
    try {
      const { id } = req.params
      const { quantity } = req.body
      const userId = req.user?.userId
      const sessionId = req.headers['session-id'] || req.sessionID

      // 验证数量：1-5000 的整数，拒绝小数/字符串/超大值
      const quantityNum = Number(quantity)
      if (!Number.isInteger(quantityNum) || quantityNum < 1 || quantityNum > 5000) {
        return res.status(400).json({
          success: false,
          message: '数量必须为 1-5000 之间的整数'
        })
      }

      // 构建查询条件
      const where = { id }
      if (userId) {
        where.user_id = userId
      } else if (sessionId) {
        where.session_id = sessionId
        where.user_id = null
      } else {
        return res.status(400).json({
          success: false,
          message: '无法识别用户或会话'
        })
      }

      const cartItem = await Cart.findOne({
        where,
        include: [
          {
            model: Product,
            as: 'product'
          }
        ]
      })

      if (!cartItem) {
        return res.status(404).json({
          success: false,
          message: '购物车项目不存在'
        })
      }

      // P4 组合包行：数量 1-99，按组件库存校验可售性（product 为 NULL，不走商品库存分支）
      if (cartItem.bundle_id) {
        if (quantityNum > 99) {
          return res.status(400).json({
            success: false,
            message: '组合包数量必须为 1-99 之间的整数'
          })
        }
        const bundle = await Bundle.findByPk(cartItem.bundle_id, { include: BUNDLE_ITEMS_INCLUDE })
        if (!bundle || bundle.status !== 'active') {
          return res.status(400).json({
            success: false,
            message: '组合包已下架'
          })
        }
        const unavailableMsg = checkBundleAvailability(bundle, quantityNum)
        if (unavailableMsg) {
          return res.status(400).json({
            success: false,
            message: unavailableMsg
          })
        }
        await cartItem.update({
          quantity: quantityNum,
          price: bundle.price // 更新价格为当前组合价
        })
        return res.json({
          success: true,
          message: '购物车已更新',
          data: cartItem
        })
      }

      // 检查库存
      if (cartItem.product.stock < quantityNum) {
        return res.status(400).json({
          success: false,
          message: `库存不足，当前库存：${cartItem.product.stock}`
        })
      }

      await cartItem.update({
        quantity: quantityNum,
        price: cartItem.product.price // 更新价格为当前价格
      })

      res.json({
        success: true,
        message: '购物车已更新',
        data: cartItem
      })
    } catch (error) {
      logger.error('更新购物车失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '更新购物车失败',
        error: error.message
      })
    }
  }

  // 从购物车删除商品
  static async removeFromCart(req, res) {
    try {
      const { id } = req.params
      const userId = req.user?.userId
      const sessionId = req.headers['session-id'] || req.sessionID

      // 构建查询条件
      const where = { id }
      if (userId) {
        where.user_id = userId
      } else if (sessionId) {
        where.session_id = sessionId
        where.user_id = null
      } else {
        return res.status(400).json({
          success: false,
          message: '无法识别用户或会话'
        })
      }

      const cartItem = await Cart.findOne({ where })

      if (!cartItem) {
        return res.status(404).json({
          success: false,
          message: '购物车项目不存在'
        })
      }

      await cartItem.destroy()

      res.json({
        success: true,
        message: '已从购物车删除'
      })
    } catch (error) {
      logger.error('删除购物车项目失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '删除购物车项目失败',
        error: error.message
      })
    }
  }

  // 清空购物车
  static async clearCart(req, res) {
    try {
      const userId = req.user?.userId
      const sessionId = req.headers['session-id'] || req.sessionID

      // 构建查询条件
      const where = {}
      if (userId) {
        where.user_id = userId
      } else if (sessionId) {
        where.session_id = sessionId
        where.user_id = null
      } else {
        return res.status(400).json({
          success: false,
          message: '无法识别用户或会话'
        })
      }

      await Cart.destroy({ where })

      res.json({
        success: true,
        message: '购物车已清空'
      })
    } catch (error) {
      logger.error('清空购物车失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '清空购物车失败',
        error: error.message
      })
    }
  }
}

export default CartController