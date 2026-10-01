/**
 * 计价引擎（P1 营销体系 + P2 抵扣券 + P3 买多赠一 + P4 组合包）：订单金额计算的唯一收口
 *
 * 分层（全部在 THB 底价域计算，round2 收口，换汇由调用方在最后一步做）：
 *   第 0 层 组合包展开（P4）：bundle 项展开为组件行（行数量 = 配比 × 组合包数量），
 *          组合价按权重分摊到行（权重 = 组件直降后单价 × 配比；全 0 权重均分，尾差归首行），
 *          展开行带 bundle_id / bundle_name 标记，之后与单品行走完全相同的满减/券/赠品层
 *   第 1 层 行价：unit = round2(price × (1 - discount/100))，line_total = round2(unit × qty)；
 *          组合包展开行行价 = 分摊结果（unit_price 仅展示，line_total 为权威值）
 *   第 1.5 层 买赠（P3）：active 且时间窗内的 buy_x_get_y 促销，按 scope 内行数量合计
 *          算赠品（times = floor(eligibleQty / buy)，giftQty = times × get），只产出 gifts
 *          清单、不影响任何金额；多条规则各自基于原始购买数量独立生效（不级联）；
 *          赠品商品不存在/已下架 → 该条规则跳过并记 warn
 *   第 2 层 满减：active 且时间窗内的 threshold 促销，按 scope 过滤行后命中档位，
 *          多条候选互斥只应用一条（priority 最高，平级取减免最大），按行小计占比分摊到行
 *   第 3 层 抵扣券（P2，可选）：与满减可叠加、先满减后券；从满减后应付中扣减，
 *          按行应付占比并入 discount_allocated（尾差归应付最大行）；
 *          门槛口径 = scope 内行 line_total（单品直降后、满减前）之和 >= min_spend
 *   积分预估：floor(折后实付 THB × points_earn_rate)；积分换购单不参与任何促销、不可用券、不发积分
 *
 * 纯函数式（除 DB 读取外无 HTTP 依赖），便于单测；业务校验失败抛带 status=400 的错误，
 * 由控制器翻译成 400 响应
 */

import { Op } from 'sequelize'
import Product from '../models/Product.js'
import Bundle from '../models/Bundle.js'
import BundleItem from '../models/BundleItem.js'
import Promotion from '../models/Promotion.js'
import SystemConfig from '../models/SystemConfig.js'
import { normalizeExchangeRates } from '../utils/exchangeRates.js'
import { logger } from '../utils/logger.js'

/** 金额统一舍入到分：+Number.EPSILON 消除 0.5 分位的浮点误差（如 1.005*100=100.499…） */
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** 积分获取比例默认值：每实付 100 泰铢发 1 积分（SystemConfig key points_earn_rate 可覆盖） */
export const DEFAULT_POINTS_EARN_RATE = 0.01

/**
 * 读取积分获取比例（SystemConfig points_earn_rate，字符串数字）；
 * 未配置 / 解析失败 / 负数一律回退默认值
 */
