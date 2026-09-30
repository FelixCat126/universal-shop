import { Op } from 'sequelize'
import Order from '../models/Order.js'
import OrderItem from '../models/OrderItem.js'
import Product from '../models/Product.js'
import User from '../models/User.js'
import Cart from '../models/Cart.js'
import Address from '../models/Address.js'
import sequelize from '../config/database.js'
import UserController from './userController.js'
import { JWT_SECRET } from '../config/jwtSecret.js'
import { createUserAddress } from '../services/addressService.js'
import { normalizeExchangeRates, thbToBillingAmount, normalizeCheckoutCurrency } from '../utils/exchangeRates.js'
import * as pointsService from '../services/pointsService.js'
import { applyCreatedBetween } from '../utils/dateFilters.js'
import AuditLog from '../models/AuditLog.js'
import PointTransaction from '../models/PointTransaction.js'
import { resolvePagination } from '../utils/pagination.js'
import { sanitizeCell } from '../utils/sanitizeCell.js'
import { logger } from '../utils/logger.js'

/** 金额统一舍入到分：消除浮点误差，保证 Σ(行价×数量) 与订单总额严格一致 */
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// 订单状态合法值（与 exportController 的标签映射保持一致）
const ORDER_STATUS_VALUES = ['pending', 'paid', 'shipping', 'shipped', 'delivered', 'completed', 'cancelled']

