import { Op } from 'sequelize'
import sequelize from '../config/database.js'
import Partner from '../models/Partner.js'
import PartnerOrder from '../models/PartnerOrder.js'
import PartnerOrderItem from '../models/PartnerOrderItem.js'
import Product from '../models/Product.js'
import { parsePartnerAccountKind } from '../constants/partnerAccountKind.js'
import XLSX from 'xlsx'
import { logger } from '../utils/logger.js'
import { sanitizeCell } from '../utils/sanitizeCell.js'

// 单次导出行数安全上限（与 exportController 口径一致）；超出截断并在文件末尾追加说明行
const EXPORT_ROW_LIMIT = 50000

// 截断时在表格末尾追加一行说明（origin:-1 追加到最后一行之后）
const appendTruncationNote = (worksheet) => {
  XLSX.utils.sheet_add_aoa(
    worksheet,
    [[`数据量超过上限，仅导出前 ${EXPORT_ROW_LIMIT} 行（按创建时间倒序）`]],
    { origin: -1 }
  )
}

const PARTNER_ORDER_STATUS_ZH = {
  pending_payment: '待支付',
  submitted: '已提交',
  processing: '处理中',
  shipped: '已发货',
  settled: '已结算',
  cancelled: '已取消'
}

// 合作方订单状态机：settled / cancelled 为终态，不允许任何变更
const PARTNER_ORDER_STATUS_TRANSITIONS = {
  pending_payment: ['submitted', 'cancelled'],
  submitted: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['settled'],
  settled: [],
  cancelled: []
}

