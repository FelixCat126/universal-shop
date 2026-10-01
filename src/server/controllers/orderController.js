import { Op } from 'sequelize'
import Order from '../models/Order.js'
import OrderItem from '../models/OrderItem.js'
import OrderPromotion from '../models/OrderPromotion.js'
import UserCoupon from '../models/UserCoupon.js'
import CouponTemplate from '../models/CouponTemplate.js'
import Product from '../models/Product.js'
import User from '../models/User.js'
import Cart from '../models/Cart.js'
import Address from '../models/Address.js'
import sequelize from '../config/database.js'
import UserController from './userController.js'
import { JWT_SECRET } from '../config/jwtSecret.js'
import { createUserAddress } from '../services/addressService.js'
import { thbToBillingAmount, normalizeCheckoutCurrency } from '../utils/exchangeRates.js'
import * as pointsService from '../services/pointsService.js'
import { priceOrder, getPointsEarnRate, calcPointsEarn, loadNormalizedExchangeRates } from '../services/pricingEngine.js'
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
 * 3) 已发放购物积分的单收回等量积分：以 earn_purchase 流水为准（不再以 online_paid_at 为门槛——
 *    COD 单下单事务内即发积分、无 online_paid_at，取消同样要收回）；
 *    一单可能有多条 earn_purchase 流水（补发/重复发放），findAll 汇总收回总量；
 *    余额不足按 0 截断并记 warn
 * 4) 该单核销的抵扣券释放回 unused（条件 UPDATE，幂等：重复回补匹配不到行即为 0 affected）
 */