// 订单状态机：completed / cancelled 为终态，不允许任何变更
const ORDER_STATUS_TRANSITIONS = {
  pending: ['paid', 'shipping', 'cancelled'],
  paid: ['shipping', 'cancelled'],
  shipping: ['shipped', 'delivered', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['completed'],
  completed: [],
  cancelled: []
}

// 删除订单时需要回补资源的状态：仅未进入履约流程的单才回补（已发货/已履约删除不回补，否则库存与积分虚增）
const RESTORE_ON_DELETE_STATUSES = ['pending', 'paid', 'shipping']

/**
 * 订单取消/删除时的资源回补（必须在事务内调用，order.items 需已加载）：
 * 1) 逐订单项回补库存（paranoid:false，商品被软删也要回补，否则库存静默丢失）；
 * 2) 积分换购单退回已扣积分；
 * 3) 已确认在线支付（已发购物积分）的单收回等量积分：一单可能有多条 earn_purchase
 *    流水（补发/重复发放），findAll 汇总收回总量；余额不足按 0 截断并记 warn
 */
export async function restoreOrderResources (order, transaction) {
  const items = Array.isArray(order.items) ? order.items : []
  for (const item of items) {
    const qty = parseInt(item.quantity, 10)
    if (!Number.isInteger(qty) || qty <= 0 || !item.product_id) continue
    await Product.update(
      { stock: sequelize.literal(`stock + ${qty}`) },
      // paranoid:false —— Product 是软删模型，默认过滤会让已软删商品的库存静默丢失
      { where: { id: item.product_id }, transaction, paranoid: false }
    )
  }

  const pointsRedeemed = Number(order.points_redeemed) || 0
  if (order.payment_method === 'points' && pointsRedeemed > 0) {
    await pointsService.refundPointsForOrder(transaction, {
      userId: order.user_id,
      orderId: order.id,
      points: pointsRedeemed,
      note: `订单取消退回积分 ${order.order_no}`
    })
  }

  if (order.online_paid_at) {
    // 一单可能有多条 earn_purchase 流水，findAll 汇总后按总量收回
    const earnTxs = await PointTransaction.findAll({
      where: { order_id: order.id, type: 'earn_purchase' },
      transaction
    })
    const earned = earnTxs.reduce((sum, tx) => sum + Math.abs(Number(tx.delta) || 0), 0)
    if (earned > 0) {
      const revokeResult = await pointsService.revokePurchasePoints(transaction, {
        userId: order.user_id,
        orderId: order.id,
        points: earned,
        note: `订单取消收回购物积分 ${order.order_no}`
      })
      if (revokeResult.truncated > 0) {
        logger.warn('订单取消收回购物积分时余额不足，已按 0 截断', {
          orderId: order.id,
          orderNo: order.order_no,
          userId: order.user_id,
          requested: revokeResult.requested,
          revoked: revokeResult.revoked
        })
      }
    }
  }
}

class OrderController {
  // 创建订单
  static async createOrder(req, res) {
    const paymentMethodRaw = req.body.payment_method != null ? String(req.body.payment_method) : ''
    const paymentMethod = ['cod', 'online', 'points'].includes(paymentMethodRaw)
      ? paymentMethodRaw
      : 'cod'
    if (paymentMethod === 'points' && !req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: '请先登录后再使用积分换购'
      })
    }

    const transaction = await sequelize.transaction()

    try {
      const {
        items,
        contact_name,
        contact_phone,
        delivery_address,
        notes = '',
        referral_code, // 推荐码（可选）
        // 登录用户的地址ID
        address_id,
        // 非登录用户的地址字段
        province = '',
        city = '',
        district = '',
        detail_address = '',
        postal_code = '',
        checkout_currency: checkoutCurrencyRaw
      } = req.body
      
      let userId = req.user?.userId
      let isGuestOrder = false
      
      // 标准化处理推荐码（在所有分支之前定义）
      const normalizedReferralCode = referral_code && typeof referral_code === 'string' && referral_code.trim() ? referral_code.trim() : null
      
      // 如果用户未登录，检查是否为游客下单
      if (!userId) {
        // 解析并验证手机号格式（包含国家区号）
        let countryCode = '+66' // 默认值
        let phoneNumber = contact_phone
        
        // 检查是否包含国家区号并解析
        const supportedCodes = ['+86', '+66', '+60']
        for (const code of supportedCodes) {
          if (contact_phone.startsWith(code)) {
            countryCode = code
            phoneNumber = contact_phone.substring(code.length)
            break
          }
        }
        
        // 验证手机号格式（纯数字，不能以0开头）
        const phoneRegex = /^[1-9]\d+$/
        if (!phoneRegex.test(phoneNumber)) {
          return res.status(400).json({
            success: false,
            message: '手机号必须为纯数字且不能以0开头'
          })
        }
        
        // 根据国家区号验证手机号长度
        let minLength
        let countryName
        switch (countryCode) {
          case '+86':
            minLength = 11
            countryName = '中国'
            break
          case '+60':
            minLength = 9
            countryName = '马来西亚'
            break
          case '+66':
            minLength = 9
            countryName = '泰国'
            break
        }
        
        if (phoneNumber.length < minLength) {
          return res.status(400).json({
            success: false,
            message: `${countryName}手机号必须不少于${minLength}位数字`
          })
        }
        
        // 调用统一的用户创建服务
        try {
          const newUser = await UserController.createUserForOrder(contact_phone, contact_name, normalizedReferralCode)
          userId = newUser.id
          isGuestOrder = true
        } catch (error) {
          logger.error('创建用户失败', { err: error?.message, stack: error?.stack })
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

      let totalAmountThb = 0
      let pointsPurchaseTotal = 0
      const orderItems = []

      // 批量查询商品信息（避免N+1查询）
      const productIds = items.map(item => item.product_id)
      const products = await Product.findAll({
        where: { id: productIds }
      })

      // 创建商品ID到商品对象的映射
      const productMap = new Map()
      products.forEach(product => {
        productMap.set(product.id, product)
      })

      // 验证商品库存和计算总价（仅做"友好"预检；真正扣减用条件 UPDATE 防超卖）
      for (const item of items) {
        const product = productMap.get(item.product_id)
        if (!product) {
          await transaction.rollback()
          return res.status(400).json({
            success: false,
            message: `商品ID ${item.product_id} 不存在`
          })
        }

        const qty = parseInt(item.quantity, 10)
        if (!Number.isInteger(qty) || qty < 1 || qty > 5000) {
          await transaction.rollback()
          return res.status(400).json({
            success: false,
            message: `商品 ${product.name} 数量无效（需为 1-5000 的整数）`
          })
        }

        if (product.stock < qty) {
          await transaction.rollback()
          return res.status(400).json({
            success: false,
            message: `商品 ${product.name} 库存不足，当前库存：${product.stock}`
          })
        }

        // 计算实际价格（考虑折扣），行价与行小计统一舍入到分
        let actualPrice = round2(product.price)
        if (product.discount && product.discount > 0) {
          actualPrice = round2(product.price * (1 - product.discount / 100))
        }

        const itemTotal = round2(actualPrice * qty)
        totalAmountThb = round2(totalAmountThb + itemTotal)

        const ptsUnit = Number(product.points) || 0
        const pointsLineCost = ptsUnit > 0 ? ptsUnit * item.quantity : 0
        if (paymentMethod === 'points') {
          if (ptsUnit <= 0 || pointsLineCost <= 0) {
            await transaction.rollback()
            return res.status(400).json({
              success: false,
              message: '积分换购订单中只能包含支持积分兑换的商品'
            })
          }
        }

        pointsPurchaseTotal += pointsLineCost

        orderItems.push({
          product_id: item.product_id,
          quantity: item.quantity,
          price: actualPrice,
          original_price: product.price,
          discount: product.discount,
          product_name_zh: product.name,
          product_name_th: product.name_th || null,
          points_line_cost: pointsLineCost
        })
      }

      const checkoutCurrency = normalizeCheckoutCurrency(checkoutCurrencyRaw)

      // 汇算比例：与门户计价一致（泰铢底价 × 比例 = 外币金额）
      const SystemConfig = (await import('../models/SystemConfig.js')).default
      let xrJson = await SystemConfig.getConfig('exchange_rates')
      if (!xrJson || typeof xrJson !== 'object') {
        const rateConfig = await SystemConfig.findOne({
          where: { config_key: 'exchange_rate' }
        })
        let usdFallback = 0
        if (rateConfig?.config_value) {
          const n = parseFloat(rateConfig.config_value)
          usdFallback = Number.isFinite(n) && n >= 0 ? n : 0
        }
        xrJson = {
          USD: usdFallback.toFixed(2),
          CNY: '0.00',
          MYR: '0.00'
        }
      }
      const normRates = normalizeExchangeRates(xrJson)

      if (paymentMethod !== 'points' && checkoutCurrency !== 'THB') {
        const need = parseFloat(normRates[checkoutCurrency])
        if (!Number.isFinite(need) || need <= 0) {
          await transaction.rollback()
          return res.status(400).json({
            success: false,
            message: `无法在所选币种 ${checkoutCurrency} 结账：系统未配置有效汇算比例或未启用该币种`
          })
        }
      }

      totalAmountThb = round2(totalAmountThb)

      let totalBilling
      if (paymentMethod === 'points') {
        totalAmountThb = 0
        totalBilling = 0
        if (!(pointsPurchaseTotal > 0)) {
          await transaction.rollback()
          return res.status(400).json({
            success: false,
            message: '无效的积分兑换数量'
          })
        }
      } else {
        totalBilling = thbToBillingAmount(totalAmountThb, checkoutCurrency, normRates)
      }
      const exchangeRateUsd = parseFloat(normRates.USD || '0')
      const exchangeRateSnapshot = Number.isFinite(exchangeRateUsd) ? exchangeRateUsd : 0
      // 获取完整的地址信息（省市区邮编）
      let orderProvince = province
      let orderCity = city  
      let orderDistrict = district
      let orderPostalCode = postal_code
      // 对于游客下单，优先使用分字段信息组装完整地址（确保包含邮编）
      let orderDeliveryAddress = delivery_address
      // 注意：游客在此前已自动注册并把 userId 赋成新用户 id，不能用 !userId 判断游客，须用 isGuestOrder
      if (isGuestOrder && province && city && detail_address) {
        // 游客下单：重新组装地址确保包含邮编
        const addressParts = [province.trim(), city.trim()]
        if (district && district.trim()) {
          addressParts.push(district.trim())
        }
        addressParts.push(detail_address.trim())
        if (postal_code && postal_code.trim()) {
          addressParts.push(postal_code.trim())
        }
        orderDeliveryAddress = addressParts.join(' ')
      }
      let orderContactName = contact_name
      let orderContactPhone = contact_phone


      // 如果是登录用户且提供了地址ID，查询地址信息
      if (userId && address_id) {
        
        const address = await Address.findOne({
          where: {
            id: address_id,
            user_id: userId
          }
        })
        
        if (!address) {
          return res.status(400).json({
            success: false,
            message: '选择的收货地址不存在或不属于当前用户'
          })
        }
        
        // 使用地址表中的完整信息
        orderProvince = address.province || ''
        orderCity = address.city || ''
        orderDistrict = address.district || ''
        orderPostalCode = address.postal_code || ''
        // 组装完整的配送地址（确保包含邮编）
        const baseAddress = address.full_address || `${address.province} ${address.city} ${address.district} ${address.detail_address}`.trim()
        orderDeliveryAddress = address.postal_code ? `${baseAddress} ${address.postal_code}` : baseAddress
        orderContactName = address.contact_name
        orderContactPhone = `${address.contact_country_code}${address.contact_phone}`

      }

      const initialOrderStatus = paymentMethod === 'online' ? 'pending' : 'shipping'

      /**
       * 订单号生成 + 唯一冲突重试（最多 5 次）：
       * 高并发下 Date.now+random 仍有概率撞 unique 约束，撞了就重生
       */
      const buildOrderNo = () => `ORD${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`
      let order = null
      let createTries = 0
      while (createTries < 5 && !order) {
        try {
          order = await Order.create({
            order_no: buildOrderNo(),
            user_id: userId,
            total_amount: totalBilling,
            total_amount_thb: totalAmountThb,
            currency_code: checkoutCurrency,
            payment_method: paymentMethod,
            points_redeemed: paymentMethod === 'points' ? pointsPurchaseTotal : null,
            status: initialOrderStatus,
            contact_name: orderContactName,
            contact_phone: orderContactPhone,
            delivery_address: orderDeliveryAddress,
            province: orderProvince,
            city: orderCity,
            district: orderDistrict,
            postal_code: orderPostalCode,
            notes,
            exchange_rate: exchangeRateSnapshot
          }, { transaction })
        } catch (err) {
          if (err && err.name === 'SequelizeUniqueConstraintError') {
            createTries++
            continue
          }
          throw err
        }
      }
      if (!order) {
        await transaction.rollback()
        return res.status(500).json({
          success: false,
          message: '生成订单号失败，请稍后重试'
        })
      }

      /**
       * 防超卖核心：用条件 UPDATE 原子扣库存。
       *   UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty
       * 受影响行 0 即视为库存不足；事务回滚整单。
       * 这一段同时承担"批量创建订单项"。
       */
      const orderItemRows = []
      for (const orderItem of orderItems) {
        const [affected] = await Product.update(
          { stock: sequelize.literal(`stock - ${parseInt(orderItem.quantity, 10)}`) },
          {
            where: {
              id: orderItem.product_id,
              stock: { [Op.gte]: parseInt(orderItem.quantity, 10) }
            },
            transaction
          }
        )
        if (!affected) {
          await transaction.rollback()
          return res.status(400).json({
            success: false,
            message: `商品库存不足（商品 ID ${orderItem.product_id}）`
          })
        }
        orderItemRows.push({ order_id: order.id, ...orderItem })
      }

      // 订单项一次性写入（避免循环 N 次插入）
      if (orderItemRows.length > 0) {
        await OrderItem.bulkCreate(orderItemRows, { transaction })
      }

      if (paymentMethod === 'points') {
        await pointsService.redeemPointsForOrder(transaction, {
          userId,
          orderId: order.id,
          points: pointsPurchaseTotal,
          note: `积分换购 ${order.order_no}`
        })
      }

      // 清空用户购物车（如果订单来自购物车）
      if (req.body.clear_cart) {
        await Cart.destroy({
          where: { user_id: userId },
          transaction
        })
      }

      // 为游客用户创建默认地址（复用统一逻辑）
      if (isGuestOrder) {
        // 将完整手机号切分为国家区号与本地号
        let contact_country_code = '+66'
        let phoneNumber = contact_phone
        const supportedCodes = ['+86', '+66', '+60']
        for (const code of supportedCodes) {
          if (contact_phone.startsWith(code)) {
            contact_country_code = code
            phoneNumber = contact_phone.substring(code.length)
            break
          }
        }

        await createUserAddress(
          {
            userId,
            contact_name,
            contact_country_code,
            contact_phone: phoneNumber,
            province,
            city,
            district,
            detail_address,
            postal_code,
            is_default: true,
            address_type: 'home'
          },
          transaction
        )
      }

      // COD 单在下单事务内直接发积分（与库存/订单同生共死；发放失败整单回滚，客户端可安全重试；
      // 若在提交后独立事务发放，取消窗口内 revoke 会查不到 earn 流水，用户白得积分）
      if (paymentMethod !== 'points' && paymentMethod !== 'online' && userId) {
        const qtySum = items.reduce((s, it) => s + Number(it.quantity || 0), 0)
        if (qtySum > 0) {
          await pointsService.grantPurchasePoints(userId, order.id, qtySum, { transaction })
        }
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
              as: 'product',
              paranoid: false
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

      AuditLog.logUser({
        user: req.user || (isGuestOrder ? { id: userId } : null),
        event: isGuestOrder ? 'order.create.guest' : 'order.create',
        resource: 'order',
        resourceId: order.id,
        detail: {
          payment_method: paymentMethod,
          item_count: items.length,
          total_amount: order.total_amount
        },
        req
      }).catch(() => {})

      res.status(201).json({
        success: true,
        message: '订单创建成功',
        data: responseData
      })

    } catch (error) {
      await transaction.rollback()
      logger.error('创建订单失败', { err: error?.message, stack: error?.stack })
      if (error && error.message === 'POINTS_INSUFFICIENT') {
        return res.status(400).json({
          success: false,
          message: '积分余额不足，请选择其他支付方式或减少兑换数量'
        })
      }
      res.status(500).json({
        success: false,
        message: '创建订单失败',
        error: error.message
      })
    }
  }

  /**
   * 在线支付订单：用户在支付弹窗内确认后转为送货中（并发放购物积分）
   * 幂等保障：用条件 UPDATE，仅当 status='pending' 且 online_paid_at IS NULL 时才置位；
   *   - 受影响行数 = 1：本次确认成功，发积分；
   *   - 受影响行数 = 0：已被并发请求/重复点击处理过，直接返回成功（幂等），不再发积分。
   */
  static async confirmOnlinePayment (req, res) {
    try {
      const userId = req.user?.userId
      if (!userId) {
        return res.status(401).json({ success: false, message: '请先登录' })
      }
      const id = parseInt(req.params.id, 10)
      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的订单 ID' })
      }
      const order = await Order.findOne({
        where: { id, user_id: userId },
        include: [{ model: OrderItem, as: 'items', attributes: ['quantity'] }]
      })
      if (!order) {
        return res.status(404).json({ success: false, message: '订单不存在' })
      }
      if (order.payment_method !== 'online') {
        return res.status(400).json({ success: false, message: '该订单不需要在线支付确认' })
      }
      if (order.online_paid_at) {
        // 已确认过（online_paid_at 已置位）：幂等返回成功，不重复发积分、不变更状态
        const ordered = await Order.findByPk(order.id, {
          include: [{ model: OrderItem, as: 'items', include: [{ model: Product, as: 'product', paranoid: false }] }]
        })
        return res.json({ success: true, message: '支付已确认', data: ordered })
      }
      if (order.status !== 'pending') {
        // 从未支付但被管理端改走（如已取消/已发货）：不允许再确认支付
        return res.status(409).json({ success: false, message: '订单当前状态不允许支付确认' })
      }

      /**
       * 条件 UPDATE 与发放购物积分必须在同一事务提交：
       * 原实现先提交 UPDATE、再在独立事务发积分，管理员若在该窗口取消订单，
       * 取消时的 revoke 查不到 earn 流水，用户会白得积分。
       * 发积分失败则整事务回滚、接口 500；客户端重试支付确认走幂等分支，安全。
       */
      const transaction = await sequelize.transaction()
      let affected = 0
      try {
        const updateResult = await Order.update(
          { status: 'shipping', online_paid_at: new Date() },
          {
            where: {
              id: order.id,
              user_id: userId,
              status: 'pending',
              online_paid_at: null
            },
            transaction
          }
        )
        affected = updateResult[0]

        if (affected === 1) {
          const qtySum = (order.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0)
          if (qtySum > 0) {
            await pointsService.grantPurchasePoints(userId, order.id, qtySum, { transaction })
          }
        }
        await transaction.commit()
      } catch (error) {
        await transaction.rollback().catch(() => {})
        logger.error('确认在线支付失败', { err: error?.message, stack: error?.stack })
        return res.status(500).json({ success: false, message: '确认支付失败' })
      }

      if (affected === 1) {
        AuditLog.logUser({
          user: { id: userId },
          event: 'order.payment.confirm',
          resource: 'order',
          resourceId: order.id,
          req
        }).catch(() => {})
      } else {
        AuditLog.logUser({
          user: { id: userId },
          event: 'order.payment.confirm.idempotent_hit',
          resource: 'order',
          resourceId: order.id,
          req
        }).catch(() => {})
      }

      const createdOrder = await Order.findByPk(order.id, {
        include: [
          {
            model: OrderItem,
            as: 'items',
            include: [{ model: Product, as: 'product', paranoid: false }]
          }
        ]
      })
      return res.json({
        success: true,
        message: '支付已确认',
        data: createdOrder
      })
    } catch (error) {
      logger.error('确认在线支付失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '确认支付失败' })
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
      const safeLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 10, 1), 100)
      const safePage = Math.max(Number.parseInt(String(page), 10) || 1, 1)
      const offset = (safePage - 1) * safeLimit

      let where = { user_id: userId }
      if (status) {
        where.status = status
      }
      where = applyCreatedBetween(where, req.query)

      const { count, rows: orders } = await Order.findAndCountAll({
        where,
        order: [['created_at', 'DESC']],
        limit: safeLimit,
        offset
      })

      const spentWhere = {
        ...where,
        payment_method: { [Op.ne]: 'points' }
      }
      const spentRaw = await Order.sum('total_amount_thb', { where: spentWhere })
      const spentThbSum = spentRaw != null && spentRaw !== ''
        ? parseFloat(String(spentRaw))
        : 0

      res.json({
        success: true,
        data: {
          orders,
          total: count,
          page: safePage,
          totalPages: Math.ceil(count / safeLimit) || 0,
          spent_thb_sum: Number.isFinite(spentThbSum) ? spentThbSum : 0
        }
      })

    } catch (error) {
      logger.error('获取用户订单失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取订单列表失败',
        error: error.message
      })
    }
  }

  // 获取订单详情（门户：仅能查本人订单；管理端：按 id 查任意订单）
  static async getOrderDetail(req, res) {
    try {
      const { id } = req.params
      const admin = req.admin
      const userId = req.user?.userId

      const detailIncludes = [
        {
          model: OrderItem,
          as: 'items',
          include: [{
            model: Product,
            as: 'product',
            paranoid: false
          }]
        },
        {
          model: User,
          as: 'user',
          attributes: admin
            ? ['id', 'nickname', 'phone', 'referred_by_code']
            : ['id', 'nickname', 'phone']
        }
      ]

      let order = null

      if (admin) {
        order = await Order.findByPk(id, { include: detailIncludes })
        if (!order) {
          return res.status(404).json({
            success: false,
            message: '订单不存在'
          })
        }
        if (order.user?.referred_by_code) {
          const referrer = await User.findOne({
            where: { referral_code: order.user.referred_by_code },
            attributes: ['id', 'nickname', 'phone']
          })
          if (referrer) {
            order.user.dataValues.referrer = referrer
          }
        }
      } else if (userId) {
        order = await Order.findOne({
          where: { id, user_id: userId },
          include: detailIncludes
        })
        if (!order) {
          return res.status(404).json({
            success: false,
            message: '订单不存在'
          })
        }
      } else {
        return res.status(401).json({
          success: false,
          message: '用户未登录'
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
      logger.error('获取订单详情失败', { err: error?.message, stack: error?.stack })
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
      const { status, startDate, endDate, keyword } = req.query
      // 分页参数统一 clamp：该端点页大小参数名为 limit，上限 100
      const { page, limit, offset } = resolvePagination(req.query, { pageSizeKey: 'limit', maxPageSize: 100 })

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
        const like = `%${keyword}%`
        const matchingUsers = await User.findAll({
          attributes: ['id'],
          where: {
            [Op.or]: [
              { nickname: { [Op.like]: like } },
              { phone: { [Op.like]: like } },
              { username: { [Op.like]: like } }
            ]
          }
        })
        const userIds = matchingUsers.map((u) => u.id)
        const orClauses = [
          { order_no: { [Op.like]: like } },
          { contact_name: { [Op.like]: like } },
          { contact_phone: { [Op.like]: like } }
        ]
        if (userIds.length > 0) {
          orClauses.push({ user_id: { [Op.in]: userIds } })
        }
        where[Op.or] = orClauses
      }

      const { count, rows: orders } = await Order.findAndCountAll({
        where,
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'nickname', 'phone', 'referred_by_code']
          }
        ],
        order: [['created_at', 'DESC']],
        limit,
        offset
      })

      // 推荐人批量查询：先收集本页所有出现过的 referred_by_code，一次 IN 查询
      // 之前是 N+1（每条订单一次 User.findOne），50 条/页时多 50 次 SQL
      const referralCodes = [
        ...new Set(
          orders
            .map((o) => o.user?.referred_by_code)
            .filter((c) => typeof c === 'string' && c.length > 0)
        )
      ]
      if (referralCodes.length > 0) {
        const referrers = await User.findAll({
          where: { referral_code: { [Op.in]: referralCodes } },
          attributes: ['id', 'nickname', 'phone', 'referral_code']
        })
        const refMap = new Map(referrers.map((r) => [r.referral_code, r]))
        for (const order of orders) {
          const code = order.user?.referred_by_code
          if (code && refMap.has(code)) {
            order.user.dataValues.referrer = refMap.get(code)
          }
        }
      }

      // 服务端统计：基于当前筛选条件（不含分页），供管理端订单页统计卡片使用
      // todayAmount 取"今日 0 点起"与筛选条件中 created_at 范围的交集
      const toFiniteNumber = (v) => {
        const n = Number(v)
        return Number.isFinite(n) ? n : 0
      }
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayWhere = {
        ...where,
        created_at: {
          ...(where.created_at && typeof where.created_at === 'object' ? where.created_at : {}),
          [Op.gte]: todayStart
        }
      }
      const [completedCount, totalAmountRaw, todayAmountRaw] = await Promise.all([
        Order.count({ where: { ...where, status: 'completed' } }),
        Order.sum('total_amount_thb', { where }),
        Order.sum('total_amount_thb', { where: todayWhere })
      ])
      const stats = {
        total: toFiniteNumber(count),
        completed: toFiniteNumber(completedCount),
        totalAmount: toFiniteNumber(totalAmountRaw),
        todayAmount: toFiniteNumber(todayAmountRaw)
      }

      res.json({
        success: true,
        data: {
          orders,
          total: count,
          page,
          totalPages: Math.ceil(count / limit),
          stats
        }
      })

    } catch (error) {
      logger.error('获取所有订单失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取订单列表失败'
      })
    }
  }

  // 管理员更新订单状态（状态白名单 + 状态机校验 + 取消回补，全部在同一事务内）
  static async updateOrderStatus(req, res) {
    const transaction = await sequelize.transaction()

    try {
      const { id } = req.params
      const { status } = req.body

      if (!ORDER_STATUS_VALUES.includes(status)) {
        await transaction.rollback()
        return res.status(400).json({
          success: false,
          message: `无效的订单状态：${status}（合法值：${ORDER_STATUS_VALUES.join('/')}）`
        })
      }

      // 行锁防并发双转移
      const order = await Order.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE
      })
      if (!order) {
        await transaction.rollback()
        return res.status(404).json({
          success: false,
          message: '订单不存在'
        })
      }

      const fromStatus = order.status
      const allowedTargets = ORDER_STATUS_TRANSITIONS[fromStatus] || []
      if (!allowedTargets.includes(status)) {
        await transaction.rollback()
        return res.status(400).json({
          success: false,
          message: `订单状态不允许从「${fromStatus}」变更为「${status}」`
        })
      }

      // 进入 cancelled 时回补库存与积分（原状态在此不可能是 cancelled，状态机已拦截）
      if (status === 'cancelled') {
        order.items = await OrderItem.findAll({ where: { order_id: order.id }, transaction })
        await restoreOrderResources(order, transaction)
      }

      await order.update({ status }, { transaction })
      await transaction.commit()

      // 返回更新后的订单（含 items）
      const updatedOrder = await Order.findByPk(order.id, {
        include: [
          {
            model: OrderItem,
            as: 'items',
            include: [{
              model: Product,
              as: 'product',
              paranoid: false
            }]
          }
        ]
      })

      res.json({
        success: true,
        message: '订单状态更新成功',
        data: updatedOrder
      })

    } catch (error) {
      await transaction.rollback()
      logger.error('更新订单状态失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '更新订单状态失败'
      })
    }
  }

  // 管理员删除订单
  static async deleteOrder(req, res) {
    const transaction = await sequelize.transaction()
    
    try {
      const { id } = req.params

      const order = await Order.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE
      })

      if (!order) {
        await transaction.rollback()
        return res.status(404).json({
          success: false,
          message: '订单不存在'
        })
      }

      order.items = await OrderItem.findAll({ where: { order_id: id }, transaction })

      // 保存订单信息用于日志记录
      const orderInfo = {
        id: order.id,
        order_no: order.order_no,
        user_id: order.user_id,
        total_amount: order.total_amount,
        status: order.status,
        items_count: order.items ? order.items.length : 0
      }

      /**
       * 仅未履约状态（pending/paid/shipping）删除才回补库存与积分；
       * shipped/delivered/completed 已发货或已履约，直接删除不回补（避免库存/积分虚增）；
       * cancelled 在状态变更为取消时已回补过，不在此重复回补
       */
      if (RESTORE_ON_DELETE_STATUSES.includes(order.status)) {
        await restoreOrderResources(order, transaction)
      }

      // 先清理积分流水：order_id FK 为 ON DELETE SET NULL，直接删单会把流水 order_id 静默置 NULL、断审计链
      await PointTransaction.destroy({
        where: { order_id: id },
        transaction
      })

      // 先删除订单项
      if (order.items && order.items.length > 0) {
        await OrderItem.destroy({
          where: { order_id: id },
          transaction
        })
      }

      // 再删除订单
      await order.destroy({ transaction })

      // 提交事务
      await transaction.commit()

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
      await transaction.rollback()
      logger.error('删除订单失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '删除订单失败: ' + error.message
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
        order: [['created_at', 'DESC']],
        // 安全上限：防止无上限 findAll 拖垮内存
        limit: 50000
      })

      // 简化的CSV导出（用户可控字段过 sanitizeCell，防 Excel 公式注入）
      const csvData = orders.map(order => ({
        订单号: order.order_no,
        用户昵称: sanitizeCell(order.user?.nickname) || '未知',
        用户手机: sanitizeCell(order.user?.phone) || '未知',
        总金额: order.total_amount,
        支付方式: order.payment_method === 'cod' ? '货到付款' : '在线付款',
        订单状态: order.status === 'completed' ? '已完成' : order.status,
        联系人: sanitizeCell(order.contact_name),
        联系电话: sanitizeCell(order.contact_phone),
        收货地址: sanitizeCell(order.delivery_address),
        创建时间: order.created_at
      }))

      res.json({
        success: true,
        data: csvData
      })

    } catch (error) {
      logger.error('导出订单失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '导出订单失败'
      })
    }
  }
}

export default OrderController