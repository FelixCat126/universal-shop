import sequelize from '../config/database.js'
import Bundle from '../models/Bundle.js'
import BundleItem from '../models/BundleItem.js'
import Product from '../models/Product.js'
import { resolvePagination } from '../utils/pagination.js'
import { logger } from '../utils/logger.js'
import { clearResponseCache } from '../utils/responseCache.js'

/** 列表/详情统一的组件 include（含组件商品名/价/库存，供后台展示） */
const ITEMS_INCLUDE = [{
  model: BundleItem,
  as: 'items',
  include: [{
    model: Product,
    as: 'product',
    attributes: ['id', 'name', 'name_th', 'price', 'discount', 'stock']
  }]
}]

/**
 * 校验组件商品都存在（创建/更新共用）；返回不存在的 product_id 列表（空数组 = 全部存在）。
 * Product 是软删模型：paranoid 默认过滤，已软删商品视为不存在
 */
async function findMissingProductIds (items) {
  const ids = items.map(it => it.product_id)
  const products = await Product.findAll({ where: { id: ids }, attributes: ['id'] })
  const found = new Set(products.map(p => p.id))
  return ids.filter(id => !found.has(id))
}

/**
 * 固定组合包管理（P4）
 * 入参由路由层 joi（bundlePayloadSchema / bundleStatusSchema）校验；
 * 组件商品存在性在此查库校验（创建/更新时）
 */
class BundleAdminController {
  /** 后台：分页 + status 筛选；每条含 items 与组件商品名 */
  static async list (req, res) {
    try {
      const { page, pageSize, limit, offset } = resolvePagination(req.query, { maxPageSize: 100 })

      const where = {}
      if (['active', 'inactive'].includes(req.query.status)) {
        where.status = req.query.status
      }

      const { count, rows } = await Bundle.findAndCountAll({
        where,
        include: ITEMS_INCLUDE,
        limit,
        offset,
        // include 计数需 distinct，否则 count 被 JOIN 放大
        distinct: true,
        order: [['id', 'DESC']]
      })

      return res.json({
        success: true,
        data: {
          list: rows,
          total: count,
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize) || 0
        }
      })
    } catch (e) {
      logger.error('list bundles', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '获取组合包列表失败' })
    }
  }

  /** 创建：组合包与组件同事务，任一失败整体回滚 */
  static async create (req, res) {
    const transaction = await sequelize.transaction()
    try {
      const { name, name_th, description, price, image, status, items } = req.body

      const missing = await findMissingProductIds(items)
      if (missing.length > 0) {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: `组件商品不存在：ID ${missing.join(', ')}` })
      }

      const bundle = await Bundle.create({
        name,
        name_th: name_th || null,
        description: description || null,
        price,
        image: image || null,
        status
      }, { transaction })
      await BundleItem.bulkCreate(
        items.map(it => ({ bundle_id: bundle.id, product_id: it.product_id, quantity: it.quantity })),
        { transaction }
      )
      await transaction.commit()
      // 组合包变更后清 GET 响应缓存，公开列表/详情（15s 缓存）立即读到新数据
      clearResponseCache()

      const created = await Bundle.findByPk(bundle.id, { include: ITEMS_INCLUDE })
      return res.status(201).json({ success: true, data: created })
    } catch (e) {
      await transaction.rollback().catch(() => {})
      logger.error('create bundle', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '创建组合包失败' })
    }
  }

  /** 全量替换（与创建同校验）：组件先删后建，与包信息同一事务 */
  static async update (req, res) {
    const transaction = await sequelize.transaction()
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id < 1) {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: '无效的 ID' })
      }
      const bundle = await Bundle.findByPk(id, { transaction })
      if (!bundle) {
        await transaction.rollback()
        return res.status(404).json({ success: false, message: '组合包不存在' })
      }

      const { name, name_th, description, price, image, status, items } = req.body
      const missing = await findMissingProductIds(items)
      if (missing.length > 0) {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: `组件商品不存在：ID ${missing.join(', ')}` })
      }

      await bundle.update({
        name,
        name_th: name_th || null,
        description: description || null,
        price,
        image: image || null,
        status
      }, { transaction })
      await BundleItem.destroy({ where: { bundle_id: bundle.id }, transaction })
      await BundleItem.bulkCreate(
        items.map(it => ({ bundle_id: bundle.id, product_id: it.product_id, quantity: it.quantity })),
        { transaction }
      )
      await transaction.commit()
      // 组合包变更后清 GET 响应缓存
      clearResponseCache()

      const updated = await Bundle.findByPk(bundle.id, { include: ITEMS_INCLUDE })
      return res.json({ success: true, data: updated })
    } catch (e) {
      await transaction.rollback().catch(() => {})
      logger.error('update bundle', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '更新组合包失败' })
    }
  }

  static async updateStatus (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的 ID' })
      }
      const bundle = await Bundle.findByPk(id)
      if (!bundle) {
        return res.status(404).json({ success: false, message: '组合包不存在' })
      }
      await bundle.update({ status: req.body.status })
      // 上下架后清 GET 响应缓存，公开列表/详情立即反映状态
      clearResponseCache()
      return res.json({ success: true, data: bundle })
    } catch (e) {
      logger.error('update bundle status', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '更新组合包状态失败' })
    }
  }

  /** 硬删：组件行随包一起删除（同事务）；已下单订单的组件行有 bundle_id 快照，不受影响 */
  static async remove (req, res) {
    const transaction = await sequelize.transaction()
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id < 1) {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: '无效的 ID' })
      }
      const bundle = await Bundle.findByPk(id, { transaction })
      if (!bundle) {
        await transaction.rollback()
        return res.status(404).json({ success: false, message: '组合包不存在' })
      }
      await BundleItem.destroy({ where: { bundle_id: bundle.id }, transaction })
      await bundle.destroy({ transaction })
      await transaction.commit()
      // 删除后清 GET 响应缓存
      clearResponseCache()
      return res.json({ success: true, message: '已删除' })
    } catch (e) {
      await transaction.rollback().catch(() => {})
      logger.error('remove bundle', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '删除组合包失败' })
    }
  }
}

export default BundleAdminController
