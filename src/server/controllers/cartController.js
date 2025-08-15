import Cart from '../models/Cart.js'
import Product from '../models/Product.js'
import { Op } from 'sequelize'

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
            attributes: ['id', 'name', 'name_th', 'description', 'description_th', 'price', 'discount', 'stock', 'image', 'category']
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
        return itemData
      })

      res.json({
        success: true,
        data: items
      })
    } catch (error) {
      console.error('获取购物车失败:', error)
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
      const { product_id, quantity = 1 } = req.body
      const userId = req.user?.userId
      const sessionId = req.headers['session-id'] || req.sessionID

      // 验证必填字段
      if (!product_id) {
        return res.status(400).json({
          success: false,
          message: '产品ID不能为空'
        })
      }

      // 验证产品是否存在
      const product = await Product.findByPk(product_id)
      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      // 检查库存
      if (product.stock < quantity) {
        return res.status(400).json({
          success: false,
          message: '库存不足'
        })
      }

      // 构建查询和创建条件
      const where = { product_id }
      const cartData = {
        product_id,
        quantity,
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
      const existingItem = await Cart.findOne({ where })

      if (existingItem) {
        // 更新数量
        const newQuantity = existingItem.quantity + quantity
        
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
      } else {
        // 创建新的购物车项目
        const cartItem = await Cart.create(cartData)

        res.json({
          success: true,
          message: '已加入购物车',
          data: cartItem
        })
      }
    } catch (error) {
      console.error('添加到购物车失败:', error)
      res.status(500).json({
        success: false,
        message: '添加到购物车失败',
        error: error.message
      })
    }
  }

  // 更新购物车商品数量
  static async updateCartItem(req, res) {
    try {
      const { id } = req.params
      const { quantity } = req.body
      const userId = req.user?.userId
      const sessionId = req.headers['session-id'] || req.sessionID

      // 验证数量
      if (!quantity || quantity < 1) {
        return res.status(400).json({
          success: false,
          message: '数量必须大于0'
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

      // 检查库存
      if (cartItem.product.stock < quantity) {
        return res.status(400).json({
          success: false,
          message: `库存不足，当前库存：${cartItem.product.stock}`
        })
      }

      await cartItem.update({ 
        quantity,
        price: cartItem.product.price // 更新价格为当前价格
      })

      res.json({
        success: true,
        message: '购物车已更新',
        data: cartItem
      })
    } catch (error) {
      console.error('更新购物车失败:', error)
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
      console.error('删除购物车项目失败:', error)
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
      console.error('清空购物车失败:', error)
      res.status(500).json({
        success: false,
        message: '清空购物车失败',
        error: error.message
      })
    }
  }
}

export default CartController