export async function getPointsEarnRate () {
  const raw = await SystemConfig.getConfig('points_earn_rate')
  const n = parseFloat(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_POINTS_EARN_RATE
  return n
}

/**
 * 按折后实付泰铢金额换算应发积分：floor(实付 × rate)
 * +1e-9 消除浮点贴边（如 0.01×300=2.9999999999999996 应发 3 而非 2）
 */
export function calcPointsEarn (payableThb, rate) {
  const base = Number(payableThb)
  const r = Number(rate)
  if (!Number.isFinite(base) || base <= 0) return 0
  if (!Number.isFinite(r) || r < 0) return 0
  return Math.floor(base * r + 1e-9)
}

/**
 * 读取多币种汇算比例（createOrder / quote 共用）：
 * exchange_rates（json）优先；缺失时回退旧 exchange_rate 单值视作 USD，其余币种 0
 */
export async function loadNormalizedExchangeRates () {
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
  return normalizeExchangeRates(xrJson)
}

/** 业务校验错误：带 status=400，控制器据此返回 400 而非 500 */
function businessError (message) {
  const err = new Error(message)
  err.status = 400
  return err
}

/**
 * 订单计价
 * @param {{ items: Array<{ product_id?: number, bundle_id?: number, quantity: number }>, paymentMethod?: string, now?: Date, userCoupon?: object }} param0
 *   items 每行 product_id（单品）与 bundle_id（P4 组合包）二选一（路由层 joi xor 已校验）；
 *   userCoupon（P2 可选）：调用方查好并校验归属后的 UserCoupon 实例（须 include as:'template' 的模板），
 *   引擎只校验可用性（状态/有效期/scope 门槛），不做归属判断
 * @returns {Promise<{
 *   lines: Array<{ product_id, quantity, unit_price, original_price, discount, line_total, discount_allocated, line_payable, bundle_id?, bundle_name? }>,
 *   items_total: number, discount_amount: number, payable_thb: number,
 *   applied_promotions: Array<{ promotion_id, name, amount }>,
 *   applied_coupon: { user_coupon_id, name, amount } | null, points_estimate: number,
 *   gifts: Array<{ product_id, name, quantity, promotion_id, promotion_name }>
 * }>}
 *   lines 顺序与入参 items 严格一致（组合包项原地展开为多条组件行，调用方按下标/展开行对齐）；
 *   gifts（P3 买多赠一）：赠品不参与金额/分摊，下单时由控制器落成 price=0 的赠品行并并入库存扣减
 */
export async function priceOrder ({ items, paymentMethod = 'cod', now = new Date(), userCoupon = null }) {
  /**
   * 第 0 层（P4 组合包展开）：bundle 项 → 组件行，组合价按权重分摊：
   *   行数量 = 组件配比 × 组合包数量；行 line_total = round2(组合价合计 × 权重占比)，
   *   权重 = 组件单品直降后单价 × 配比数量（组合包数量是公因子，不影响比例），尾差归权重最大行；
   *   全部组件直降价为 0（权重和为 0）时均分，尾差归首行；
   *   行 unit_price = round2(line_total / 行数量) 仅供展示，line_total 为权威值（参与后续所有层）；
   *   组件商品在展开时校验存在且在售（软删组件 include 后为 null）；
   *   积分换购单不支持组合包（控制器已前置拦截，此处兜底）
   */
  const bundleIds = [...new Set(items.filter(it => it.bundle_id != null).map(it => Number(it.bundle_id)))]
  if (bundleIds.length > 0 && paymentMethod === 'points') {
    throw businessError('积分换购订单不支持组合包')
  }

  const workItems = []
  if (bundleIds.length > 0) {
    const bundles = await Bundle.findAll({
      where: { id: bundleIds },
      include: [{
        model: BundleItem,
        as: 'items',
        include: [{ model: Product, as: 'product' }]
      }]
    })
    const bundleMap = new Map(bundles.map(b => [b.id, b]))

    for (const item of items) {
      if (item.bundle_id == null) {
        workItems.push({ product_id: item.product_id, quantity: item.quantity })
        continue
      }
      const bundle = bundleMap.get(Number(item.bundle_id))
      if (!bundle) {
        throw businessError(`组合包ID ${item.bundle_id} 不存在`)
      }
      if (bundle.status !== 'active') {
        throw businessError(`组合包 ${bundle.name} 已下架，无法购买`)
      }
      const bundleQty = parseInt(item.quantity, 10)
      if (!Number.isInteger(bundleQty) || bundleQty < 1 || bundleQty > 5000) {
        throw businessError(`组合包 ${bundle.name} 数量无效（需为 1-5000 的整数）`)
      }
      const components = Array.isArray(bundle.items) ? bundle.items : []
      if (components.length === 0) {
        throw businessError(`组合包 ${bundle.name} 没有组件商品，无法购买`)
      }
      for (const comp of components) {
        if (!comp.product) {
          throw businessError(`商品ID ${comp.product_id} 不存在`)
        }
        if (comp.product.status !== 'active') {
          throw businessError(`商品 ${comp.product.name} 已下架，无法购买`)
        }
      }

      // 权重 = 组件直降后单价 × 配比数量（单品直降口径与第 1 层一致）
      const weights = components.map(comp => {
        const p = comp.product
        let wUnit = round2(p.price)
        if (p.discount && p.discount > 0) {
          wUnit = round2(Number(p.price) * (1 - p.discount / 100))
        }
        return round2(wUnit * comp.quantity)
      })
      const weightSum = round2(weights.reduce((s, w) => s + w, 0))
      const bundleTotal = round2(Number(bundle.price) * bundleQty)

      const shares = []
      if (weightSum > 0) {
        let allocatedSum = 0
        let maxIdx = 0
        for (let i = 0; i < components.length; i++) {
          const share = round2(bundleTotal * weights[i] / weightSum)
          shares.push(share)
          allocatedSum = round2(allocatedSum + share)
          if (weights[i] > weights[maxIdx]) maxIdx = i
        }
        const tail = round2(bundleTotal - allocatedSum)
        if (tail !== 0) shares[maxIdx] = round2(shares[maxIdx] + tail)
      } else {
        // 全 0 权重（组件直降价全为 0）：均分，尾差归首行
        const each = round2(bundleTotal / components.length)
        for (let i = 0; i < components.length; i++) shares.push(each)
        const tail = round2(bundleTotal - round2(each * components.length))
        if (tail !== 0) shares[0] = round2(shares[0] + tail)
      }

      for (let i = 0; i < components.length; i++) {
        const lineQty = components[i].quantity * bundleQty
        workItems.push({
          product_id: components[i].product_id,
          quantity: lineQty,
          _bundle: {
            bundle_id: bundle.id,
            bundle_name: bundle.name,
            line_total: shares[i],
            unit_price: round2(shares[i] / lineQty)
          }
        })
      }
    }
  } else {
    for (const item of items) {
      workItems.push({ product_id: item.product_id, quantity: item.quantity })
    }
  }

  // 下单只许 active 在售商品：软删商品（paranoid 默认过滤）视为不存在，直接拦截
  const productIds = workItems.map(item => item.product_id)
  const products = await Product.findAll({ where: { id: productIds } })
  const productMap = new Map(products.map(p => [p.id, p]))

  // 第 1 层：行价（商品折扣）+ 行小计；lines 顺序与入参 items 展开序严格一致（调用方按展开行对齐）
  const lines = []
  for (const item of workItems) {
    const product = productMap.get(item.product_id)
    if (!product) {
      throw businessError(`商品ID ${item.product_id} 不存在`)
    }
    if (product.status !== 'active') {
      throw businessError(`商品 ${product.name} 已下架，无法购买`)
    }
    const qty = parseInt(item.quantity, 10)
    if (!Number.isInteger(qty) || qty < 1 || qty > 5000) {
      throw businessError(`商品 ${product.name} 数量无效（需为 1-5000 的整数）`)
    }

    // 组合包展开行（P4）：行价 = 第 0 层分摊结果（unit_price 仅展示，line_total 为权威值）；
    // 单品直降不再叠加（分摊权重已按直降价计），discount 置 null；scope 匹配用组件商品自身
    if (item._bundle) {
      lines.push({
        product_id: item.product_id,
        quantity: qty,
        unit_price: item._bundle.unit_price,
        original_price: round2(product.price),
        discount: null,
        line_total: item._bundle.line_total,
        discount_allocated: 0,
        line_payable: item._bundle.line_total,
        bundle_id: item._bundle.bundle_id,
        bundle_name: item._bundle.bundle_name,
        // 内部字段：满减 scope=category 匹配用，输出前剔除
        _category_id: product.category_id ?? null
      })
      continue
    }

    let unitPrice = round2(product.price)
    if (product.discount && product.discount > 0) {
      unitPrice = round2(Number(product.price) * (1 - product.discount / 100))
    }
    const lineTotal = round2(unitPrice * qty)
    lines.push({
      product_id: item.product_id,
      quantity: qty,
      unit_price: unitPrice,
      original_price: round2(product.price),
      discount: product.discount ?? null,
      line_total: lineTotal,
      discount_allocated: 0,
      line_payable: lineTotal,
      // 内部字段：满减 scope=category 匹配用，输出前剔除
      _category_id: product.category_id ?? null
    })
  }
  const itemsTotal = round2(lines.reduce((s, l) => s + l.line_total, 0))

  /**
   * 促销一次性加载（第 1.5 层买赠 + 第 2 层满减共用）：
   * 原来两层各自查询 promotions 表，现合并为一次 type IN 查询后按 type 内存分派；
   * 统一按 id ASC 排序——买赠原查询即为 id ASC；满减原查询未指定排序，
   * 合并后 priority 与减免额完全相同的平级场景取 id 较小者，结果更确定
   */
  let buyGetPromotions = []
  let thresholdPromotions = []
  if (paymentMethod !== 'points') {
    const activePromotions = await Promotion.findAll({
      where: {
        status: 'active',
        type: { [Op.in]: ['buy_x_get_y', 'threshold'] },
        [Op.and]: [
          { [Op.or]: [{ start_at: null }, { start_at: { [Op.lte]: now } }] },
          { [Op.or]: [{ end_at: null }, { end_at: { [Op.gte]: now } }] }
        ]
      },
      order: [['id', 'ASC']]
    })
    for (const promo of activePromotions) {
      if (promo.type === 'buy_x_get_y') buyGetPromotions.push(promo)
      else if (promo.type === 'threshold') thresholdPromotions.push(promo)
    }
  }

  /**
   * 第 1.5 层：买多赠一（buy_x_get_y，P3）——只产出赠品清单，不动任何金额与行分摊：
   * scope 内行购买数量合计 eligibleQty，times = floor(eligibleQty / buy)，赠品数 = times × get；
   * 赠品商品 = rules.gift_product_id（未指定时仅当 scope 恰为单商品默认赠同品——admin 校验已拦截
   *   其余组合，此处兜底跳过并记 warn）；
   * 多条买赠规则各自基于原始购买数量独立生效（赠品不回灌 eligibleQty，不级联）；
   * 赠品商品必须存在且 active，否则该条规则跳过并记 warn（不阻断下单主流程）；
   * 积分换购单不参与任何促销，整层跳过
   */
  const gifts = []
  if (paymentMethod !== 'points') {
    // 买赠清单来自上方合并查询的 type 分派结果，不再单独查库
    // 先解析每条规则的赠品商品与数量，再一次性加载订单行之外的赠品商品（避免 N+1）
    const candidates = []
    const giftIdsToLoad = new Set()
    for (const promo of buyGetPromotions) {
      const rules = promo.rules && typeof promo.rules === 'object' ? promo.rules : {}
      const buy = Number(rules.buy)
      const get = Number(rules.get)
      if (!Number.isInteger(buy) || buy < 1 || !Number.isInteger(get) || get < 1) {
        logger.warn('买赠促销 rules.buy/get 非法，该条规则跳过', { promotionId: promo.id })
        continue
      }
      const scope = promo.scope && typeof promo.scope === 'object' ? promo.scope : { type: 'all' }
      const scopeIds = Array.isArray(scope.ids) ? scope.ids.map(Number) : []

      // 赠品商品：显式 gift_product_id 优先；未指定时仅当 scope 恰为单商品默认赠同品
      let giftProductId = rules.gift_product_id != null ? Number(rules.gift_product_id) : null
      if (!Number.isInteger(giftProductId) || giftProductId < 1) giftProductId = null
      if (giftProductId == null) {
        if (scope.type === 'product' && scopeIds.length === 1) {
          giftProductId = scopeIds[0]
        } else {
          logger.warn('买赠促销未指定赠品商品且范围非单商品，该条规则跳过', { promotionId: promo.id })
          continue
        }
      }

      // eligibleQty = scope 内行购买数量合计（原始购买数量，不含赠品）
      const eligibleQty = lines
        .filter(line => {
          if (scope.type === 'category') return line._category_id != null && scopeIds.includes(Number(line._category_id))
          if (scope.type === 'product') return scopeIds.includes(Number(line.product_id))
          return true
        })
        .reduce((s, l) => s + l.quantity, 0)
      const giftQty = Math.floor(eligibleQty / buy) * get
      if (giftQty < 1) continue

      candidates.push({ promo, giftProductId, giftQty })
      if (!productMap.has(giftProductId)) giftIdsToLoad.add(giftProductId)
    }

    // 订单行里没有的赠品商品批量加载（软删商品被 paranoid 默认过滤，视为不存在）
    const giftProductMap = new Map()
    if (giftIdsToLoad.size > 0) {
      const giftProducts = await Product.findAll({ where: { id: [...giftIdsToLoad] } })
      for (const gp of giftProducts) giftProductMap.set(gp.id, gp)
    }

    for (const { promo, giftProductId, giftQty } of candidates) {
      // 订单行内商品在第 1 层已校验存在且 active，可直接用；行外赠品商品以刚加载的为准
      const giftProduct = productMap.get(giftProductId) || giftProductMap.get(giftProductId)
      if (!giftProduct || giftProduct.status !== 'active') {
        logger.warn('买赠赠品商品不存在或已下架，该条规则跳过', { promotionId: promo.id, giftProductId })
        continue
      }
      gifts.push({
        product_id: giftProduct.id,
        name: giftProduct.name,
        quantity: giftQty,
        promotion_id: promo.id,
        promotion_name: promo.name
      })
    }
  }

  // 第 2 层：满减（积分换购单不参与任何促销，整层跳过）
  let discountAmount = 0
  const appliedPromotions = []
  if (paymentMethod !== 'points' && itemsTotal > 0) {
    // 满减清单来自上方合并查询的 type 分派结果，不再单独查库
    // 每条候选独立计算 eligible 与命中档；最终只应用一条（priority 最高，平级 off 最大）
    let best = null
    for (const promo of thresholdPromotions) {
      const tiers = Array.isArray(promo.rules?.tiers) ? promo.rules.tiers : []
      if (tiers.length === 0) continue
      const scope = promo.scope && typeof promo.scope === 'object' ? promo.scope : { type: 'all' }
      const scopeIds = Array.isArray(scope.ids) ? scope.ids.map(Number) : []
      const eligibleLines = lines.filter(line => {
        if (scope.type === 'category') return line._category_id != null && scopeIds.includes(Number(line._category_id))
        if (scope.type === 'product') return scopeIds.includes(Number(line.product_id))
        return true
      })
      const eligible = round2(eligibleLines.reduce((s, l) => s + l.line_total, 0))
      if (eligible <= 0) continue
      // tiers 按 min 降序取首个 eligible >= min 的档位
      const tier = [...tiers]
        .sort((a, b) => Number(b.min) - Number(a.min))
        .find(t => eligible >= Number(t.min))
      if (!tier) continue
      // 减免封顶不超过 eligible（不允许减成负数）
      const off = round2(Math.min(Number(tier.off), eligible))
      if (!(off > 0)) continue
      if (!best ||
        promo.priority > best.promotion.priority ||
        (promo.priority === best.promotion.priority && off > best.off)) {
        best = { promotion: promo, off, eligible, eligibleLines }
      }
    }

    if (best) {
      discountAmount = best.off
      appliedPromotions.push({
        promotion_id: best.promotion.id,
        name: best.promotion.name,
        amount: best.off
      })

      // 行分摊：按 eligible 行 line_total 占比 round2；尾差补给金额最大的行；范围外行为 0
      let allocatedSum = 0
      let maxLine = null
      for (const line of best.eligibleLines) {
        const share = round2(best.off * line.line_total / best.eligible)
        line.discount_allocated = share
        allocatedSum = round2(allocatedSum + share)
        if (!maxLine || line.line_total > maxLine.line_total) maxLine = line
      }
      const tail = round2(best.off - allocatedSum)
      if (tail !== 0 && maxLine) {
        maxLine.discount_allocated = round2(maxLine.discount_allocated + tail)
      }
    }
  }

  /**
   * 第 3 层：抵扣券（P2）——与满减可叠加，先满减后券。
   * 校验：status='unused'、expire_at 未过、scope 匹配、paymentMethod!=='points'（互斥，控制器已前置拦截，此处兜底）。
   * 门槛口径：scope 内行的 line_total 之和 >= min_spend——基于单品直降后（第 1 层行价）、
   *   满减前的行金额，与第 2 层满减 eligible 同口径；
   * 扣减口径：券面额视为订单级优惠，couponOff = min(amount, 满减后应付)，封顶不扣成负数；
   *   分摊到全部行（scope 仅用于门槛判定，不限定分摊范围），按行当前应付占比并入
   *   discount_allocated，尾差归应付最大行；
   * 满减后应付已为 0 时券无可扣金额：不生效也不消费（applied_coupon 保持 null）
   */
  let appliedCoupon = null
  if (userCoupon) {
    if (paymentMethod === 'points') {
      throw businessError('积分换购订单不可使用抵扣券')
    }
    const template = userCoupon.template
    if (!template) {
      throw businessError('抵扣券模板不存在或已删除')
    }
    if (userCoupon.status !== 'unused') {
      throw businessError('抵扣券不可用或已被使用')
    }
    if (userCoupon.expire_at && new Date(userCoupon.expire_at) < now) {
      throw businessError('抵扣券已过期')
    }

    const scope = template.scope && typeof template.scope === 'object' ? template.scope : { type: 'all' }
    const scopeIds = Array.isArray(scope.ids) ? scope.ids.map(Number) : []
    const eligibleLines = lines.filter(line => {
      if (scope.type === 'category') return line._category_id != null && scopeIds.includes(Number(line._category_id))
      if (scope.type === 'product') return scopeIds.includes(Number(line.product_id))
      return true
    })
    const eligible = round2(eligibleLines.reduce((s, l) => s + l.line_total, 0))
    const minSpend = round2(Number(template.min_spend) || 0)
    if (eligible < minSpend) {
      throw businessError(`未达到抵扣券使用门槛（满 ${minSpend} 泰铢可用）`)
    }

    const payableAfterPromo = round2(itemsTotal - discountAmount)
    const couponOff = round2(Math.min(Number(template.amount), payableAfterPromo))
    if (couponOff > 0) {
      discountAmount = round2(discountAmount + couponOff)
      appliedCoupon = {
        user_coupon_id: userCoupon.id,
        name: template.name,
        amount: couponOff
      }

      // 行分摊：按各行满减后应付（line_total - 已分摊满减）占比；尾差归应付最大行；
      // share <= 行应付（couponOff <= payableAfterPromo），不会把任何一行摊成负数
      let allocatedSum = 0
      let maxLine = null
      let maxLineBase = -1
      for (const line of lines) {
        const lineBase = round2(line.line_total - line.discount_allocated)
        const share = round2(couponOff * lineBase / payableAfterPromo)
        line.discount_allocated = round2(line.discount_allocated + share)
        allocatedSum = round2(allocatedSum + share)
        if (lineBase > maxLineBase) {
          maxLineBase = lineBase
          maxLine = line
        }
      }
      const tail = round2(couponOff - allocatedSum)
      if (tail !== 0 && maxLine) {
        maxLine.discount_allocated = round2(maxLine.discount_allocated + tail)
      }
    }
  }

  // 行应付 = 行小计 - 行分摊（含满减与券）；剔除内部字段
  for (const line of lines) {
    line.line_payable = round2(line.line_total - line.discount_allocated)
    delete line._category_id
  }

  const payableThb = round2(itemsTotal - discountAmount)

  // 积分预估：按折后实付金额；积分换购单不发积分
  let pointsEstimate = 0
  if (paymentMethod !== 'points') {
    const rate = await getPointsEarnRate()
    pointsEstimate = calcPointsEarn(payableThb, rate)
  }

  return {
    lines,
    items_total: itemsTotal,
    discount_amount: discountAmount,
    payable_thb: payableThb,
    applied_promotions: appliedPromotions,
    applied_coupon: appliedCoupon,
    points_estimate: pointsEstimate,
    gifts
  }
}
