import { Op } from 'sequelize'
import Order from '../models/Order.js'
import OrderItem from '../models/OrderItem.js'
import OrderPromotion from '../models/OrderPromotion.js'
import AfterSale from '../models/AfterSale.js'
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
import { grantRegisterGiftCoupons } from '../services/couponService.js'
import { thbToBillingAmount, normalizeCheckoutCurrency } from '../utils/exchangeRates.js'
import * as pointsService from '../services/pointsService.js'
import { notifyUser, notifyUsers } from '../services/notificationService.js'
import { isSmsChannelConfigured, sendSms, SMS_EVENTS, getBusinessSmsPolicy } from '../services/smsService.js'
import { priceOrder, getPointsEarnRate, calcPointsEarn, loadNormalizedExchangeRates, PRICING_ENGINE_VERSION } from '../services/pricingEngine.js'
import { applyCreatedBetween } from '../utils/dateFilters.js'
import { getBusinessTimezone, startOfBusinessDay } from '../utils/businessTimezone.js'
import { likeContains } from '../utils/likeSearch.js'
import AuditLog from '../models/AuditLog.js'
import PointTransaction from '../models/PointTransaction.js'
import UserPointBalance from '../models/UserPointBalance.js'
import { resolvePagination } from '../utils/pagination.js'
import { sanitizeCell } from '../utils/sanitizeCell.js'
import { withDeadlockRetry } from '../utils/dbRetry.js'
import { statusText } from '../utils/orderStatusText.js'
import { logger } from '../utils/logger.js'
import { clearResponseCache } from '../utils/responseCache.js'
import { revenueStatusSql, revenueWhere } from '../constants/revenueStatus.js'
import * as statsCache from '../utils/statsCache.js'
import { parseId } from '../utils/params.js'
import { respondDbError } from '../utils/dbInputError.js'

/** 金额统一舍入到分：消除浮点误差，保证 Σ(行价×数量) 与订单总额严格一致 */
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/**
 * 订单列表「统计卡片」的短缓存 —— 见 utils/statsCache.js。
 * 写时失效挂在模型层（订单任何写入立刻清），不用在控制器里手写。
 */
const { getCachedOrderStats, setCachedOrderStats } = statsCache

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
 * keyword 搜索匹配到的用户数上限。
 * 无上限时 User.findAll 会拉回全表 id 并塞进 IN(...)，
 * 命中量大时 PG 报 54000 too many arguments → 500。
 */
const KEYWORD_USER_MATCH_LIMIT = 1000

/**
 * 组合包展开行的数量上限（与计价引擎 pricingEngine 的 MAX_BUNDLE_LINE_QTY 一致）。
 *
 * 展开行数量 = 组件配比 × 组合包数量，比单品行的 5000 大得多。
 */
const MAX_BUNDLE_LINE_QTY = 5000 * 999

/**
 * 防"白拿积分"漏洞的护栏。
 *
 * 本订单发出去的购物积分（earn_purchase 流水）如果**已经被用户花掉**
 * （当前余额 < 已发积分），那么取消/删除订单时那笔积分收不回来 ——
 * revokePurchasePoints 只能按 0 截断，等于用户白拿了一笔积分。
 *
 * 所以余额不足时**直接拒绝**这次取消/删除，提示先归还积分兑换订单。
 *
 * ⚠️ 取消、批量取消、删除三条路径都要过这道闸 ——
 * 之前只有取消有，删除那条漏了：管理员删掉一笔"积分已被花掉"的订单，
 * 用户就白嫖了（而且订单流水还被一起删掉，账更对不上）。
 *
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
async function assertEarnedPointsNotSpent (order, transaction, options = {}) {
  /**
   * options.earnTxs 预取好的 earn_purchase 流水（数组）。
   *   批量路径一次查完整批的流水再传进来 —— 否则每单都查一遍，
   *   10 单就多 10 条查询（被「批量取消查询数不随订单数线性膨胀」的护栏抓到）。
   */
  const earnTxs = options.earnTxs || await PointTransaction.findAll({
    where: { order_id: order.id, type: 'earn_purchase' },
    transaction
  })
  const totalEarned = earnTxs.reduce((sum, tx) => sum + Math.abs(Number(tx.delta) || 0), 0)
  if (totalEarned <= 0) return { ok: true }

  /**
   * 这里**不加行锁**（普通读即可）。
   *
   * 理由是**全局加锁顺序**：
   *   下单路径：锁 Product（扣库存）→ 锁 UserPointBalance（发积分）
   *   取消路径：锁 Product（回补库存）→ 锁 UserPointBalance（收积分）
   * 两边顺序一致才不会死锁。
   *
   * 之前这里对余额加了 FOR UPDATE → 取消路径变成"先锁余额、后锁产品"，
   * 与下单路径**相反** → 下单持产品锁 + 取消持余额锁 同时发生时 40P01 死锁。
   *
   * 不加锁是否安全？余额的并发安全由 revokePurchasePoints 内部保证：
   * 它自己 lockOrCreateBalance（FOR UPDATE）并按 min(余额, 数量) 截断 ——
   * 不会超扣。这里只是**提前判断**，判错了最坏结果是"该拦的没拦住"，
   * 而截断逻辑保证账仍然对得上。
   */
  const balanceRow = await UserPointBalance.findOne({
    where: { user_id: order.user_id },
    transaction
  })
  const currentBalance = Number(balanceRow?.balance) || 0
  if (currentBalance < totalEarned) {
    return {
      ok: false,
      message: `该订单获得的 ${totalEarned} 积分已被使用（当前余额 ${currentBalance}），请先归还部分积分兑换订单后再取消`
    }
  }
  return { ok: true }
}

/**
 * 订单取消/删除时的资源回补（必须在事务内调用，order.items 需已加载）：
 * 1) 逐订单项回补库存（paranoid:false，商品被软删也要回补，否则库存静默丢失）；
 * 2) 积分换购单退回已扣积分；
 * 3) 已发放购物积分的单收回等量积分：以 earn_purchase 流水为准（不再以 online_paid_at 为门槛——
 *    COD 单下单事务内即发积分、无 online_paid_at，取消同样要收回）；
 *    一单可能有多条 earn_purchase 流水（补发/重复发放），findAll 汇总收回总量；
 *    余额不足按 0 截断并记 warn
 * 4) 该单核销的抵扣券释放回 unused（条件 UPDATE，幂等：重复回补匹配不到行即为 0 affected）
 *
 * @param {object} [options]
 * @param {boolean} [options.restoreStock=true] 是否回补**库存**。
 *        「仅退款」（refund）必须传 false —— 客户没退货，货还在他手上，
 *        回补库存等于同一件实物被再卖一次（库存凭空多出来）。
 *        积分与券照常收（订单确实没成交，钱要退、券要还）。
 */
