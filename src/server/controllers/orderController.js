import { Op } from 'sequelize'
import Order from '../models/Order.js'
import OrderItem from '../models/OrderItem.js'
import Product from '../models/Product.js'
import User from '../models/User.js'
import Cart from '../models/Cart.js'
import sequelize from '../config/database.js'
import UserController from './userController.js'

class OrderController {
  // 创建订单
  static async createOrder(req, res) {
    const transaction = await sequelize.transaction()
    
    try {
      const { 
        items,
        contact_name,
        contact_phone,
        delivery_address,
        payment_method = 'cod', // cod: 货到付款, online: 在线付款
        notes = ''
      } = req.body
      
      let userId = req.user?.userId
      let isGuestOrder = false
      
      // 如果用户未登录，检查是否为游客下单
      if (!userId) {
        // 验证手机号格式
        const phoneRegex = /^[1-9]\d{9,}$/
        if (!phoneRegex.test(contact_phone)) {
          return res.status(400).json({
            success: false,
            message: '手机号必须为不低于10位的纯数字且不能以0开头'
          })
        }
        
        // 尝试自动注册
        try {
          const newUser = await UserController.autoRegister(contact_phone, contact_name)
          userId = newUser.id
          isGuestOrder = true
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: error.message
          })
        }
      }