export async function restoreOrderResources (order, transaction) {
  const items = Array.isArray(order.items) ? order.items : []
  /**
   * 回补库存与 createOrder 扣库存采用同一全局顺序（product_id 升序）获取 Product 行锁：
   * 所有写路径锁顺序一致，消除"扣减 vs 回补"两个事务互相等待的 AB-BA 死锁
   */
  const sortedItems = items
    .filter(item => item && item.product_id)
    .sort((a, b) => a.product_id - b.product_id)
  for (const item of sortedItems) {
    const qty = parseInt(item.quantity, 10)
    if (!Number.isInteger(qty) || qty <= 0) continue
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

  // 已发购物积分即收回：earn_purchase 流水是唯一事实来源（无流水则 earned=0，自然跳过）
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

  // 抵扣券释放（P2）：该单核销占位的券退回未使用状态；
  // 无券订单 where 匹配 0 行，天然无操作；券已过期也无碍——/mine 查询时惰性再置 expired
  await UserCoupon.update(
    { status: 'unused', used_by_order_id: null, used_at: null },
    { where: { used_by_order_id: order.id }, transaction }
  )
}

/**
 * PG 唯一约束冲突判定（口径与 pointsService.lockOrCreateBalance 一致：
 * 兼容 Sequelize 包装错误与原始 PG 错误码 23505）
 */
function isUniqueViolationError (err) {
  return err?.name === 'SequelizeUniqueConstraintError' ||
    err?.parent?.code === '23505' ||
    err?.original?.code === '23505'
}

/**
 * 区分 23505 的冲突来源是否客户端幂等键索引（而非订单号唯一索引）：
 * 约束名 / PG 错误明细 / Sequelize 字段路径三重佐证，任一命中即认定
 */
function isClientOrderKeyConflict (err) {
  return err?.parent?.constraint === 'uniq_orders_user_client_key' ||
    (typeof err?.parent?.detail === 'string' && err.parent.detail.includes('client_order_key')) ||
    (Array.isArray(err?.errors) && err.errors.some(e => e?.path === 'client_order_key'))
}

/**
 * 组装 createOrder 成功响应体（正常创建与幂等查重两条路径共用）：
 * 订单详情（含 items + product）；游客单附带用户信息与 token；
 * deduplicated=true 标记本次为幂等命中、未新建订单
 */
async function buildCreateOrderResponseData (orderId, { userId, isGuestOrder, deduplicated = false }) {
  const createdOrder = await Order.findByPk(orderId, {
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

  const responseData = {
    order: createdOrder
  }
  if (deduplicated) {
    responseData.deduplicated = true
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

  return responseData
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
    // 积分换购单与抵扣券互斥（P2）：前置拦截，不进计价流程
    if (paymentMethod === 'points' && req.body.user_coupon_id != null) {
      return res.status(400).json({
        success: false,
        message: '积分换购订单不可使用抵扣券'
      })
    }
    // 积分换购单不支持组合包（P4）：前置拦截，不进计价流程
    if (paymentMethod === 'points' && Array.isArray(req.body.items) &&
      req.body.items.some(it => it && it.bundle_id != null)) {
      return res.status(400).json({
        success: false,
        message: '积分换购订单不支持组合包'
      })
    }

    /**
     * 事务推迟到所有预检（商品查询、汇率配置、游客用户解析、地址读取）之后、
     * 第一个写操作之前开启：sequelize.transaction() 一创建即占住一条池连接，
     * 若事务存活期间再做 autocommit 读需再抢第二条连接，高并发下会连接池自死锁
     */
    let transaction = null

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
        checkout_currency: checkoutCurrencyRaw,
        client_order_key: clientOrderKey, // 客户端幂等键（可选；joi 已把 ''/null 裁成 undefined）
        user_coupon_id: userCouponId // 抵扣券（P2，可选；joi 已把 ''/null 裁成 undefined）
      } = req.body

      // 轻量入参校验前置：避免为畸形请求白白创建游客账号（此时事务尚未开启，直接返回即可）
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

      /**
       * 幂等预检：客户端带 client_order_key 时，同用户同 key 直接返回已存在订单，
       * 不重复扣库存、不重复发积分（覆盖"已提交但响应丢失后的重试/双击"顺序场景）；
       * 并发同 key 由 (user_id, client_order_key) 部分唯一索引兜底（见下方 Order.create 冲突分支）。
       * 游客单同样适用：此时 userId 已是自动注册/复用账号的 id
       */
      if (clientOrderKey) {
        const existingOrder = await Order.findOne({
          where: { user_id: userId, client_order_key: clientOrderKey }
        })
        if (existingOrder) {
          const responseData = await buildCreateOrderResponseData(existingOrder.id, { userId, isGuestOrder, deduplicated: true })
          AuditLog.logUser({
            user: req.user || (isGuestOrder ? { id: userId } : null),
            event: 'order.create.deduplicated',
            resource: 'order',
            resourceId: existingOrder.id,
            detail: { client_order_key: clientOrderKey },
            req
          }).catch(() => {})
          return res.status(201).json({
            success: true,
            message: '订单创建成功',
            data: responseData
          })
        }
      }

      let totalAmountThb = 0
      let pointsPurchaseTotal = 0
      const orderItems = []

      /**
       * 抵扣券（P2）：查券并校验归属（此时 userId 已解析——游客单为自动注册的新用户，
       * 注册赠券已发到该账号，天然兼容）；状态/有效期/scope 门槛由计价引擎统一判定，
       * 核销占位在事务内用条件 UPDATE 完成（见下方 OrderPromotion 快照段）
       */
      let userCoupon = null
      if (userCouponId != null && paymentMethod !== 'points') {
        userCoupon = await UserCoupon.findOne({
          where: { id: userCouponId, user_id: userId },
          include: [{ model: CouponTemplate, as: 'template' }]
        })
        if (!userCoupon) {
          return res.status(400).json({
            success: false,
            message: '抵扣券不存在或不属于当前用户'
          })
        }
      }

      /**
       * 计价引擎（P1 营销体系）：行价/满减/行分摊/积分预估统一收口。
       * 积分换购单（points）不参与任何促销，priced 为 null，下方仍走原有行价逻辑
       */
      const priced = paymentMethod === 'points'
        ? null
        : await priceOrder({ items, paymentMethod, userCoupon })

      /**
       * 订单行口径（P4）：普通支付单以引擎展开行为准（组合包项已原地展开为组件行，
       * 行带 bundle_id 标记）；积分换购单不含组合包（顶部已前置拦截），维持入参 items 口径
       */
      const orderRows = priced
        ? priced.lines.map(line => ({ product_id: line.product_id, quantity: line.quantity, engineLine: line }))
        : items.map(item => ({ product_id: item.product_id, quantity: item.quantity, engineLine: null }))

      // 批量查询商品信息（避免N+1查询；组合包单覆盖展开后的组件商品）
      const productIds = orderRows.map(row => row.product_id)
      const products = await Product.findAll({
        where: { id: productIds }
      })

      // 创建商品ID到商品对象的映射
      const productMap = new Map()
      products.forEach(product => {
        productMap.set(product.id, product)
      })

      // 验证商品状态/库存和计算总价（仅做"友好"预检；真正扣减用条件 UPDATE 防超卖。此时事务未开启，校验失败直接返回即可）
      for (const row of orderRows) {
        const product = productMap.get(row.product_id)
        if (!product) {
          return res.status(400).json({
            success: false,
            message: `商品ID ${row.product_id} 不存在`
          })
        }

        // 下架/停用商品拦截：仅 active 可售（此前不过滤 status，下架商品仍可被下单）
        if (product.status !== 'active') {
          return res.status(400).json({
            success: false,
            message: `商品 ${product.name} 已下架，无法购买`
          })
        }

        const qty = parseInt(row.quantity, 10)
        if (!Number.isInteger(qty) || qty < 1 || qty > 5000) {
          return res.status(400).json({
            success: false,
            message: `商品 ${product.name} 数量无效（需为 1-5000 的整数）`
          })
        }

        if (product.stock < qty) {
          return res.status(400).json({
            success: false,
            message: `商品 ${product.name} 库存不足，当前库存：${product.stock}`
          })
        }

        // 计算实际价格（考虑折扣）：普通支付单取自计价引擎行（P4 组合包展开行 = 分摊价）；
        // 积分换购单维持原行价逻辑（不参与满减）
        const engineLine = row.engineLine
        let actualPrice
        if (engineLine) {
          actualPrice = engineLine.unit_price
        } else {
          actualPrice = round2(product.price)
          if (product.discount && product.discount > 0) {
            actualPrice = round2(product.price * (1 - product.discount / 100))
          }
        }

        const itemTotal = engineLine ? engineLine.line_total : round2(actualPrice * qty)
        totalAmountThb = round2(totalAmountThb + itemTotal)

        const ptsUnit = Number(product.points) || 0
        const pointsLineCost = ptsUnit > 0 ? ptsUnit * qty : 0
        if (paymentMethod === 'points') {
          if (ptsUnit <= 0 || pointsLineCost <= 0) {
            return res.status(400).json({
              success: false,
              message: '积分换购订单中只能包含支持积分兑换的商品'
            })
          }
        }

        pointsPurchaseTotal += pointsLineCost

        orderItems.push({
          product_id: row.product_id,
          quantity: qty,
          price: actualPrice,
          original_price: product.price,
          discount: engineLine ? engineLine.discount : product.discount,
          product_name_zh: product.name,
          product_name_th: product.name_th || null,
          points_line_cost: pointsLineCost,
          discount_allocated: engineLine ? engineLine.discount_allocated : 0,
          bundle_id: engineLine?.bundle_id ?? null
        })
      }

      /**
       * 买多赠一（P3）：引擎 gifts 落成赠品行，追加在正价行之后——
       * price/original_price=0、is_gift=true、discount_allocated=0，不计金额、不参与分摊；
       * 库存扣减在下方与正价行按 product_id 合并执行（买 3 赠 1 同品即扣 4）
       */
      if (priced && Array.isArray(priced.gifts)) {
        for (const gift of priced.gifts) {
          orderItems.push({
            product_id: gift.product_id,
            quantity: gift.quantity,
            price: 0,
            original_price: 0,
            discount: null,
            product_name_zh: gift.name,
            product_name_th: null,
            points_line_cost: 0,
            discount_allocated: 0,
            is_gift: true
          })
        }
      }

      const checkoutCurrency = normalizeCheckoutCurrency(checkoutCurrencyRaw)

      // 汇算比例：与门户计价一致（泰铢底价 × 比例 = 外币金额）
      const normRates = await loadNormalizedExchangeRates()

      if (paymentMethod !== 'points' && checkoutCurrency !== 'THB') {
        const need = parseFloat(normRates[checkoutCurrency])
        if (!Number.isFinite(need) || need <= 0) {
          return res.status(400).json({
            success: false,
            message: `无法在所选币种 ${checkoutCurrency} 结账：系统未配置有效汇算比例或未启用该币种`
          })
        }
      }

      // 普通支付单以引擎口径为准：应付 = 商品小计 - 满减合计（total_amount_thb 语义 = 折后应付 THB，统计口径不变）
      totalAmountThb = priced ? priced.payable_thb : round2(totalAmountThb)

      // 积分获取比例（points_earn_rate）：事务外读取，下方 COD 发积分用
      const pointsEarnRate = await getPointsEarnRate()

      let totalBilling
      if (paymentMethod === 'points') {
        totalAmountThb = 0
        totalBilling = 0
        if (!(pointsPurchaseTotal > 0)) {
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

      // 所有预检完成：以下进入写阶段，开启事务（事务内第一个写操作是 Order.create）
      transaction = await sequelize.transaction()

      /**
       * 订单号生成 + 唯一冲突重试（最多 5 次，SAVEPOINT 模式）：
       * PG 下事务内语句报错后整事务进入 aborted 状态，不设保存点直接重插只会再撞 25P02，
       * 因此仿 pointsService.lockOrCreateBalance：Order.create 包在保存点内，
       * 撞 order_no 唯一约束（23505）时回滚到保存点、重生成订单号再插。
       * 幂等键 (user_id, client_order_key) 冲突同样报 23505，必须区分错误来源：
       * 命中幂等键索引 → 不再重试，整事务回滚后按 key 查重返回（见下方分支）
       */
      const buildOrderNo = () => `ORD${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`
      let order = null
      let createTries = 0
      let clientKeyConflicted = false
      while (createTries < 5 && !order) {
        const sp = await sequelize.transaction({ transaction })
        try {
          order = await Order.create({
            order_no: buildOrderNo(),
            user_id: userId,
            client_order_key: clientOrderKey || null,
            total_amount: totalBilling,
            total_amount_thb: totalAmountThb,
            discount_amount: priced ? priced.discount_amount : 0,
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
          }, { transaction: sp })
          await sp.commit()
        } catch (err) {
          await sp.rollback().catch(() => {})
          if (isUniqueViolationError(err)) {
            if (clientOrderKey && isClientOrderKeyConflict(err)) {
              clientKeyConflicted = true
              break
            }
            createTries++
            continue
          }
          throw err
        }
      }
      if (!order) {
        await transaction.rollback()
        transaction = null
        if (clientKeyConflicted) {
          /**
           * 幂等键冲突：并发下同 key 的负方会被唯一索引阻塞到胜方提交后才报 23505，
           * 此刻按 (user_id, key) 必能查到胜方已提交的订单，按幂等成功原样返回
           */
          const existingOrder = await Order.findOne({
            where: { user_id: userId, client_order_key: clientOrderKey }
          })
          if (existingOrder) {
            const responseData = await buildCreateOrderResponseData(existingOrder.id, { userId, isGuestOrder, deduplicated: true })
            AuditLog.logUser({
              user: req.user || (isGuestOrder ? { id: userId } : null),
              event: 'order.create.deduplicated',
              resource: 'order',
              resourceId: existingOrder.id,
              detail: { client_order_key: clientOrderKey },
              req
            }).catch(() => {})
            return res.status(201).json({
              success: true,
              message: '订单创建成功',
              data: responseData
            })
          }
        }
        return res.status(500).json({
          success: false,
          message: '生成订单号失败，请稍后重试'
        })
      }

      /**
       * 防超卖核心：用条件 UPDATE 原子扣库存。
       *   UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty
       * 受影响行 0 即视为库存不足；事务回滚整单。
       * 扣减清单先按 product_id 合并（买赠赠品行与正价行同品时合扣，如买 3 赠 1 扣 4），
       * 再按 product_id 升序遍历：所有写路径（下单扣减/取消回补/超时清扫回补）
       * 按同一全局顺序获取 Product 行锁，消除 AB-BA 死锁；
       * OrderItem 落库仍用客户端原始顺序 + 赠品行追加在后（见下方 bulkCreate），不影响订单项展示顺序契约
       */
      const stockDeductionMap = new Map()
      for (const orderItem of orderItems) {
        const entry = stockDeductionMap.get(orderItem.product_id) ||
          { product_id: orderItem.product_id, quantity: 0, name: orderItem.product_name_zh }
        entry.quantity += parseInt(orderItem.quantity, 10)
        stockDeductionMap.set(orderItem.product_id, entry)
      }
      const stockDeductionOrder = [...stockDeductionMap.values()].sort((a, b) => a.product_id - b.product_id)
      for (const entry of stockDeductionOrder) {
        const [affected] = await Product.update(
          { stock: sequelize.literal(`stock - ${entry.quantity}`) },
          {
            where: {
              id: entry.product_id,
              stock: { [Op.gte]: entry.quantity }
            },
            transaction
          }
        )
        if (!affected) {
          await transaction.rollback()
          transaction = null
          return res.status(400).json({
            success: false,
            message: `商品 ${entry.name} 库存不足（商品 ID ${entry.product_id}）`
          })
        }
      }

      // 订单项一次性写入（保持客户端提交顺序；避免循环 N 次插入）
      const orderItemRows = orderItems.map(orderItem => ({ order_id: order.id, ...orderItem }))
      if (orderItemRows.length > 0) {
        await OrderItem.bulkCreate(orderItemRows, { transaction })
      }

      /**
       * 抵扣券核销占位（同事务）：条件 UPDATE 是并发的唯一闸门——
       * 预检/计价在事务外完成，同券双下单时负方在此受影响行=0，
       * 整单回滚报 400；胜方提交前负方会被行锁阻塞到胜方提交后重估 WHERE，不会双双核销
       */
      if (userCoupon && priced && priced.applied_coupon) {
        const [affected] = await UserCoupon.update(
          { status: 'used', used_by_order_id: order.id, used_at: new Date() },
          { where: { id: userCoupon.id, user_id: userId, status: 'unused' }, transaction }
        )
        if (!affected) {
          await transaction.rollback()
          transaction = null
          return res.status(400).json({
            success: false,
            message: '抵扣券不可用或已被使用'
          })
        }
      }

      // 订单促销快照（同事务）：每个命中的满减一条；券抵扣一行（user_coupon_id + 名称/面额快照），供订单详情/对账追溯
      const promotionRows = []
      if (priced && priced.applied_promotions.length > 0) {
        for (const p of priced.applied_promotions) {
          promotionRows.push({
            order_id: order.id,
            promotion_id: p.promotion_id,
            name: p.name,
            amount: p.amount
          })
        }
      }
      if (priced && priced.applied_coupon) {
        promotionRows.push({
          order_id: order.id,
          promotion_id: null,
          user_coupon_id: priced.applied_coupon.user_coupon_id,
          name: priced.applied_coupon.name,
          amount: priced.applied_coupon.amount
        })
      }
      if (promotionRows.length > 0) {
        await OrderPromotion.bulkCreate(promotionRows, { transaction })
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
      // 发放口径：floor(折后实付 THB × points_earn_rate)，为 0 不发
      if (paymentMethod !== 'points' && paymentMethod !== 'online' && userId) {
        const earnPoints = calcPointsEarn(totalAmountThb, pointsEarnRate)
        if (earnPoints > 0) {
          await pointsService.grantPurchasePoints(userId, order.id, earnPoints, { transaction })
        }
      }

      await transaction.commit()
      // 提交成功后事务已结束：置空避免 catch 对已提交事务再执行 rollback 而二次抛错
      transaction = null

      // 返回创建的订单信息（含订单项；游客单附带账号与 token）
      const responseData = await buildCreateOrderResponseData(order.id, { userId, isGuestOrder })

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
      // 事务可能未开启（预检阶段抛错）或已回滚/已提交：兜底回滚需容错，避免 catch 内二次抛错
      if (transaction) {
        await transaction.rollback().catch(() => {})
      }
      logger.error('创建订单失败', { err: error?.message, stack: error?.stack })
      // 计价引擎等业务校验抛出的 400 错误（商品不存在/已下架/数量无效）原样透传
      if (error && error.status === 400) {
        return res.status(400).json({
          success: false,
          message: error.message
        })
      }
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
   * 订单试算（quote）：与 createOrder 共用同一套计价引擎与汇率读取，只算价不落库、不扣库存。
   * 响应含行级明细 / 满减合计 / 券抵扣 / 应付泰铢 / 结算币种金额 / 积分预估 / 赠品清单（P3），供结算页展示。
   * P2：body 可带 user_coupon_id——必须已登录且券属于当前用户；券不可用返回 400（券在此只试算，不核销）。
   */
  static async quoteOrder (req, res) {
    try {
      const {
        items,
        payment_method: paymentMethod = 'cod',
        checkout_currency: checkoutCurrencyRaw,
        user_coupon_id: userCouponId
      } = req.body

      // 抵扣券（P2）：查券并校验归属；状态/有效期/scope 门槛/积分互斥由计价引擎统一判定
      let userCoupon = null
      if (userCouponId != null) {
        const userId = req.user?.userId
        if (!userId) {
          return res.status(400).json({ success: false, message: '使用抵扣券需要先登录' })
        }
        userCoupon = await UserCoupon.findOne({
          where: { id: userCouponId, user_id: userId },
          include: [{ model: CouponTemplate, as: 'template' }]
        })
        if (!userCoupon) {
          return res.status(400).json({ success: false, message: '抵扣券不存在或不属于当前用户' })
        }
      }

      const priced = await priceOrder({ items, paymentMethod, userCoupon })

      const checkoutCurrency = normalizeCheckoutCurrency(checkoutCurrencyRaw)
      const normRates = await loadNormalizedExchangeRates()

      if (paymentMethod !== 'points' && checkoutCurrency !== 'THB') {
        const need = parseFloat(normRates[checkoutCurrency])
        if (!Number.isFinite(need) || need <= 0) {
          return res.status(400).json({
            success: false,
            message: `无法在所选币种 ${checkoutCurrency} 结账：系统未配置有效汇算比例或未启用该币种`
          })
        }
      }

      const rate = checkoutCurrency === 'THB' ? 1 : (parseFloat(normRates[checkoutCurrency]) || 0)
      const billing = {
        currency: checkoutCurrency,
        // 积分换购单无货币应付（与 createOrder 口径一致：total 计 0）
        amount: paymentMethod === 'points' ? 0 : thbToBillingAmount(priced.payable_thb, checkoutCurrency, normRates),
        rate
      }

      return res.json({
        success: true,
        data: {
          lines: priced.lines,
          items_total: priced.items_total,
          discount_amount: priced.discount_amount,
          payable_thb: priced.payable_thb,
          billing,
          points_estimate: priced.points_estimate,
          applied_promotions: priced.applied_promotions,
          applied_coupon: priced.applied_coupon,
          // 买多赠一（P3）：赠品清单透传，供结算页预展示；赠品不影响金额
          gifts: priced.gifts
        }
      })
    } catch (error) {
      // 计价引擎业务校验错误（商品不存在/已下架/数量无效）→ 400
      if (error && error.status === 400) {
        return res.status(400).json({ success: false, message: error.message })
      }
      logger.error('订单试算失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '订单试算失败' })
    }
  }

  /**
   * 在线支付订单：用户在支付弹窗内确认后转为送货中（并发放购物积分）
   * 幂等保障：用条件 UPDATE，仅当 status='pending' 且 online_paid_at IS NULL 时才置位；
   *   - 受影响行数 = 1：本次确认成功，发积分；
   *   - 受影响行数 = 0：并发竞态负方，重读订单甄别——online_paid_at 已置位则幂等成功（不再发积分）；
   *     订单不存在返回 404；订单已被取消/状态被改走返回 409（不再谎报"支付已确认"）。
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
        where: { id, user_id: userId }
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
      // 积分获取比例（points_earn_rate）：事务外读取，按订单折后实付 THB 换算应发积分
      const pointsEarnRate = await getPointsEarnRate()
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
          // 发放口径：floor(折后实付 THB × points_earn_rate)，为 0 不发
          const earnPoints = calcPointsEarn(Number(order.total_amount_thb) || 0, pointsEarnRate)
          if (earnPoints > 0) {
            await pointsService.grantPurchasePoints(userId, order.id, earnPoints, { transaction })
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
      }

      /**
       * affected = 0（条件 UPDATE 未命中）：预读到 UPDATE 之间存在竞态窗口，
       * 重读订单甄别真实状态，不能一律谎报"支付已确认"：
       *   - 订单不存在（已被并发删除）→ 404
       *   - online_paid_at 已置位（并发确认已生效）→ 幂等成功
       *   - 其余（订单已被取消/状态被管理端改走）→ 409
       */
      const freshOrder = await Order.findByPk(order.id, {
        include: [
          {
            model: OrderItem,
            as: 'items',
            include: [{ model: Product, as: 'product', paranoid: false }]
          }
        ]
      })
      if (!freshOrder) {
        return res.status(404).json({ success: false, message: '订单不存在' })
      }
      if (!freshOrder.online_paid_at) {
        return res.status(409).json({ success: false, message: '订单当前状态不允许支付确认' })
      }
      AuditLog.logUser({
        user: { id: userId },
        event: 'order.payment.confirm.idempotent_hit',
        resource: 'order',
        resourceId: order.id,
        req
      }).catch(() => {})
      return res.json({
        success: true,
        message: '支付已确认',
        data: freshOrder
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

      // 清理订单促销快照：order_promotions 无 DB 级联，随单硬删在此显式处理
      await OrderPromotion.destroy({
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