function formatDatetimeLocalDigits (input) {
  const d = input ? new Date(input) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function partnerOrderPhoneWithoutDuplicateName (contactName, contactPhone) {
  let p = contactPhone != null ? String(contactPhone).trim() : ''
  const n = contactName != null ? String(contactName).trim() : ''
  if (!p || !n) return p
  try {
    p = p.replace(new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`), '').trim()
  } catch {
    /* ignore invalid pattern */
  }
  return p
}

class PartnerAdminController {
  static async listPartners (req, res) {
    try {
      const rows = await Partner.findAll({
        order: [['created_at', 'DESC']],
        attributes: { exclude: ['password'] }
      })
      return res.json({ success: true, data: rows })
    } catch (e) {
      logger.error('PartnerAdminController.listPartners', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '读取合作方列表失败' })
    }
  }

  static async createPartner (req, res) {
    try {
      const login = req.body.login != null ? String(req.body.login).trim() : ''
      const password = req.body.password != null ? String(req.body.password) : ''
      const display_name = req.body.display_name != null ? String(req.body.display_name).trim() : ''
      const discount_percent = Number(req.body.discount_percent ?? 0)
      const is_active = req.body.is_active !== false
      const account_kind = parsePartnerAccountKind(req.body.account_kind)

      if (login.length < 2 || !password || password.length < 6) {
        return res.status(400).json({ success: false, message: '登录名不少于2字符，密码不少于6字符' })
      }

      if (!Number.isFinite(discount_percent)) {
        return res.status(400).json({ success: false, message: '折扣必须是有效数字（0-100）' })
      }

      const exists = await Partner.findOne({ where: { login } })
      if (exists) return res.status(400).json({ success: false, message: '登录名已存在' })

      const row = await Partner.create({
        login,
        password,
        display_name: display_name || null,
        account_kind,
        discount_percent: Math.min(100, Math.max(0, discount_percent)),
        is_active
      })

      return res.status(201).json({ success: true, data: row.toSafeJSON() })
    } catch (e) {
      logger.error('PartnerAdminController.createPartner', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '创建失败', error: e.message })
    }
  }

  static async updatePartner (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      const row = await Partner.findByPk(id)
      if (!row) return res.status(404).json({ success: false, message: '不存在' })

      if (req.body.display_name !== undefined) {
        row.display_name = String(req.body.display_name).trim() || null
      }
      if (req.body.discount_percent !== undefined) {
        const dp = Number(req.body.discount_percent)
        if (!Number.isFinite(dp)) {
          return res.status(400).json({ success: false, message: '折扣必须是有效数字（0-100）' })
        }
        row.discount_percent = Math.min(100, Math.max(0, dp))
      }
      if (req.body.account_kind !== undefined) {
        row.account_kind = parsePartnerAccountKind(req.body.account_kind)
      }
      if (req.body.is_active !== undefined) {
        row.is_active = Boolean(req.body.is_active)
      }

      await row.save()
      return res.json({ success: true, data: row.toSafeJSON() })
    } catch (e) {
      logger.error('PartnerAdminController.updatePartner', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '更新失败' })
    }
  }

  static async resetPartnerPassword (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      const pwd = req.body.password != null ? String(req.body.password) : ''
      if (pwd.length < 6) {
        return res.status(400).json({ success: false, message: '新密码不少于6字符' })
      }

      const row = await Partner.findByPk(id)
      if (!row) return res.status(404).json({ success: false, message: '不存在' })

      row.password = pwd
      await row.save()
      return res.json({ success: true, message: '密码已重置' })
    } catch (e) {
      logger.error('PartnerAdminController.resetPartnerPassword', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '重置失败' })
    }
  }

  static async deletePartner (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      const row = await Partner.findByPk(id)
      if (!row) return res.status(404).json({ success: false, message: '不存在' })

      await row.destroy()
      return res.json({ success: true, message: '已删除' })
    } catch (e) {
      logger.error('PartnerAdminController.deletePartner', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '删除失败；若有关联订单可先禁用账号' })
    }
  }

  static async listPartnerOrders (req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1)
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
      const partner_keyword = req.query.partner_keyword != null ? String(req.query.partner_keyword).trim() : ''
      const status = req.query.status != null ? String(req.query.status).trim() : ''
      const from = req.query.from != null ? String(req.query.from).trim() : ''
      const to = req.query.to != null ? String(req.query.to).trim() : ''

      const where = {}
      if (status) where.status = status

      if (from && to) {
        where.created_at = {
          [Op.between]: [new Date(`${from}T00:00:00.000Z`), new Date(`${to}T23:59:59.999Z`)]
        }
      }

      const partnerIncludeWhere =
        partner_keyword.length > 0
          ? {
              [Op.or]: [
                { login: { [Op.like]: `%${partner_keyword}%` } },
                { display_name: { [Op.like]: `%${partner_keyword}%` } }
              ]
            }
          : undefined

      const { count, rows } = await PartnerOrder.findAndCountAll({
        where,
        order: [['created_at', 'DESC']],
        limit: pageSize,
        offset: (page - 1) * pageSize,
        // 默认子查询模式：hasMany items 会让 JOIN 行膨胀，subQuery:false 时 LIMIT 作用在
        // 膨胀后的行上导致一页订单数少于 pageSize（分页错位）；子查询模式先对订单主表分页再回填关联
        distinct: true,
        include: [
          {
            model: Partner,
            as: 'partner',
            attributes: ['id', 'login', 'display_name', 'discount_percent', 'account_kind'],
            required: Boolean(partnerIncludeWhere),
            ...(partnerIncludeWhere ? { where: partnerIncludeWhere } : {})
          },
          { model: PartnerOrderItem, as: 'items' }
        ]
      })

      return res.json({
        success: true,
        data: {
          orders: rows,
          pagination: {
            total: count,
            page,
            pageSize,
            totalPages: Math.ceil(count / pageSize) || 1
          }
        }
      })
    } catch (e) {
      logger.error('PartnerAdminController.listPartnerOrders', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '读取合作方订单失败' })
    }
  }

  static async updatePartnerOrderStatus (req, res) {
    const transaction = await sequelize.transaction()
    try {
      const id = parseInt(req.params.id, 10)
      const status = req.body.status != null ? String(req.body.status).trim() : ''

      const allowed = Object.keys(PARTNER_ORDER_STATUS_TRANSITIONS)
      if (!allowed.includes(status)) {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: '无效状态' })
      }

      // 行锁防并发双转移
      const order = await PartnerOrder.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE
      })
      if (!order) {
        await transaction.rollback()
        return res.status(404).json({ success: false, message: '订单不存在' })
      }

      const fromStatus = order.status
      const allowedTargets = PARTNER_ORDER_STATUS_TRANSITIONS[fromStatus] || []
      if (!allowedTargets.includes(status)) {
        await transaction.rollback()
        return res.status(400).json({
          success: false,
          message: `订单状态不允许从「${PARTNER_ORDER_STATUS_ZH[fromStatus] || fromStatus}」变更为「${PARTNER_ORDER_STATUS_ZH[status] || status}」`
        })
      }

      // 进入 cancelled（原状态在此不可能是 cancelled，状态机已拦截）：同事务回补库存
      if (status === 'cancelled') {
        const items = await PartnerOrderItem.findAll({
          where: { partner_order_id: order.id },
          transaction
        })
        // 按 product_id 升序回补：与下单扣减/超时清扫的加锁顺序一致，消除 AB-BA 死锁
        items.sort((a, b) => a.product_id - b.product_id)
        for (const item of items) {
          const qty = parseInt(item.quantity, 10)
          if (!Number.isInteger(qty) || qty <= 0 || !item.product_id) continue
          await Product.update(
            { stock: sequelize.literal(`stock + ${qty}`) },
            { where: { id: item.product_id }, transaction }
          )
        }
      }

      order.status = status
      await order.save({ transaction })
      await transaction.commit()
      return res.json({ success: true, data: order })
    } catch (e) {
      await transaction.rollback()
      logger.error('PartnerAdminController.updatePartnerOrderStatus', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '更新失败' })
    }
  }

  static async exportPartnerOrders (req, res) {
    try {
      const partner_keyword = req.query.partner_keyword != null ? String(req.query.partner_keyword).trim() : ''
      const status = req.query.status != null ? String(req.query.status).trim() : ''
      const from = req.query.from != null ? String(req.query.from).trim() : ''
      const to = req.query.to != null ? String(req.query.to).trim() : ''

      const where = {}
      if (status) where.status = status
      if (from && to) {
        where.created_at = {
          [Op.between]: [new Date(`${from}T00:00:00.000Z`), new Date(`${to}T23:59:59.999Z`)]
        }
      }

      const partnerIncludeWhere =
        partner_keyword.length > 0
          ? {
              [Op.or]: [
                { login: { [Op.like]: `%${partner_keyword}%` } },
                { display_name: { [Op.like]: `%${partner_keyword}%` } }
              ]
            }
          : undefined

      // 多取 1 行用于判断是否截断（limit + hasMany items 默认走子查询，LIMIT 作用于订单主表）
      let orders = await PartnerOrder.findAll({
        where,
        order: [['created_at', 'DESC']],
        limit: EXPORT_ROW_LIMIT + 1,
        include: [
          {
            model: Partner,
            as: 'partner',
            attributes: ['login', 'display_name'],
            required: Boolean(partnerIncludeWhere),
            ...(partnerIncludeWhere ? { where: partnerIncludeWhere } : {})
          },
          { model: PartnerOrderItem, as: 'items' }
        ]
      })
      const ordersTruncated = orders.length > EXPORT_ROW_LIMIT
      if (ordersTruncated) orders = orders.slice(0, EXPORT_ROW_LIMIT)

      // 用户可控字符串字段统一过 sanitizeCell，防 Excel 公式注入
      const flat = []
      for (const o of orders) {
        const oj = o.toJSON()
        const partnerLogin = sanitizeCell(oj.partner?.login ?? '')
        const partnerName = sanitizeCell(oj.partner?.display_name ?? '')
        for (const it of oj.items || []) {
          flat.push({
            订单号: oj.order_no,
            合作方登录名: partnerLogin,
            合作方名称: partnerName,
            状态: PARTNER_ORDER_STATUS_ZH[oj.status] || oj.status,
            收货人: sanitizeCell(oj.contact_name ?? ''),
            收货电话: sanitizeCell(partnerOrderPhoneWithoutDuplicateName(oj.contact_name, oj.contact_phone)),
            送货地址: sanitizeCell((oj.delivery_address ?? '').replace(/\n/g, ' ')),
            订单总额THB: parseFloat(oj.total_amount_thb),
            商品ID: it.product_id,
            商品快照名: sanitizeCell(it.product_name_snapshot ?? ''),
            商品图片: sanitizeCell(it.product_image_snapshot ?? ''),
            数量: it.quantity,
            合作方折扣快照: parseFloat(it.partner_discount_percent_snapshot),
            零售价等价THB: parseFloat(it.base_unit_thb),
            单价THB: parseFloat(it.unit_price_thb),
            行小计THB: parseFloat(it.line_total_thb),
            备注: sanitizeCell(oj.notes ?? ''),
            下单时间: formatDatetimeLocalDigits(oj.created_at)
          })
        }
      }

      const workbook = XLSX.utils.book_new()
      const sheet = XLSX.utils.json_to_sheet(flat.length ? flat : [{}])
      if (ordersTruncated) appendTruncationNote(sheet)
      XLSX.utils.book_append_sheet(workbook, sheet, 'partner_orders')

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
      const fn = `合作方订货_${new Date().toISOString().split('T')[0]}.xlsx`

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fn)}`)
      res.send(buffer)
    } catch (e) {
      logger.error('PartnerAdminController.exportPartnerOrders', { err: e?.message, stack: e?.stack })
      res.status(500).json({ success: false, message: '导出失败', error: e.message })
    }
  }
}

export default PartnerAdminController
