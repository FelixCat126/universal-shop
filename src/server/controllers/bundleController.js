import Bundle from '../models/Bundle.js'
import BundleItem from '../models/BundleItem.js'
import Product from '../models/Product.js'
import { logger } from '../utils/logger.js'

/** 金额统一舍入到分（与计价引擎同口径） */
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** 组件单品直降后单价（与计价引擎第 1 层口径一致） */
function discountedUnit (product) {
  let unit = round2(product.price)
  if (product.discount && product.discount > 0) {
    unit = round2(Number(product.price) * (1 - product.discount / 100))
  }
  return unit
}

/** 组件 include：公开接口只暴露必要字段 */
const ITEMS_INCLUDE = [{
  model: BundleItem,
  as: 'items',
  include: [{
    model: Product,
    as: 'product',
    attributes: ['id', 'name', 'name_th', 'price', 'discount', 'stock', 'status']
  }]
}]

/**
 * 组装组合包展示数据：
 *   items            = 组件商品名/直降后单价/配比数量（组件商品被软删时 include 为 null，按已下架计）
 *   standalone_total = Σ(组件直降后单价 × 配比数量)，供前端对比"单买合计 vs 组合价"
 *   available_stock  = min(floor(组件 stock / 配比数量))；组件下架/不存在按 0 计；空包为 0
 */
function decorateBundle (bundle) {
  const b = bundle.toJSON()
  let standaloneTotal = 0
  let availableStock = Infinity
  const items = (b.items || []).map(it => {
    const p = it.product
    const unit = p ? discountedUnit(p) : 0
    standaloneTotal = round2(standaloneTotal + round2(unit * it.quantity))
    const sellable = p && p.status === 'active' ? Math.floor(Number(p.stock) / it.quantity) : 0
    if (sellable < availableStock) availableStock = sellable
    return {
      product_id: it.product_id,
      quantity: it.quantity,
      product_name: p ? p.name : null,
      product_name_th: p ? p.name_th : null,
      unit_price: unit,
      product_status: p ? p.status : null
    }
  })
  if (items.length === 0) availableStock = 0
  return { ...b, items, standalone_total: standaloneTotal, available_stock: availableStock }
}

/** 固定组合包公开接口（P4）：只暴露 active 组合包 */
class BundleController {
  /** GET /api/bundles：active 列表（含组件明细、单买合计、可售套数） */
  static async list (req, res) {
    try {
      const bundles = await Bundle.findAll({
        where: { status: 'active' },
        include: ITEMS_INCLUDE,
        order: [['id', 'DESC']]
      })
      return res.json({ success: true, data: bundles.map(decorateBundle) })
    } catch (e) {
      logger.error('list public bundles', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '获取组合包列表失败' })
    }
  }

  /** GET /api/bundles/:id：详情（口径同列表）；id 非法 → 400，不存在/已停用 → 404 */
  static async detail (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的组合包 ID' })
      }
      const bundle = await Bundle.findByPk(id, { include: ITEMS_INCLUDE })
      if (!bundle || bundle.status !== 'active') {
        return res.status(404).json({ success: false, message: '组合包不存在或已下架' })
      }
      return res.json({ success: true, data: decorateBundle(bundle) })
    } catch (e) {
      logger.error('get public bundle detail', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '获取组合包详情失败' })
    }
  }
}

export default BundleController