      // 验证订单项
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: '订单商品不能为空'
        })
      }

      // 验证收货信息
      if (!contact_name || !contact_phone || !delivery_address) {
        return res.status(400).json({
          success: false,
          message: '收货信息不能为空'
        })
      }

      let totalAmount = 0
      const orderItems = []

      // 验证商品库存和计算总价
      for (const item of items) {
        const product = await Product.findByPk(item.product_id)
        if (!product) {
          await transaction.rollback()
          return res.status(400).json({
            success: false,
            message: `商品ID ${item.product_id} 不存在`
          })
        }

        if (product.stock < item.quantity) {
          await transaction.rollback()
          return res.status(400).json({
            success: false,
            message: `商品 ${product.name_zh} 库存不足，当前库存：${product.stock}`
          })
        }

        // 计算实际价格（考虑折扣）
        let actualPrice = product.price
        if (product.discount && product.discount > 0) {
          actualPrice = product.price * (1 - product.discount / 100)
          actualPrice = parseFloat(actualPrice.toFixed(2))
        }

        const itemTotal = actualPrice * item.quantity
        totalAmount += itemTotal

        orderItems.push({
          product_id: item.product_id,
          quantity: item.quantity,
          price: actualPrice, // 实际支付价格
          original_price: product.price, // 原价
          discount: product.discount, // 折扣百分比
          product_name_zh: product.name,
          product_name_th: product.name_th || null
        })
      }

      // 生成订单号
      const orderNo = `ORD${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`

      // 创建订单
      const order = await Order.create({
        order_no: orderNo,
        user_id: userId,
        total_amount: totalAmount,
        payment_method,
        status: 'completed', // 订单提交即完成
        contact_name,
        contact_phone,
        delivery_address,
        notes
      }, { transaction })

      // 创建订单项
      for (const orderItem of orderItems) {
        await OrderItem.create({
          order_id: order.id,
          ...orderItem
        }, { transaction })

        // 减少商品库存
        await Product.decrement('stock', {
          by: orderItem.quantity,
          where: { id: orderItem.product_id },
          transaction
        })
      }

      // 清空用户购物车（如果订单来自购物车）
      if (req.body.clear_cart) {
        await Cart.destroy({
          where: { user_id: userId },
          transaction
        })
      }

      // 为游客用户创建默认地址
      if (isGuestOrder) {
        const Address = (await import('../models/Address.js')).default
        await Address.create({
          user_id: userId,
          contact_name,
          contact_phone,
          province: '未设置',
          city: '未设置', 
          district: '未设置',
          detail_address: delivery_address,
          full_address: `未设置未设置未设置${delivery_address}`, // 构建完整地址
          is_default: true
        }, { transaction })
      }

      await transaction.commit()

      // 返回创建的订单信息
      const createdOrder = await Order.findByPk(order.id, {
        include: [
          {
            model: OrderItem,
            as: 'items',
            include: [{
              model: Product,
              as: 'product'
            }]
          }
        ]
      })

      // 准备响应数据
      const responseData = {
        order: createdOrder
      }

      // 如果是游客下单，返回用户信息和token
      if (isGuestOrder) {
        const jwt = (await import('jsonwebtoken')).default
        const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here'
        
        const user = await User.findByPk(userId)
        const token = jwt.sign(
          { userId: user.id, username: user.username },
          JWT_SECRET,
          { expiresIn: '7d' }
        )
        
        responseData.user = user.toSafeJSON()
        responseData.token = token
        responseData.autoRegistered = true
      }

      res.status(201).json({
        success: true,
        message: '订单创建成功',
        data: responseData
      })

    } catch (error) {
      await transaction.rollback()
      console.error('创建订单失败:', error)
      res.status(500).json({
        success: false,
        message: '创建订单失败',
        error: error.message
      })
    }
  }

  // 获取用户订单列表
  static async getUserOrders(req, res) {
    try {
      const userId = req.user?.userId
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: '用户未登录'
        })
      }

      const { page = 1, limit = 10, status } = req.query
      const offset = (page - 1) * limit

      const where = { user_id: userId }
      if (status) {
        where.status = status
      }

      const { count, rows: orders } = await Order.findAndCountAll({
        where,
        order: [['created_at', 'DESC']],
        limit: parseInt(limit),
        offset: parseInt(offset)
      })

      res.json({
        success: true,
        data: {
          orders,
          total: count,
          page: parseInt(page),
          totalPages: Math.ceil(count / limit)
        }
      })

    } catch (error) {
      console.error('获取用户订单失败:', error)
      res.status(500).json({
        success: false,
        message: '获取订单列表失败',
        error: error.message
      })
    }
  }

  // 获取订单详情
  static async getOrderDetail(req, res) {
    try {
      const { id } = req.params
      const userId = req.user?.userId

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: '用户未登录'
        })
      }

      const order = await Order.findOne({
        where: { 
          id,
          user_id: userId 
        },
        include: [
          {
            model: OrderItem,
            as: 'items',
            include: [{
              model: Product,
              as: 'product'
            }]
          },
          {
            model: User,
            as: 'user',
            attributes: ['id', 'nickname', 'phone']
          }
        ]
      })

      if (!order) {
        return res.status(404).json({
          success: false,
          message: '订单不存在'
        })
      }

      // 转换数据格式，添加 image_url 字段
      const orderData = order.toJSON()
      if (orderData.items) {
        orderData.items = orderData.items.map(item => {
          if (item.product && item.product.image) {
            item.product.image_url = item.product.image
          }
          return item
        })
      }

      res.json({
        success: true,
        data: orderData
      })

    } catch (error) {
      console.error('获取订单详情失败:', error)
      res.status(500).json({
        success: false,
        message: '获取订单详情失败',
        error: error.message
      })
    }
  }

  // 管理员获取所有订单
  static async getAllOrders(req, res) {
    try {
      const { page = 1, limit = 20, status, startDate, endDate, keyword } = req.query
      const offset = (page - 1) * limit

      const where = {}
      if (status) {
        where.status = status
      }
      if (startDate && endDate) {
        where.created_at = {
          [Op.between]: [startDate, endDate]
        }
      }
      if (keyword) {
        where[Op.or] = [
          { order_no: { [Op.like]: `%${keyword}%` } },
          { contact_name: { [Op.like]: `%${keyword}%` } },
          { contact_phone: { [Op.like]: `%${keyword}%` } }
        ]
      }

      const { count, rows: orders } = await Order.findAndCountAll({
        where,
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'nickname', 'phone']
          }
        ],
        order: [['created_at', 'DESC']],
        limit: parseInt(limit),
        offset: parseInt(offset)
      })

      res.json({
        success: true,
        data: {
          orders,
          total: count,
          page: parseInt(page),
          totalPages: Math.ceil(count / limit)
        }
      })

    } catch (error) {
      console.error('获取所有订单失败:', error)
      res.status(500).json({
        success: false,
        message: '获取订单列表失败'
      })
    }
  }

  // 管理员更新订单状态
  static async updateOrderStatus(req, res) {
    try {
      const { id } = req.params
      const { status } = req.body

      const order = await Order.findByPk(id)
      if (!order) {
        return res.status(404).json({
          success: false,
          message: '订单不存在'
        })
      }

      await order.update({ status })

      res.json({
        success: true,
        message: '订单状态更新成功',
        data: order
      })

    } catch (error) {
      console.error('更新订单状态失败:', error)
      res.status(500).json({
        success: false,
        message: '更新订单状态失败'
      })
    }
  }

  // 管理员删除订单
  static async deleteOrder(req, res) {
    try {
      const { id } = req.params

      const order = await Order.findByPk(id)
      if (!order) {
        return res.status(404).json({
          success: false,
          message: '订单不存在'
        })
      }

      // 保存订单信息用于日志记录
      const orderInfo = {
        id: order.id,
        order_no: order.order_no,
        user_id: order.user_id,
        total_amount: order.total_amount,
        status: order.status
      }

      await order.destroy()

      res.json({
        success: true,
        message: '订单删除成功',
        data: {
          id: orderInfo.id,
          order_no: orderInfo.order_no,
          deletedOrder: orderInfo
        }
      })

    } catch (error) {
      console.error('删除订单失败:', error)
      res.status(500).json({
        success: false,
        message: '删除订单失败'
      })
    }
  }

  // 管理员导出订单
  static async exportOrders(req, res) {
    try {
      const { status, startDate, endDate } = req.query

      const where = {}
      if (status) {
        where.status = status
      }
      if (startDate && endDate) {
        where.created_at = {
          [Op.between]: [startDate, endDate]
        }
      }

      const orders = await Order.findAll({
        where,
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['nickname', 'phone']
          }
        ],
        order: [['created_at', 'DESC']]
      })

      // 简化的CSV导出
      const csvData = orders.map(order => ({
        订单号: order.order_no,
        用户昵称: order.user?.nickname || '未知',
        用户手机: order.user?.phone || '未知',
        总金额: order.total_amount,
        支付方式: order.payment_method === 'cod' ? '货到付款' : '在线付款',
        订单状态: order.status === 'completed' ? '已完成' : order.status,
        联系人: order.contact_name,
        联系电话: order.contact_phone,
        收货地址: order.delivery_address,
        创建时间: order.created_at
      }))

      res.json({
        success: true,
        data: csvData
      })

    } catch (error) {
      console.error('导出订单失败:', error)
      res.status(500).json({
        success: false,
        message: '导出订单失败'
      })
    }
  }
}

export default OrderController