export async function restoreOrderResources (order, transaction, options = {}) {
  /**
   * options.earnTxs   预取的该单购物积分流水（数组）。
   *                    批量路径下一次查完所有单的流水再传进来 ——
   *                    原来这里会**再查一遍**（守卫已经查过一次）。
   *
   * 第 44 轮：原先还有一个 options.balanceRow（"同一事务里已加行锁的余额行实例"），
   * 它是批量路径提前给余额行加 FOR UPDATE 时留下的。
   * 批量路径改用与单条路径同一个**非加锁**守卫后（为了统一全局加锁顺序），
   * 就没有人再传这个参数了 —— 一并删掉，免得留下"看起来还能用"的死选项。
   */
  /**
   * 幂等护栏：订单已是 cancelled 说明资源此前已回补过，重复回补会让库存虚增、
   * 用户积分被多扣（售后审批叠加订单取消时会发生）。
   * 这里统一拦截，所有调用方（取消/删除/售后/超时清扫）自动受保护。
   */
  if (order.status === 'cancelled') {
    logger.warn('订单已处于 cancelled，跳过资源回补（幂等护栏）', { orderId: order.id })
    return { restored: false, reason: 'already_cancelled' }
  }

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
    if (options.restoreStock === false) {
      // 仅退款：货没回来，不能回补库存（否则同一件实物会被再卖一次）
      logger.info('仅退款不回补库存（货未退回）', { orderId: order.id, productId: item.product_id, qty })
      continue
    }
    await Product.update(
      { stock: sequelize.literal(`stock + ${qty}`) },
      // paranoid:false —— Product 是软删模型，默认过滤会让已软删商品的库存静默丢失
      { where: { id: item.product_id }, transaction, paranoid: false }
    )
  }

  /**
   * 抵扣券释放（第 44 轮：**提前到积分之前**）。
   *
   * 全局加锁顺序（第 44 轮统一）：
   *   Product（product_id 升序） → UserCoupon → UserPointBalance
   *
   * 下单路径（createOrder）就是这个顺序：扣库存 → 核销券 → 扣积分。
   * 取消/回补路径原来是"库存 → 积分 → 券"，**券与积分的顺序正好相反**
   * → 同一张券既在下单核销、又在取消释放时，两个事务就可能互等（AB-BA）。
   *
   * 这里把券释放提到积分操作之前，两条路径的顺序就完全一致了。
   * 语义无变化：券释放与积分收回都是幂等 UPDATE，谁先谁后都不影响结果。
   */
  // 抵扣券释放：该单核销占位的券退回未使用状态；
  // 无券订单 where 匹配 0 行，天然无操作；券已过期也无碍——/mine 查询时惰性再置 expired
  await UserCoupon.update(
    { status: 'unused', used_by_order_id: null, used_at: null },
    { where: { used_by_order_id: order.id }, transaction }
  )

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
  const earnTxs = options.earnTxs || await PointTransaction.findAll({
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

  // 抵扣券释放已提前到库存回补之后、积分操作之前（见上方注释：统一全局加锁顺序）
}

/**
 * 取消订单的公共动作（第 45 轮抽出）。
 *
 * 管理端「改状态为已取消」与用户「自助取消」**要做的是同一件事**：
 *   1. 状态机校验（当前状态能不能转 cancelled）
 *   2. 防"刷积分"守卫（本单获得的购物积分是否已经被花掉）
 *   3. 加载订单明细
 *   4. 回补库存 / 积分 / 抵扣券
 *
 * ## 为什么要抽出来
 *
 * 之前这段只在管理端那条路径里（updateOrderStatus 内联），
 * 用户侧**没有取消入口** → 于是：
 *   - **积分退回**（refund_cancel / revoke_cancel）只有管理员能触发
 *   - **抵扣券退还**（used_by_order_id 置空）同理
 *   - 客户想取消自己的订单都做不到，只能等运营
 *
 * 抽成一份，两条路径共用 → 不会出现"管理端能退积分、用户端不能"的分裂。
 *
 * @param {object} order 已加行锁的订单实例
 * @param {import('sequelize').Transaction} transaction
 * @returns {Promise<{ok: true} | {ok: false, status: number, message: string}>}
 */
async function performOrderCancel (order, transaction) {
  const fromStatus = order.status
  const allowedTargets = ORDER_STATUS_TRANSITIONS[fromStatus] || []
  if (!allowedTargets.includes('cancelled')) {
    return {
      ok: false,
      status: 400,
      message: `订单状态不允许从「${statusText(fromStatus)}」变更为「已取消」`
    }
  }

  /**
   * 防"刷积分"漏洞：本订单 earn_purchase 是否已超用户当前余额？
   * 余额 >= earn 时 revoke 全额成功，截断为 0；
   * 余额 <  earn 时 revoke 截断，相当于部分积分被"免费花掉"。
   * 直接拦截：余额不足时不允许取消，提示用户先归还部分积分兑换订单。
   */
  const guard = await assertEarnedPointsNotSpent(order, transaction)
  if (!guard.ok) {
    return { ok: false, status: 400, message: guard.message }
  }

  order.items = await OrderItem.findAll({ where: { order_id: order.id }, transaction })
  await restoreOrderResources(order, transaction)
  return { ok: true }
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
 * 构造订单的「优惠快照」（落 orders.discount_snapshot）。
 *
 * 目的是让订单**自解释**：事后拿到一个订单，能直接看出
 *   - 命中了哪些满减促销、各减了多少
 *   - 用了哪张抵扣券、抵了多少
 *   - 每行的原价与折后价
 * 不用再靠"行的 price 到底存的是原价还是折后价"这种会随版本漂移的隐含约定去猜
 * （生产里就有一单因为这个说不清金额差 30%）。
 *
 * 只保留解释金额所必需的字段，不塞 PII。
 */
function buildDiscountSnapshot (priced, orderItems = []) {
  const promotions = (priced?.applied_promotions || []).map(p => ({
    promotion_id: p.promotion_id ?? null,
    name: p.name,
    amount: Number(p.amount || 0)
  }))
  const coupon = priced?.applied_coupon
    ? {
        user_coupon_id: priced.applied_coupon.user_coupon_id ?? null,
        name: priced.applied_coupon.name,
        amount: Number(priced.applied_coupon.amount || 0)
      }
    : null
  const lines = (orderItems || []).map(item => ({
    product_id: item.product_id,
    quantity: Number(item.quantity || 0),
    price: Number(item.price || 0),
    original_price: item.original_price != null ? Number(item.original_price) : null,
    discount: item.discount != null ? Number(item.discount) : null,
    is_gift: Boolean(item.is_gift)
  }))
  return {
    discount_amount: Number(priced?.discount_amount || 0),
    payable_thb: priced?.payable_thb != null ? Number(priced.payable_thb) : null,
    promotions,
    coupon,
    lines
  }
}

/**
 * 组装 createOrder 成功响应体（正常创建与幂等查重两条路径共用）：
 * 订单详情（含 items + product）；游客单附带用户信息与 token；
 * deduplicated=true 标记本次为幂等命中、未新建订单
 */
async function buildCreateOrderResponseData (orderId, { userId, isGuestOrder, guestUserCreated = false, deduplicated = false }) {
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
    const user = await User.findByPk(userId)

    /**
     * ⚠️ 只有**新建**账号才签发 token。
     *
     * 复用既有账号（同一手机号再次下单 / 首单失败后重试）时**绝对不能发** ——
     * 复用的判定条件只有"这个手机号已有一个系统随机密码、用户自己设过密码的账号"，
     * 也就是说：**任何知道这个手机号的人都能触发复用**。
     * 发 token 等于把该账号的会话交给一个只知道自己手机号（甚至后 8 位）的陌生人 ——
     * 订单/地址/积分全可见，还能代其下单、确认支付、改邮箱。
     *
     * 复用时只回手机号（请求方自己填的，不构成新泄漏）+ 提示去登录。
     */
    if (guestUserCreated) {
      const jwt = (await import('jsonwebtoken')).default
      const token = jwt.sign(
        { userId: user.id, username: user.username, type: 'user', tv: Number(user.token_version) || 0 },
        JWT_SECRET,
        { expiresIn: '7d', algorithm: 'HS256' }
      )

      responseData.user = user.toSafeJSON()
      responseData.token = token
      responseData.autoRegistered = true
    } else {
      /**
       * 复用既有账号：**不发 token**。
       * 只回手机号（请求方自己填的，不构成新泄漏），由用户自己登录查看订单。
       */
      responseData.user = {
        id: user.id,
        phone: user.phone,
        country_code: user.country_code
      }
      responseData.accountReused = true
    }
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
     * 若事务存活期间再做 autocommit 读需再抢第二条连接，高并发下会连接池自死锁。
     * 写阶段整体包 withDeadlockRetry：事务在 fn 内创建，PG 40P01/40001 时重建事务整体重跑；
     * 游客用户创建在事务外，不受重试影响
     */
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
        user_coupon_id: userCouponId, // 抵扣券（P2，可选；joi 已把 ''/null 裁成 undefined）
        // 条款与年龄确认（第 54 轮）：自我声明，joi 已强制为 true
        terms_accepted: termsAccepted,
        age_confirmed: ageConfirmed
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
      // 本次游客下单是否**新建**了账号（复用既有游客账号时为 false，不发注册赠券）
      let guestUserCreated = false

      // 标准化处理推荐码（在所有分支之前定义）
      const normalizedReferralCode = referral_code && typeof referral_code === 'string' && referral_code.trim() ? referral_code.trim() : null

      /**
       * 条款与年龄确认（第 54 轮）：**必须在建号之前**校验。
       *
       * 为什么位置这么关键：游客下单会**自动创建账号**（下面的 createUserForOrder），
       * 而建号发生在业务校验（商品/库存/计价）**之前** ——
       * 如果确认校验放在建号之后，就会留下"账号建好了、订单却没成"的垃圾账号。
       *
       * 登录用户也在这里校验（同一个入口，一处覆盖两种人）。
       *
       * 系统**无法核实身份与年龄**（无证件验证/无实名），
       * 所以这是**自我声明**：用户确认已阅读条款、已满最低购买年龄。
       */
      const terms_accepted = termsAccepted === true
      const age_confirmed = ageConfirmed === true
      if (!terms_accepted || !age_confirmed) {
        return res.status(400).json({
          success: false,
          message: '请先确认已阅读服务条款与退换货政策，并确认已满最低购买年龄',
          code: 'CONSENT_REQUIRED',
          details: [
            ...(terms_accepted ? [] : [{ field: 'terms_accepted', message: '请确认已阅读服务条款与退换货政策' }]),
            ...(age_confirmed ? [] : [{ field: 'age_confirmed', message: '请确认已满最低购买年龄' }])
          ]
        })
      }

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
          const newUser = await UserController.createUserForOrder(contact_phone, contact_name, normalizedReferralCode, { terms_accepted, age_confirmed })
          userId = newUser.id
          isGuestOrder = true
          guestUserCreated = newUser.__created === true
        } catch (error) {
          logger.error('创建用户失败', { err: error?.message, stack: error?.stack })
          // 只透传业务语义错误（手机号已注册/账号禁用等），其余内部异常不外泄
          const businessMessage = /已被注册|已被禁用|无法自动注册|无效|不符合/.test(error?.message || '')
            ? error.message
            : '账号创建失败，请稍后重试'
          return res.status(businessMessage === error?.message ? 400 : 500).json({
            success: false,
            message: businessMessage
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
          const responseData = await buildCreateOrderResponseData(existingOrder.id, { userId, isGuestOrder, guestUserCreated, deduplicated: true })
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
        /**
         * 数量上限按「单品行」与「组合包展开行」区分 —— 与计价引擎同一口径。
         *
         * 组合包展开行的数量 = 组件配比 × 组合包数量（配比 3、买 1667 个 → 展开 5001）。
         * 引擎早就放开了（MAX_BUNDLE_LINE_QTY），控制器这里还卡着 1-5000 →
         * **合法的组合包订单被 400 拒掉**（配比 ≥ 51 的组合包从 UI 买不了）。
         */
        const isBundleLine = !!(row.engineLine && row.engineLine.bundle_id != null)
        const qtyLimit = isBundleLine ? MAX_BUNDLE_LINE_QTY : 5000
        if (!Number.isInteger(qty) || qty < 1 || qty > qtyLimit) {
          return res.status(400).json({
            success: false,
            message: `商品 ${product.name} 数量无效（需为 1-${qtyLimit} 的整数）`
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
          /**
           * 权威行小计（THB 域）—— 组合包按权重分摊时，
           * price × quantity ≠ line_total（除不尽的尾差会丢），
           * 对账与订单详情展示都以本列为准。
           */
          line_total: itemTotal,
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
            line_total: 0,
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

      // 所有预检完成：进入写阶段。事务在 fn 内创建，40P01/40001 时 withDeadlockRetry 重建事务整体重跑；
      // 业务校验失败以 { ok:false, status, message } 返回、不触发重试；res 响应副作用一律在事务外执行
      const result = await withDeadlockRetry(async () => {
        const transaction = await sequelize.transaction()
        try {
          /**
           * 订单号生成 + 唯一冲突重试（最多 5 次，SAVEPOINT 模式）：
           * PG 下事务内语句报错后整事务进入 aborted 状态，不设保存点直接重插只会再撞 25P02，
           * 因此仿 pointsService.lockOrCreateBalance：Order.create 包在保存点内，
           * 撞 order_no 唯一约束（23505）时回滚到保存点、重生成订单号再插。
           * 幂等键 (user_id, client_order_key) 冲突同样报 23505，必须区分错误来源：
           * 命中幂等键索引 → 不再重试，整事务回滚后按 key 查重返回（见 withDeadlockRetry 后的 deduplicated 分支）。
           * 保存点内吞掉的 23505 不会外溢，withDeadlockRetry 只见 40P01/40001
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
                /**
                 * 计价口径快照：规则版本 + 本单命中的优惠明细。
                 * 事后有人问"这单为什么是这个价"，靠这两列就能答；
                 * 没有它们只能靠猜（老订单的行存原价、总额存折后价，
                 * 新订单反过来 —— 光看数据分不出是哪套规则算的）。
                 */
                pricing_version: PRICING_ENGINE_VERSION,
                discount_snapshot: buildDiscountSnapshot(priced, orderItems),
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
            if (clientKeyConflicted) {
              // 幂等键冲突：整单回滚，由事务外按 (user_id, key) 查重返回
              return { ok: true, deduplicated: true }
            }
            return { ok: false, status: 500, message: '生成订单号失败，请稍后重试' }
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
              return {
                ok: false,
                status: 400,
                message: `商品 ${entry.name} 库存不足（商品 ID ${entry.product_id}）`
              }
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
              return { ok: false, status: 400, message: '抵扣券不可用或已被使用' }
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
          /**
           * 扣库存成功后**立刻**失效商品列表缓存（放在提交之后）。
           *
           * 商品/组合包列表有 15-20s 的响应缓存，之前只有商品写路径
           * （改价/改库存/上下架）会清，下单扣库存这条**没清** ——
           * 顾客下单后立刻刷新商品页，仍看到"有货"，
           * 点进去下单却被"库存不足"拒（体验上像系统前后不一致）。
           *
           * 放在提交之后：事务回滚时不该清（库存没扣，缓存里的旧值是对的）。
           */
          await clearResponseCache().catch(() => {})
          return { ok: true, orderId: order.id, totalAmount: order.total_amount }
        } catch (e) {
          // 死锁等其余错误回滚后上抛：40P01/40001 由 withDeadlockRetry 重建事务重跑，其余原样透出
          await transaction.rollback().catch(() => {})
          throw e
        }
      })

      if (!result.ok) {
        return res.status(result.status).json({ success: false, message: result.message })
      }

      if (result.deduplicated) {
        /**
         * 幂等键冲突：并发下同 key 的负方会被唯一索引阻塞到胜方提交后才报 23505，
         * 此刻按 (user_id, key) 必能查到胜方已提交的订单，按幂等成功原样返回
         */
        const existingOrder = await Order.findOne({
          where: { user_id: userId, client_order_key: clientOrderKey }
        })
        if (existingOrder) {
          const responseData = await buildCreateOrderResponseData(existingOrder.id, { userId, isGuestOrder, guestUserCreated, deduplicated: true })
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
        // 极端场景：冲突来源行尚未提交/已回滚导致查不到，沿用原 500 口径让客户端重试
        return res.status(500).json({
          success: false,
          message: '生成订单号失败，请稍后重试'
        })
      }

      // 返回创建的订单信息（含订单项；游客单附带账号与 token）
      const responseData = await buildCreateOrderResponseData(result.orderId, { userId, isGuestOrder, guestUserCreated })

      /**
       * 注册赠券：游客自动注册建号时发放，但**必须等订单真正创建成功**。
       * 早期在建号时就发券，而建号发生在商品/库存/计价校验之前，
       * 导致"下单失败"也会留下已注册账号 + 已发放赠券 ——
       * 攻击者可用一批手机号反复触发失败下单来批量造号并薅走注册赠券。
       */
      if (isGuestOrder && guestUserCreated) {
        try {
          await grantRegisterGiftCoupons(userId)
        } catch (giftError) {
          logger.error('游客订单注册赠券发放失败（不影响下单）', {
            userId,
            err: giftError?.message,
            stack: giftError?.stack
          })
        }
      }

      AuditLog.logUser({
        user: req.user || (isGuestOrder ? { id: userId } : null),
        event: isGuestOrder ? 'order.create.guest' : 'order.create',
        resource: 'order',
        resourceId: result.orderId,
        detail: {
          payment_method: paymentMethod,
          item_count: items.length,
          total_amount: result.totalAmount
        },
        req
      }).catch(() => {})

      res.status(201).json({
        success: true,
        message: '订单创建成功',
        data: responseData
      })

    } catch (error) {
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
        code: 'INTERNAL_SERVER_ERROR'
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

      // 积分换购单与抵扣券互斥（P2）：前置拦截，与 createOrder 错误路径一致
      if (paymentMethod === 'points' && userCouponId != null) {
        return res.status(400).json({
          success: false,
          message: '积分换购订单不可使用抵扣券'
        })
      }

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
      const id = parseId(req.params.id)
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
      let affected = 0
      try {
        /**
         * 套 withDeadlockRetry（第 44 轮）：条件 UPDATE 会锁**订单行**，
         * 发积分会锁**积分余额行** —— 与订单取消/删除路径（同样锁这两类行）
         * 交叉时可能死锁（40P01）。原来死锁直接 500「确认支付失败」。
         */
        affected = await withDeadlockRetry(async () => {
          const transaction = await sequelize.transaction()
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
            const n = updateResult[0]

            if (n === 1) {
              // 发放口径：floor(折后实付 THB × points_earn_rate)，为 0 不发
              const earnPoints = calcPointsEarn(Number(order.total_amount_thb) || 0, pointsEarnRate)
              if (earnPoints > 0) {
                await pointsService.grantPurchasePoints(userId, order.id, earnPoints, { transaction })
              }
            }
            await transaction.commit()
            return n
          } catch (e) {
            await transaction.rollback().catch(() => {})
            throw e
          }
        })
      } catch (error) {
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

      const { status } = req.query
      // 统一走 resolvePagination：page 也必须有上限。
      // 否则 ?page=999999999 会产生近亿 OFFSET —— PG 得顺序扫过整表再丢弃，
      // 叠加 findAndCountAll 的 COUNT(*) 就是两次全表扫描（深翻页放大）。
      const { page: safePage, limit: safeLimit, offset } = resolvePagination(
        req.query,
        { pageSizeKey: 'limit', defaultPageSize: 10, maxPageSize: 100 }
      )

      /**
       * 状态筛选支持**逗号分隔的多个值**（status=paid,shipping），
       * 与管理端订单列表**同一套解析与校验**。
       *
       * 之前是把原始字符串直接塞进 where.status：
       *   - 单个值能用；
       *   - 传 "paid,shipping" → where.status = 'paid,shipping' → **匹配不到任何单**，
       *     接口**静默返回空列表** —— 最坏的一种错：看起来像"我没有订单"，
       *     实际是筛选写错了，而用户根本无从察觉。
       */
      const statusList = String(status || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const invalidStatus = statusList.find((s) => !ORDER_STATUS_VALUES.includes(s))
      if (invalidStatus) {
        return res.status(400).json({
          success: false,
          // 第 48 轮：状态用中文名 + 说明，别把内部枚举值甩给用户
          message: `无效的订单状态「${statusText(invalidStatus)}」（合法值：${ORDER_STATUS_VALUES.map(v => statusText(v)).join(' / ')}）`
        })
      }

      let where = { user_id: userId }
      if (statusList.length > 0) {
        where.status = { [Op.in]: statusList }
      }
      // 日历日按业务时区切（business_timezone 配置）
      where = applyCreatedBetween(where, req.query, { timezone: await getBusinessTimezone() })

      /**
       * 第 49 轮：**只取列表真正用到的列**，并且**不下发 `admin_note`**。
       *
       * 原来这里是整行 Order：
       *   - `discount_snapshot`（JSONB 折扣快照）、`client_order_key`（幂等键）、
       *     `pricing_version` 等宽字段白下载 —— 列表根本不用
       *   - **`admin_note` 是"运营内部备注"**（模型注释写明"用户看不到"），
       *     却在整行返回里**原样下发给客户**了 ✗
       *
       * 门户列表实际用到：order_no / status / payment_method / currency_code /
       * total_amount / total_amount_thb / created_at / notes / delivery_address / postal_code
       */
      const { count, rows: orders } = await Order.findAndCountAll({
        where,
        attributes: [
          'id', 'order_no', 'status', 'payment_method', 'currency_code',
          'total_amount', 'total_amount_thb', 'created_at',
          'notes', 'delivery_address', 'postal_code'
        ],
        order: [['created_at', 'DESC']],
        limit: safeLimit,
        offset
      })

      /**
       * 累计消费统计：只计真实成交的订单。
       *
       * 口径来自 constants/revenueStatus.js —— 与面板总营收、订单列表今日营收、
       * 个人中心累计消费**同一份**（这里曾经是第四份拷贝，各自写着
       * ['pending','cancelled'] 和 != 'points'，改一处忘另一处就会两个数）。
       */
      const spentWhere = revenueWhere(Op, where)
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
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  // 获取订单详情（门户：仅能查本人订单；管理端：按 id 查任意订单）
  /**
   * 用户自助取消订单（第 45 轮）
   * =================================
   *
   * ## 为什么要有它
   *
   * 之前**只有管理端能取消订单**（PUT /api/admin/orders/:id/status）。
   * 客户想取消自己的订单，唯一办法是联系运营 —— 而这连带出一串"断头路"：
   *
   *   - **积分退回**（refund_cancel / revoke_cancel）只有管理员能触发
   *   - **抵扣券退还**（used_by_order_id 置空）同理
   *   - 客户在自己的订单列表里看不到任何"我能不能取消"的说明
   *
   * 也就是说：**取消订单 → 资源回补**这条业务链，只有起点没有客户的入口。
   *
   * ## 规则
   *
   * - 只能取消**自己的**订单（where 里带 user_id）
   * - 状态机允许哪些状态可以转 cancelled，由 ORDER_STATUS_TRANSITIONS 决定
   *   （pending / paid / shipping 可以；已发货之后不行）
   * - 库存 / 积分 / 券的回补走**与管理端同一份实现**（performOrderCancel）
   */
  static async cancelOrder (req, res) {
    const id = parseId(req.params.id)
    const userId = req.user?.userId
    if (!id) {
      return res.status(400).json({ success: false, message: '无效的订单 ID' })
    }
    if (!userId) {
      return res.status(401).json({ success: false, message: '请先登录' })
    }

    try {
      const result = await withDeadlockRetry(async () => {
        const transaction = await sequelize.transaction()
        try {
          // 行锁防并发双取消（与管理员同时操作时也串行化）
          const order = await Order.findOne({
            where: { id, user_id: userId },
            transaction,
            lock: transaction.LOCK.UPDATE
          })
          if (!order) {
            await transaction.rollback()
            return { ok: false, status: 404, message: '订单不存在' }
          }

          const cancelResult = await performOrderCancel(order, transaction)
          if (!cancelResult.ok) {
            await transaction.rollback()
            return cancelResult
          }

          await order.update({ status: 'cancelled' }, { transaction })
          await transaction.commit()
          return { ok: true, orderId: order.id }
        } catch (e) {
          await transaction.rollback().catch(() => {})
          throw e
        }
      })

      if (!result.ok) {
        return res.status(result.status).json({ success: false, message: result.message })
      }

      const updatedOrder = await Order.findByPk(result.orderId, {
        include: [
          {
            model: OrderItem,
            as: 'items',
            include: [{ model: Product, as: 'product', paranoid: false }]
          }
        ]
      })
      return res.json({ success: true, message: '订单已取消', data: updatedOrder })
    } catch (error) {
      logger.error('用户取消订单失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '取消订单失败', code: 'INTERNAL_SERVER_ERROR' })
    }
  }

  /**
   * 客户修改订单备注（第 46 轮）
   *
   * 之前备注**只能在结算页下单时填**，下单之后就没有任何修改入口
   * （详情页只读，也没有对应接口）→ 客户填错了地址/规格，只能找客服。
   *
   * 规则：
   *   - 只能改**自己的**订单（where 带 user_id）
   *   - 订单进入终态（cancelled / completed）后不允许再改
   *   - 备注最长 500 字（与下单时的字段长度一致）
   */
  static async updateOrderNotes (req, res) {
    const id = parseId(req.params.id)
    const userId = req.user?.userId
    if (!id) {
      return res.status(400).json({ success: false, message: '无效的订单 ID' })
    }
    if (!userId) {
      return res.status(401).json({ success: false, message: '请先登录' })
    }
    const notes = String(req.body?.notes ?? '').trim()
    if (notes.length > 500) {
      return res.status(400).json({ success: false, message: '备注不能超过 500 个字符' })
    }
    try {
      const order = await Order.findOne({
        where: { id, user_id: userId },
        attributes: ['id', 'status', 'notes']
      })
      if (!order) {
        return res.status(404).json({ success: false, message: '订单不存在' })
      }
      if (['cancelled', 'completed'].includes(order.status)) {
        return res.status(400).json({ success: false, message: '订单已结束，不能再修改备注' })
      }
      await order.update({ notes }, { where: { id: order.id } })
      return res.json({ success: true, message: '备注已更新', data: { id: order.id, notes } })
    } catch (error) {
      logger.error('修改订单备注失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '修改备注失败', code: 'INTERNAL_SERVER_ERROR' })
    }
  }

  static async getOrderDetail(req, res) {
    try {
      // 路径参数严格解析：非正整数会让 PG 抛 invalid input syntax（500）
      const id = parseId(req.params.id)
      if (!id) {
        return res.status(400).json({ success: false, message: '无效的订单 ID' })
      }
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
        /**
         * 第 49 轮：**客户看到的订单详情不包含 `admin_note`**（运营内部备注）。
         *
         * 原来这里整行返回 → 客户在订单详情页能看到运营写的内部备注
         * （模型注释明确写"用户看不到"，但接口把它带出去了）。
         * 列表接口已裁剪，这里也要一起裁。
         */
        order = await Order.findOne({
          where: { id, user_id: userId },
          attributes: { exclude: ['admin_note'] },
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
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  // 管理员获取所有订单
  static async getAllOrders(req, res) {
    try {
      const { status, startDate, endDate, keyword } = req.query
      // 分页参数统一 clamp：该端点页大小参数名为 limit，上限 100
      const { page, limit, offset } = resolvePagination(req.query, { pageSizeKey: 'limit', maxPageSize: 100 })

      /**
       * 状态筛选支持**逗号分隔的多个值**（status=paid,shipping）。
       *
       * 为什么需要：面板上"待发货"的待办数统计的是 paid + shipping 两个状态，
       * 点进去如果只能看单个状态，**列表条数和卡上数字对不上** ——
       * 用户会以为系统漏单。多选是唯一能让两边口径一致的做法。
       */
      const statusList = String(status || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const invalidStatus = statusList.find((s) => !ORDER_STATUS_VALUES.includes(s))
      if (invalidStatus) {
        return res.status(400).json({
          success: false,
          // 第 48 轮：状态用中文名 + 说明，别把内部枚举值甩给用户
          message: `无效的订单状态「${statusText(invalidStatus)}」（合法值：${ORDER_STATUS_VALUES.map(v => statusText(v)).join(' / ')}）`,
          code: 'INVALID_STATUS'
        })
      }

      let where = {}
      if (statusList.length > 0) {
        where.status = { [Op.in]: statusList }
      }
      /**
       * 日期筛选走 applyCreatedBetween（本地日历日 + 非法日期安全忽略）。
       *
       * 之前是 `Op.between: [startDate, endDate]` 裸传：
       *   1. 前端 el-date-picker 若没带 value-format，v-model 是 **Date 对象**，
       *      经 URLSearchParams 变成 "Thu Nov 12 2026 00:00:00 GMT+0800 (China Standard Time)"
       *      → PG 直接报 `time zone "gmt+0800" not recognized` → 500；
       *   2. 裸字符串被 PG 当作 **UTC 00:00**，而面板统计用本地日界
       *      → 同一笔单在两个页面落在不同的"那一天"；
       *   3. 非法日期没有任何校验 → 传什么崩什么。
       * applyCreatedBetween 三条一起解决。
       */
      where = applyCreatedBetween(where, { start_date: startDate, end_date: endDate }, { timezone: await getBusinessTimezone() })
      if (keyword) {
        // 转义 LIKE 通配符 + 限长，避免 keyword=% 把精确筛选放大成全表匹配
        const like = likeContains(keyword)
        const matchingUsers = await User.findAll({
          attributes: ['id'],
          limit: KEYWORD_USER_MATCH_LIMIT,
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

      /**
       * 列表与统计是**两条互不依赖**的查询（统计只看 where，不看本页行），
       * 之前是串行的：先等列表返回，再发统计 → 两次往返。
       * 并发发出 → 一次往返。订单页每次打开都要跑，延迟是用户直接感受到的。
       *
       * 统计本身是**全表聚合**（SUM + FILTER 扫全部命中行）：
       * 实测 5 万订单约 5ms，10 万级约 10ms —— 扫描本身还不算瓶颈，
       * 但**每次刷新都重扫一遍**是浪费（运营反复刷新同一筛选条件、
       * 多个运营同时开着后台，都会重复扫同一批数据）。
       * 所以按筛选条件做 15s 短缓存：键含筛选条件（不含分页），
       * 不同筛选各算各的。
       */
      // 业务时区：服务端所有"今天"口径都按它算；也随响应返回，
      // 让前端在拿不到 stats 时能按同一口径聚合（见响应里的 timezone 字段）
      const tz = await getBusinessTimezone()
      const statsCacheKey = JSON.stringify([
        tz,
        statusList.join(','), keyword || '', startDate || '', endDate || ''
      ])
      const cachedStats = getCachedOrderStats(statsCacheKey)

      const statsPromise = cachedStats
        ? Promise.resolve(cachedStats)
        : (async () => {
        const toFiniteNumber = (v) => {
          const n = Number(v)
          return Number.isFinite(n) ? n : 0
        }
        // "今天"按业务时区切（business_timezone 配置），不再依赖服务器本地时区
        const todayStart = startOfBusinessDay(tz)
        const statsWhere = { ...where }
        delete statsWhere.status
        /**
         * 状态条件转成 SQL 片段。
         * 单值走 `status = 'x'`；多值走 `status IN ('x','y')`（值均经 escape 转义，防注入）。
         */
        const statusSql = statusList.length > 0
          ? `status IN (${statusList.map((s) => sequelize.escape(s)).join(', ')})`
          : null
        const todayLit = sequelize.escape(todayStart)
        /**
         * 金额统计口径：
         *   - **有**状态筛选 → 尊重筛选（筛 pending 就看 pending 的金额）
         *   - **无**状态筛选 → 只算真实成交（排除 pending/cancelled）
         *
         * 之前无筛选时不过滤状态 → 「总金额数 / 今日营收」把没付的钱和已取消的单
         * 都算进去 → 面板上的营收虚高，和订单列表的「累计消费」对不上。
         */
        const revenueSql = statusSql || revenueStatusSql((v) => sequelize.escape(v))
        const totalAmountFilter = ` FILTER (WHERE ${revenueSql})`
        const todayAmountFilter = statusSql
          ? ` FILTER (WHERE created_at >= ${todayLit} AND ${statusSql})`
          : ` FILTER (WHERE created_at >= ${todayLit} AND ${revenueSql})`
        const [statsRow] = await Order.findAll({
          attributes: [
            [sequelize.literal(`COUNT(*) FILTER (WHERE status = 'completed')`), 'completed'],
            [sequelize.literal(`COALESCE(SUM(total_amount_thb)${totalAmountFilter}, 0)`), 'totalAmount'],
            [sequelize.literal(`COALESCE(SUM(total_amount_thb)${todayAmountFilter}, 0)`), 'todayAmount']
          ],
          where: statsWhere,
          raw: true
        })
        // total 由外层用 count 填（这里拿不到分页的 count）
        const result = {
          completed: toFiniteNumber(statsRow?.completed),
          totalAmount: toFiniteNumber(statsRow?.totalAmount),
          todayAmount: toFiniteNumber(statsRow?.todayAmount)
        }
        setCachedOrderStats(statsCacheKey, result)
        return result
      })()

      /**
       * 第 49 轮：裁剪列。
       *
       * 管理端列表用的是 order_no / user / payment_method / currency_code /
       * total_amount / total_amount_thb / status / contact_name / contact_phone / created_at，
       * 而整行还带着 `discount_snapshot`（JSONB）、`admin_note`、`notes`、
       * `delivery_address`、`client_order_key` 等 —— 每页 20 行、每 30 秒自动刷新一次，
       * 这些宽字段是白下载的。
       */
      const { count, rows: orders } = await Order.findAndCountAll({
        where,
        attributes: [
          'id', 'order_no', 'status', 'payment_method', 'currency_code',
          'total_amount', 'total_amount_thb', 'created_at',
          'contact_name', 'contact_phone', 'notes', 'admin_note',
          'delivery_address', 'postal_code', 'tracking_number'
        ],
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
      // 三条聚合合并为单次查询（PG FILTER 语法），语义与原三条独立查询严格一致：
      //   completed   —— 原实现 {...where, status:'completed'} 会覆盖用户的 status 筛选，
      //                  故统计基准 where 剔除 status，completed 用 FILTER 独立计；
      //   totalAmount —— 尊重用户 status 筛选（有筛选时 FILTER 叠加 status 条件）；
      //   todayAmount —— "今日 0 点起"与筛选条件中 created_at 范围的交集，FILTER 追加 created_at 下限
      // status/todayStart 均经 sequelize.escape 转义后才进 literal，防注入
      const statsRow = await statsPromise
      const toFiniteNumber = (v) => {
        const n = Number(v)
        return Number.isFinite(n) ? n : 0
      }
      const stats = {
        total: toFiniteNumber(count),
        completed: toFiniteNumber(statsRow?.completed),
        totalAmount: toFiniteNumber(statsRow?.totalAmount),
        todayAmount: toFiniteNumber(statsRow?.todayAmount)
      }

      res.json({
        success: true,
        data: {
          orders,
          total: count,
          page,
          totalPages: Math.ceil(count / limit),
          stats,
          // 业务时区：前端在拿不到 stats 时要自己按"今天"聚合，
          // 口径必须与服务端一致（服务端按业务时区算，前端不能按浏览器本地时区算）
          timezone: tz
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
  // 事务整体包 withDeadlockRetry：40P01/40001 时重建事务重跑；业务校验失败返回
  // { ok:false, status, message } 不触发重试，res 响应一律在事务外发出
  /**
   * 批量改订单状态（发货/完成等）。
   *
   * 运营的日常动作是成批的（今天这几单一起发、这批单全部完成），
   * 一个一个点既慢又容易漏 —— 而且漏的那单往往就是客户催得最急的。
   *
   * 限制：一次最多 200 个 id；每单仍按**各自当前状态**校验流转合法性
   * （不合法的那些会跳过并报出来，不会把不该改的单硬改掉）。
   */
  static async bulkUpdateOrderStatus (req, res) {
    try {
      const { ids, status, tracking_number, admin_note } = req.body || {}
      const BULK_MAX = 200

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: '请选择要操作的订单' })
      }
      if (ids.length > BULK_MAX) {
        return res.status(400).json({ success: false, message: `一次最多操作 ${BULK_MAX} 个订单` })
      }
      if (!ORDER_STATUS_VALUES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `无效的订单状态：${status}（合法值：${ORDER_STATUS_VALUES.join('/')}）`
        })
      }
      const idList = [...new Set(ids.map(v => parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0))]
      if (idList.length === 0) {
        return res.status(400).json({ success: false, message: '无效的订单 ID' })
      }

      /**
       * 整批一个事务：要么这批全改，要么全不改 —— 避免"改了一半、另一半没改"的
       * 半成品状态（运营会以为全改完了）。
       * 事务整体包 withDeadlockRetry：40P01/40001 时重建事务重跑。
       */
      const result = await withDeadlockRetry(async () => {
        const transaction = await sequelize.transaction()
        try {
          // 行锁：并发改同一批订单时串行化，避免两个运营各改一半
          const orders = await Order.findAll({
            where: { id: { [Op.in]: idList } },
            transaction,
            lock: transaction.LOCK.UPDATE,
            order: [['id', 'ASC']]
          })

          const found = new Set(orders.map(o => o.id))
          const changed = []
          const skipped = []

          // 请求里给了但库里没有的 id：如实回报，不静默吞掉
          for (const id of idList) {
            if (!found.has(id)) {
              skipped.push({ id, status: null, reason: '订单不存在' })
            }
          }

          /**
           * 批量预取：本批所有订单的**购物积分流水**与**订单明细**，各一条查询拿完。
           *
           * 原来每单各查一次（earn 流水还被查了两遍：守卫一次、restoreOrderResources
           * 内部又一次）—— 实测批量取消 5 单发 56 条查询，其中 25 条是这类可省的读。
           *
           * 为什么可以一次拿完：
           *   - 订单行已被 lock: UPDATE 锁住（并发批量改状态会串行化）；
           *   - 这两类数据在本次事务里**只读不写**（回收积分写的是 type='revoke_cancel'
           *     的新流水，不会改动 earn_purchase；明细行在取消路径里也只读）。
           *
           * ⚠️ 余额行**不能**这样预取/缓存：前一张单回收积分后余额就变了，
           * 后一张单的守卫必须看到**最新**余额 → 仍然每单读一次（行锁保持不变）。
           */
          const bulkOrderIds = orders.map(o => o.id)
          const [bulkEarnTxs, bulkItems] = await Promise.all([
            PointTransaction.findAll({
              where: { order_id: { [Op.in]: bulkOrderIds }, type: 'earn_purchase' },
              transaction
            }),
            OrderItem.findAll({
              where: { order_id: { [Op.in]: bulkOrderIds } },
              transaction
            })
          ])
          const earnTxsByOrder = new Map()
          for (const tx of bulkEarnTxs) {
            if (!earnTxsByOrder.has(tx.order_id)) earnTxsByOrder.set(tx.order_id, [])
            earnTxsByOrder.get(tx.order_id).push(tx)
          }
          const itemsByOrder = new Map()
          for (const it of bulkItems) {
            if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, [])
            itemsByOrder.get(it.order_id).push(it)
          }

          for (const order of orders) {
            const allowed = ORDER_STATUS_TRANSITIONS[order.status] || []
            if (!allowed.includes(status)) {
              skipped.push({
                id: order.id,
                status: order.status,
                reason: `不允许从「${statusText(order.status)}」变更为「${statusText(status)}」`
              })
              continue
            }

            /**
             * 批量取消必须与单条取消一样回补资源（库存/积分/券），
             * 否则"批量取消"会白送库存 —— 库存虚增、积分不退。
             * 同时沿用单条路径的护栏：已发放的购物积分被用掉时不允许取消。
             */
            if (status === 'cancelled') {
              // 预取数据（见上方说明）：流水与明细各一条查询拿完整批
              const earnTxs = earnTxsByOrder.get(order.id) || []
              /**
               * 积分守卫（第 44 轮）：改用与**单条取消路径同一个**非加锁守卫。
               *
               * 原来这里对余额行加了 FOR UPDATE → 批量取消的加锁顺序变成
               * "先锁余额 → 后锁商品"，而下单路径是"先锁商品 → 后锁余额"
               * → 正好相反 → 同一个用户一边下单一边批量取消时 40P01 死锁。
               *
               * 单条路径早就改成普通读了（见 assertEarnedPointsNotSpent 的注释：
               * 「这里不加行锁（普通读即可）」），批量路径却没跟上 ——
               * 这就是"约定改了，只改了一半"。
               *
               * 不加锁是否安全：余额的并发安全由 revokePurchasePoints 内部保证
               * （它自己 lockOrCreateBalance 并按 min(余额, 数量) 截断，账仍然对得上）。
               */
              const guard = await assertEarnedPointsNotSpent(order, transaction, { earnTxs })
              if (!guard.ok) {
                skipped.push({
                  id: order.id,
                  status: order.status,
                  reason: guard.message
                })
                continue
              }

              order.items = itemsByOrder.get(order.id) || []
              await restoreOrderResources(order, transaction, { earnTxs })
            }

            const patch = { status }
            if (tracking_number !== undefined) {
              const tn = tracking_number == null ? null : String(tracking_number).trim().slice(0, 64)
              patch.tracking_number = tn || null
            }
            if (admin_note !== undefined) {
              patch.admin_note = admin_note == null ? null : String(admin_note).slice(0, 2000)
            }
            if (['shipped', 'delivered', 'completed'].includes(status) && !order.shipped_at) {
              patch.shipped_at = new Date()
            }
            await order.update(patch, { transaction })
            changed.push(order.id)
          }

          await transaction.commit()
          return { ok: true, changed, skipped }
        } catch (e) {
          await transaction.rollback().catch(() => {})
          throw e
        }
      })

      await clearResponseCache()

      /**
       * 站内通知（第 54 轮）：批量改状态同样要通知用户。
       *
       * 批量路径的结果结构与单条不同：这里是 `result.changed`（订单 id 数组）。
       *
       * ⚠️ 必须**一次查完**而不是逐单查：逐单查会让 N 单 = N 次额外查询
       * （bulkCancelResources 门禁实测 10 单就多 10 条 → 查询数从 80 涨到 98）。
       *
       * 站内通知与短信**共用同一批订单数据**（一次 findAll）——
       * 两边各查一次就多一条查询，而批量操作的查询数是有门禁的。
       */
      const notified = await notifyOrderStatusChangedBatch(result.changed || [], status)

      /** 短信（第 55 轮）：批量改状态同样要通知（复用上面查到的订单，不重复查） */
      await sendOrderStatusSmsBatch(result.changed || [], status, notified?.orders)

      const skippedCount = result.skipped.length
      return res.json({
        success: true,
        message: skippedCount > 0
          ? `已更新 ${result.changed.length} 个订单，跳过 ${skippedCount} 个`
          : `已更新 ${result.changed.length} 个订单`,
        data: { changed: result.changed, skipped: result.skipped }
      })
    } catch (error) {
      logger.error('批量更新订单状态失败', { err: error?.message, stack: error?.stack })
      return res.status(500).json({ success: false, message: '批量操作失败', code: 'INTERNAL_SERVER_ERROR' })
    }
  }

  static async updateOrderStatus(req, res) {
    // 路径参数严格解析：非正整数会让 PG 抛 invalid input syntax（500）
    const id = parseId(req.params.id)
    const { status, tracking_number, admin_note } = req.body
    if (!id) {
      return res.status(400).json({ success: false, message: '无效的订单 ID' })
    }

    try {
      const result = await withDeadlockRetry(async () => {
        const transaction = await sequelize.transaction()
        try {
          if (!ORDER_STATUS_VALUES.includes(status)) {
            await transaction.rollback()
            return {
              ok: false,
              status: 400,
              message: `无效的订单状态：${status}（合法值：${ORDER_STATUS_VALUES.join('/')}）`
            }
          }

          // 行锁防并发双转移
          const order = await Order.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE
          })
          if (!order) {
            await transaction.rollback()
            return { ok: false, status: 404, message: '订单不存在' }
          }

          const fromStatus = order.status
          const allowedTargets = ORDER_STATUS_TRANSITIONS[fromStatus] || []
          if (!allowedTargets.includes(status)) {
            await transaction.rollback()
            return {
              ok: false,
              status: 400,
              message: `订单状态不允许从「${statusText(fromStatus)}」变更为「${statusText(status)}」`
            }
          }

          // 进入 cancelled 时回补库存与积分（公共动作，用户端自助取消也走这一份）
          if (status === 'cancelled') {
            const cancelResult = await performOrderCancel(order, transaction)
            if (!cancelResult.ok) {
              await transaction.rollback()
              return cancelResult
            }
          }

          /**
           * 履约信息：标记发货时记物流单号与发货时间；运营备注随时可改。
           * 之前只有状态没有运单信息 —— 客服查不到快递，仓库也没有交接凭据。
           */
          /**
           * 改之前的原状态 —— 必须在 order.update() **之前**取：
           * update 会把内存里的 order.status 一起改成新值，取晚了就永远是新状态。
           */
          const previousStatus = order.status
          const patch = { status }
          if (tracking_number !== undefined) {
            const tn = tracking_number == null ? null : String(tracking_number).trim().slice(0, 64)
            patch.tracking_number = tn || null
          }
          if (admin_note !== undefined) {
            patch.admin_note = admin_note == null ? null : String(admin_note).slice(0, 2000)
          }
          /**
           * 进入「已发货」及之后的状态时自动记录发货时间（没手动给就用现在）。
           * 状态机：pending→paid→shipping(备货中)→shipped(已发货)→delivered→completed
           */
          if (['shipped', 'delivered', 'completed'].includes(status) && !order.shipped_at) {
            patch.shipped_at = new Date()
          }
          await order.update(patch, { transaction })

          /**
           * 「待支付 → 已支付/备货中」时补发购物积分。
           *
           * 背景：在线支付单的购物积分**只在** confirmOnlinePayment 里发。
           * 而管理端把「待支付」直接改成「已支付/备货中」是常见操作
           * （货到付款代收、线下转账到账）—— 状态已经是"钱收到了"，
           * 但积分没发 → **客户白少拿积分**（1000 THB 少 10 分）。
           *
           * 条件为什么是 fromStatus === 'pending'：
           *   - COD 单下单就是 shipping，不走这条路 ✓
           *   - 在线单 confirm 过就是 shipping（fromStatus 不是 pending）→ 不会重复发 ✓
           *   - 所以只有"从未确认过支付的在线单"会命中 ✓
           *
           * 幂等：先看有没有发过 earn_purchase 流水，发过就不重复发。
           */
          if (previousStatus === 'pending' && ['paid', 'shipping'].includes(status) && order.user_id) {
            const alreadyEarned = await PointTransaction.count({
              where: { order_id: order.id, type: 'earn_purchase' },
              transaction
            })
            if (alreadyEarned === 0) {
              const pointsEarnRate = await getPointsEarnRate()
              const earnPoints = calcPointsEarn(Number(order.total_amount_thb) || 0, pointsEarnRate)
              if (earnPoints > 0) {
                await pointsService.grantPurchasePoints(order.user_id, order.id, earnPoints, { transaction })
              }
            }
          }

          await transaction.commit()
          return { ok: true, orderId: order.id }
        } catch (e) {
          // 死锁等其余错误回滚后上抛给 withDeadlockRetry 判定（40P01/40001 重建事务，其余透出）
          await transaction.rollback().catch(() => {})
          throw e
        }
      })

      if (!result.ok) {
        return res.status(result.status).json({ success: false, message: result.message })
      }

      /**
       * 站内通知（第 54 轮）：订单状态变了，用户**必须知道**。
       *
       * 原来只写操作日志（给运营看），用户端完全零感知 ——
       * "我付了钱，货发出去了吗"只能反复刷订单页。
       *
       * 放在事务 commit **之后**：通知失败绝不能影响业务（notifyUser 内部吞异常）。
       */
      await notifyOrderStatusChanged(result.orderId, status)

      /** 短信（第 55 轮）：泰国场景短信是刚需 —— 用户得知道货发出去了 */
      await sendOrderStatusSms(result.orderId, status)

      // 返回更新后的订单（含 items）
      const updatedOrder = await Order.findByPk(result.orderId, {
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
      logger.error('更新订单状态失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '更新订单状态失败'
      })
    }
  }

  // 管理员删除订单
  // 事务整体包 withDeadlockRetry：40P01/40001 时重建事务重跑；订单不存在返回
  // { ok:false, 404 } 不触发重试，res 响应一律在事务外发出
  static async deleteOrder(req, res) {
    const { id } = req.params

    try {
      const result = await withDeadlockRetry(async () => {
        const transaction = await sequelize.transaction()
        try {
          const order = await Order.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE
          })

          if (!order) {
            await transaction.rollback()
            return { ok: false, status: 404, message: '订单不存在' }
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
            /**
             * 与取消路径同一道闸：积分已被花掉的订单不许删，
             * 否则 revokePurchasePoints 只能按 0 截断 → 用户白拿积分，
             * 而且下面的 PointTransaction.destroy 会把这笔流水的账一起抹掉。
             */
            const guard = await assertEarnedPointsNotSpent(order, transaction)
            if (!guard.ok) {
              await transaction.rollback()
              return { ok: false, status: 400, message: guard.message }
            }
            await restoreOrderResources(order, transaction)
          }

          /**
           * 清理积分流水 —— **只清"已回补过积分"的那些状态**。
           *
           * revokePurchasePoints 的语义是：余额减 n，**同时写一条 type='revoke_cancel' 的负流水**
           * （原 earn_purchase 流水仍在）。所以：
           *   - pending/paid/shipping：已回补 → earn(+50) 与 revoke(-50) 净值 0，
           *     两条一起删掉，余额与流水仍一致 ✓
           *   - 已发货/已完成/已取消：**没有**回补（或净额本就是 0），
           *     余额里还含着这笔 earn_purchase → 把流水删了就是
           *     「余额 ≠ 流水累计」→ 自家每日体检**永久报红**，
           *     而且这笔积分的来源凭证凭空消失，事后无法对账。
           *
           * 保留流水即可（order_id 会被 FK 置 NULL），账实一致、凭证也还在。
           */
          if (RESTORE_ON_DELETE_STATUSES.includes(order.status)) {
            await PointTransaction.destroy({
              where: { order_id: id },
              transaction
            })
          }

          // 清理订单促销快照：order_promotions 无 DB 级级联，随单硬删在此显式处理
          await OrderPromotion.destroy({
            where: { order_id: id },
            transaction
          })

          /**
           * 清理售后单：after_sales **没有外键**（表已存在，sync 不会再补 FK），
           * 删单时必须显式清理 —— 否则售后行变成孤儿：
           *   客户「我的售后」里出现 order: null 的记录；
           *   管理员去审核一律 404（关联订单不存在），该售后**永远停在 pending**，
           *   客户的退款结不掉。
           */
          await AfterSale.destroy({
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

          /**
           * 抵扣券释放（**无条件**，且必须在删单之前）。
           *
           * UserCoupon 模型的约定写得很清楚：
           *   「used_by_order_id 仅逻辑关联 orders.id：订单允许硬删，不建外键约束
           *     （释放先于删单完成）」
           * 也就是说 —— **券的释放必须先于删单**，否则 used_by_order_id 会指向
           * 一个不存在的订单（悬空引用）。
           *
           * 之前只在未履约状态（RESTORE_ON_DELETE_STATUSES）走了
           * restoreOrderResources 顺带释放券，已履约订单删除时**没人释放**：
           *   - 用户「我的优惠券」里永远躺着一张指向幽灵订单的「已使用」券，
           *     再也用不了；
           *   - 而体检项 coupon_used_has_order 只查 used_by_order_id IS NULL，
           *     查不出"挂着一个不存在的订单" —— 查不出来 = 没人会发现。
           *
           * 未履约订单上面 restoreOrderResources 已经释放过（used_by_order_id 置 NULL），
           * 这里再执行一次匹配 0 行，无副作用。
           *
           * 注意：已履约订单删除时**不回补库存与积分**（货确实发出去了），
           * 这里只处理券 —— 券不是实物，不存在"回补了会多卖一件"的问题。
           */
          await UserCoupon.update(
            { status: 'unused', used_by_order_id: null, used_at: null },
            { where: { used_by_order_id: id }, transaction }
          )

          // 再删除订单
          await order.destroy({ transaction })

          // 提交事务
          await transaction.commit()
          return { ok: true, orderInfo }
        } catch (e) {
          // 死锁等其余错误回滚后上抛给 withDeadlockRetry 判定（40P01/40001 重建事务，其余透出）
          await transaction.rollback().catch(() => {})
          throw e
        }
      })

      if (!result.ok) {
        return res.status(result.status).json({ success: false, message: result.message })
      }

      const { orderInfo } = result
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
      /**
       * 走统一的错误翻译层：
       *   - 数据库层的"坏输入"（超长/越界）→ 400 + 人话
       *   - 其它 → 500 + 固定文案（**不再把 error.message 拼给客户端**：
       *     那是 PG/Sequelize 的内部细节，属于信息泄漏）
       */
      return respondDbError(res, error, {
        logLabel: '删除订单失败',
        fallbackMessage: '删除订单失败',
        logger
      })
    }
  }

  // 管理员导出订单
  static async exportOrders(req, res) {
    try {
      const { status, startDate, endDate } = req.query

      let where = {}
      if (status) {
        // 与列表接口一致：支持逗号分隔的多个状态
        const statusList = String(status)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (statusList.length > 0) {
          where.status = { [Op.in]: statusList }
        }
      }
      // 同列表：日期走 applyCreatedBetween，导出与列表口径一致（见 getAllOrders 处的说明）
      where = applyCreatedBetween(where, { start_date: startDate, end_date: endDate }, { timezone: await getBusinessTimezone() })

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

/**
 * 订单状态 → 短信事件（只发用户真正关心的几档）
 *
 * 状态机：pending(待支付) → paid(已支付) → shipping(备货中) → shipped(已发货)
 *        → delivered(已送达) → completed(已完成)，cancelled 为终态。
 *
 * 为什么 `shipping`（备货中）**不发**：货还没交给快递，
 * 说"已发货"是骗用户。等 `shipped`（已发货 + 记了物流单号）再发。
 *
 * 为什么 `shipped` 对应"已发货"而不是"已送达"：
 * 已发货 = 包裹交给快递（用户最想知道的是"什么时候到、运单号多少"）；
 * 已送达 = 客户已签收（delivered / completed 才是这一档）。
 * 写反了的话，用户收到的第一条短信就是"您的订单已送达"—— 而包裹还在路上。
 */
const ORDER_SMS_EVENT_BY_STATUS = {
  shipped: SMS_EVENTS.ORDER_SHIPPED,
  delivered: SMS_EVENTS.ORDER_DELIVERED,
  completed: SMS_EVENTS.ORDER_DELIVERED,
  cancelled: SMS_EVENTS.ORDER_CANCELLED
}

/**
 * 订单状态变更 → 短信（第 55 轮）
 *
 * 只发**收件人真正关心**的几档：发货 / 送达 / 取消。
 * 中间状态（paid 等）不发 —— 那是系统内部状态，用户不需要知道。
 *
 * 两道闸（都在 smsService 里）：
 *   - 业务短信总开关 + 事件白名单（运营可调）
 *   - 同号码同模板的冷却（订单状态连跳时不刷屏、也不烧钱）
 *
 * 失败**不影响**业务：sendSms 内部吞异常并留痕。
 */
async function sendOrderStatusSms (orderId, status) {
  try {
    const event = ORDER_SMS_EVENT_BY_STATUS[status]
    if (!event) return

    // 通道没配 → 一条也发不出去，连策略都不用读（省一次查询）
    if (!isSmsChannelConfigured()) return

    const { enabled, events } = await getBusinessSmsPolicy()
    if (!enabled || !events.includes(event)) return

    const order = await Order.findByPk(orderId, {
      attributes: ['id', 'order_no', 'contact_name', 'contact_phone', 'tracking_number'],
      paranoid: false
    })
    if (!order || !order.contact_phone) return

    await sendSms({
      phone: order.contact_phone,
      template: event,
      // dedupeKey = 订单号：同一订单的重复事件被冷却挡，
      // 不同订单（哪怕同一号码、5 分钟内先后发货）互不影响。
      dedupeKey: order.order_no,
      vars: {
        order_no: order.order_no,
        contact_name: order.contact_name || '',
        tracking_number: order.tracking_number || ''
      }
    })
  } catch (error) {
    // 双保险：sendSms 内部已吞过一次，这里再兜一层
    logger.error('发订单状态短信失败（不影响业务）', { orderId, status, err: error?.message })
  }
}

/**
 * 批量订单状态变更 → 短信（第 55 轮）
 *
 * 一次查完所有订单（不是逐单查）—— 与站内通知的批量路径同一口径。
 * 调用方把已查到的订单传进来时直接复用，不再查第二次。
 */
async function sendOrderStatusSmsBatch (orderIds, status, orders = null) {
  try {
    const event = ORDER_SMS_EVENT_BY_STATUS[status]
    if (!event) return

    const ids = (orderIds || []).map(Number).filter(Number.isInteger)
    if (!ids.length) return

    // 通道没配 → 一条也发不出去，连策略都不用读（省一次查询）
    if (!isSmsChannelConfigured()) return

    const { enabled, events } = await getBusinessSmsPolicy()
    if (!enabled || !events.includes(event)) return

    // 调用方传了订单就直接复用（站内通知刚查过同一批）——
    // 批量操作的查询数有门禁，每条查询都要有理由。
    const list = Array.isArray(orders) && orders.length
      ? orders
      : await Order.findAll({
        where: { id: { [Op.in]: ids } },
        attributes: ['id', 'order_no', 'contact_name', 'contact_phone', 'tracking_number'],
        paranoid: false
      })

    for (const order of list) {
      if (!order.contact_phone) continue
      await sendSms({
        phone: order.contact_phone,
        template: event,
        dedupeKey: order.order_no,
        vars: {
          order_no: order.order_no,
          contact_name: order.contact_name || '',
          tracking_number: order.tracking_number || ''
        }
      })
    }
  } catch (error) {
    logger.error('批量发订单状态短信失败（不影响业务）', { count: orderIds?.length, status, err: error?.message })
  }
}

/**
 * 批量订单状态变更 → 站内通知（第 54 轮）
 *
 * 一次查询拿全部订单，再批量写通知 —— 逐单查会让查询数随订单数线性膨胀。
 */
async function notifyOrderStatusChangedBatch (orderIds, status) {
  try {
    const ids = (orderIds || []).map(Number).filter(Number.isInteger)
    if (!ids.length) return null

    const NOTIFIABLE = new Set(['shipping', 'shipped', 'delivered', 'completed', 'cancelled'])
    if (!NOTIFIABLE.has(status)) return null

    // 一次查完（不是 N 次）
    const orders = await Order.findAll({
      where: { id: { [Op.in]: ids } },
      // 多取两列：短信那边要收件人姓名与手机号，复用同一批数据
      attributes: ['id', 'order_no', 'user_id', 'total_amount_thb', 'tracking_number', 'contact_name', 'contact_phone'],
      paranoid: false
    })

    // 短信那边复用这份订单（省一次查询）
    await notifyUsers({
      userIds: orders.map((o) => o.user_id).filter(Boolean),
      type: 'order_status',
      data: {
        order_no: orders[0]?.order_no || '',
        status,
        amount: Number(orders[0]?.total_amount_thb) || 0,
        currency: 'THB'
      },
      link: orders[0] ? `/portal/orders/${orders[0].id}` : null
    })

    // 把查到的订单交回去：短信那边复用，省一次查询
    return { orders }
  } catch (error) {
    logger.error('批量发订单状态通知失败（不影响业务）', { count: orderIds?.length, status, err: error?.message })
    return null
  }
}

/**
 * 订单状态变更 → 站内通知（第 54 轮）
 *
 * 为什么单独抽出来：单条改状态与批量改状态都要发，抽出来避免两处逻辑漂移。
 *
 * 只通知**对用户有意义**的状态变化（发货/送达/完成/取消），
 * 其余中间状态不发，避免通知变成噪音。
 *
 * 注意：**用户自己取消订单**（cancelOrder）不发通知 —— 他刚点的取消，
 * 再弹一条"您的订单已取消"只是噪音。删单（deleteOrder）同样不发。
 *
 * 失败不影响业务：notifyUser 内部吞异常（best-effort）。
 */
async function notifyOrderStatusChanged (orderId, status) {
  try {
    const NOTIFIABLE = new Set(['shipping', 'shipped', 'delivered', 'completed', 'cancelled'])
    if (!NOTIFIABLE.has(status)) return

    const order = await Order.findByPk(orderId, {
      attributes: ['id', 'order_no', 'user_id', 'status', 'total_amount_thb', 'tracking_number'],
      paranoid: false
    })
    if (!order || !order.user_id) return

    await notifyUser({
      userId: order.user_id,
      type: 'order_status',
      data: {
        order_no: order.order_no,
        status,
        tracking_number: order.tracking_number || null,
        amount: Number(order.total_amount_thb) || 0,
        currency: 'THB'
      },
      link: `/portal/orders/${order.id}`
    })
  } catch (error) {
    logger.error('发订单状态通知失败（不影响业务）', { orderId, status, err: error?.message })
  }
}

export default OrderController