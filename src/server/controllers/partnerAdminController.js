import { Op } from 'sequelize'
import Partner from '../models/Partner.js'
import PartnerOrder from '../models/PartnerOrder.js'
import PartnerOrderItem from '../models/PartnerOrderItem.js'
import { parsePartnerAccountKind } from '../constants/partnerAccountKind.js'
import XLSX from 'xlsx'
const PARTNER_ORDER_STATUS_ZH = {
  pending_payment: '待支付',
  submitted: '已提交',
  processing: '处理中',
  shipped: '已发货',
  settled: '已结算',
  cancelled: '已取消'
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
      console.error('PartnerAdminController.listPartners:', e)
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
      console.error('PartnerAdminController.createPartner:', e)
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
        row.discount_percent = Math.min(100, Math.max(0, Number(req.body.discount_percent) || 0))
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
      console.error('PartnerAdminController.updatePartner:', e)
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
      console.error('PartnerAdminController.resetPartnerPassword:', e)
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
      console.error('PartnerAdminController.deletePartner:', e)
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
        subQuery: false,
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
      console.error('PartnerAdminController.listPartnerOrders:', e)
      return res.status(500).json({ success: false, message: '读取合作方订单失败' })
    }
  }

  static async updatePartnerOrderStatus (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      const status = req.body.status != null ? String(req.body.status).trim() : ''

      const allowed = ['pending_payment', 'submitted', 'processing', 'shipped', 'settled', 'cancelled']
      if (!allowed.includes(status)) {
        return res.status(400).json({ success: false, message: '无效状态' })
      }

      const order = await PartnerOrder.findByPk(id)
      if (!order) return res.status(404).json({ success: false, message: '订单不存在' })

      order.status = status
      await order.save()
      return res.json({ success: true, data: order })
    } catch (e) {
      console.error('PartnerAdminController.updatePartnerOrderStatus:', e)
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

      const orders = await PartnerOrder.findAll({
        where,
        order: [['created_at', 'DESC']],
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

      const flat = []
      for (const o of orders) {
        const oj = o.toJSON()
        const partnerLogin = oj.partner?.login ?? ''
        const partnerName = oj.partner?.display_name ?? ''
        for (const it of oj.items || []) {
          flat.push({
            订单号: oj.order_no,
            合作方登录名: partnerLogin,
            合作方名称: partnerName,
            状态: PARTNER_ORDER_STATUS_ZH[oj.status] || oj.status,
            收货人: oj.contact_name ?? '',
            收货电话: partnerOrderPhoneWithoutDuplicateName(oj.contact_name, oj.contact_phone),
            送货地址: (oj.delivery_address ?? '').replace(/\n/g, ' '),
            订单总额THB: parseFloat(oj.total_amount_thb),
            商品ID: it.product_id,
            商品快照名: it.product_name_snapshot ?? '',
            商品图片: it.product_image_snapshot ?? '',
            数量: it.quantity,
            合作方折扣快照: parseFloat(it.partner_discount_percent_snapshot),
            零售价等价THB: parseFloat(it.base_unit_thb),
            单价THB: parseFloat(it.unit_price_thb),
            行小计THB: parseFloat(it.line_total_thb),
            备注: oj.notes ?? '',
            下单时间: formatDatetimeLocalDigits(oj.created_at)
          })
        }
      }

      const workbook = XLSX.utils.book_new()
      const sheet = XLSX.utils.json_to_sheet(flat.length ? flat : [{}])
      XLSX.utils.book_append_sheet(workbook, sheet, 'partner_orders')

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
      const fn = `合作方订货_${new Date().toISOString().split('T')[0]}.xlsx`

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fn)}`)
      res.send(buffer)
    } catch (e) {
      console.error('PartnerAdminController.exportPartnerOrders:', e)
      res.status(500).json({ success: false, message: '导出失败', error: e.message })
    }
  }
}

export default PartnerAdminController
