import jwt from 'jsonwebtoken'
import { Op } from 'sequelize'
import sequelize from '../config/database.js'
import Partner from '../models/Partner.js'
import Product from '../models/Product.js'
import PartnerOrder from '../models/PartnerOrder.js'
import PartnerOrderItem from '../models/PartnerOrderItem.js'
import PartnerAddress from '../models/PartnerAddress.js'
import { JWT_SECRET } from '../config/jwtSecret.js'
import {
  partnerUnitPriceAfterDiscount,
  retailBaseUnitThb,
  validateMoqOrThrow
} from '../services/partnerPricingService.js'
import { getPartnerMoqFromDb } from '../utils/partnerMoq.js'
import {
  isPartnerAgent,
  PARTNER_AGENT_MAX_DISTINCT_PRODUCTS,
  PARTNER_AGENT_MOQ_MULTIPLIER,
  PARTNER_AGENT_MOQ_UNIT
} from '../constants/partnerAccountKind.js'

function genPartnerOrderNo () {
  const r = Math.floor(Math.random() * 9000) + 1000
  return `PW${Date.now()}${r}`
}

const ALLOW_PARTNER_PHONE_CC = new Set(['+86', '+66', '+60'])

function normalizePartnerPhoneCc (v) {
  const s = v != null ? String(v).trim() : ''
  return ALLOW_PARTNER_PHONE_CC.has(s) ? s : '+66'
}

function formatPartnerRecipientLine (addr) {
  if (!addr) return ''
  const cc = normalizePartnerPhoneCc(addr.phone_country_code)
  const num = addr.phone != null ? String(addr.phone).trim() : ''
  const phonePart = num ? `${cc} ${num}` : cc
  if (addr.recipient_name) return `${addr.recipient_name}  ${phonePart}`
  return phonePart
}

/** 订单 contact_phone 字段仅存号码；联系人单列 contact_name（地址块仍用 {@link formatPartnerRecipientLine}） */
function formatPartnerPhoneOnly (addr) {
  if (!addr) return ''
  const cc = normalizePartnerPhoneCc(addr.phone_country_code)
  const num = addr.phone != null ? String(addr.phone).trim() : ''
  return num ? `${cc} ${num}` : ''
}

function formatPartnerDeliveryBlock (addr) {
  if (!addr) return ''
  const rec = formatPartnerRecipientLine(addr)
  const geo = [addr.province, addr.city, addr.district].filter(Boolean).join(' ')
  const withZip = geo && addr.postal_code ? `${geo} ${addr.postal_code}` : (geo || (addr.postal_code || ''))
  const lines = [rec, withZip || null, addr.detail].filter(Boolean)
  return lines.join('\n')
}

/** 合并同一 SKU 多行（防重复提交），返回去重后的 [{ product_id, quantity }] */
function mergePartnerOrderLineItems (items) {
  const m = new Map()
  for (const raw of items || []) {
    const productId = parseInt(raw.product_id, 10)
    const qty = parseInt(raw.quantity, 10)
    if (!Number.isInteger(productId) || productId < 1) continue
    if (!Number.isInteger(qty) || qty < 1) continue
    m.set(productId, (m.get(productId) || 0) + qty)
  }
  return [...m.entries()].map(([product_id, quantity]) => ({ product_id, quantity }))
}

class PartnerPortalController {
  static async login (req, res) {
    try {
      const login = req.body.login != null ? String(req.body.login).trim() : ''
      const password = req.body.password != null ? String(req.body.password) : ''
      if (!login || !password) {
        return res.status(400).json({ success: false, message: '请输入登录名与密码' })
      }

      const partner = await Partner.findOne({ where: { login } })
      if (!partner || !partner.is_active) {
        return res.status(401).json({ success: false, message: '登录名或密码错误' })
      }
      const ok = await partner.validatePassword(password)
      if (!ok) {
        return res.status(401).json({ success: false, message: '登录名或密码错误' })
      }

      partner.last_login_at = new Date()
      await partner.save()

      const token = jwt.sign(
        { type: 'partner', partnerId: partner.id, login: partner.login },
        JWT_SECRET,
        { expiresIn: '14d' }
      )

      return res.json({
        success: true,
        message: '登录成功',
        data: {
          token,
          partner: partner.toSafeJSON()
        }
      })
    } catch (e) {
      console.error('PartnerPortalController.login:', e)
      return res.status(500).json({ success: false, message: '登录失败' })
    }
  }

  static async me (req, res) {
    try {
      const partner = req.partnerFull
      return res.json({
        success: true,
        data: {
          ...(partner?.toSafeJSON?.() ?? req.partner),
          discount_percent: parseFloat(partner?.discount_percent) || 0
        }
      })
    } catch (e) {
      console.error('PartnerPortalController.me:', e)
      return res.status(500).json({ success: false, message: '获取信息失败' })
    }
  }

  static async listProducts (req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1)
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
      const name = req.query.name != null ? String(req.query.name).trim() : ''
      const categoryIdRaw = req.query.category_id != null ? String(req.query.category_id).trim() : ''

      const attributes = [
        'id', 'name', 'alias', 'description', 'price', 'discount', 'image', 'status', 'stock'
      ]

      const discountPercent = req.partner.discount_percent

      const where = { status: 'active' }
      if (categoryIdRaw !== '') {
        const cid = parseInt(categoryIdRaw, 10)
        if (Number.isFinite(cid) && cid > 0) {
          where.category_id = cid
        }
      }
      if (name) {
        where[Op.or] = [
          { name: { [Op.like]: `%${name}%` } },
          { alias: { [Op.like]: `%${name}%` } }
        ]
      }

      const { count, rows } = await Product.findAndCountAll({
        where,
        paranoid: true,
        order: [['created_at', 'DESC']],
        limit: pageSize,
        offset: (page - 1) * pageSize,
        attributes
      })

      const agent = isPartnerAgent(req.partnerFull)
      const { moqUnit, moqMultiplier } = agent
        ? { moqUnit: PARTNER_AGENT_MOQ_UNIT, moqMultiplier: PARTNER_AGENT_MOQ_MULTIPLIER }
        : await getPartnerMoqFromDb()

      const products = rows.map((p) => {
        const j = p.toJSON()
        const base = retailBaseUnitThb(j)
        const partnerPrice = partnerUnitPriceAfterDiscount(j, discountPercent)
        return {
          id: j.id,
          name: j.name || '',
          description: j.description,
          image: j.image,
          status: j.status,
          retail_base_price_thb: base,
          unit_price_thb: partnerPrice,
          currency_code: 'THB',
          moq_unit: moqUnit,
          moq_multiplier: moqMultiplier,
          discount_percent_applied: discountPercent
        }
      })

      return res.json({
        success: true,
        data: {
          products,
          pagination: {
            total: count,
            page,
            pageSize,
            totalPages: Math.ceil(count / pageSize) || 1
          }
        }
      })
    } catch (e) {
      console.error('PartnerPortalController.listProducts:', e)
      return res.status(500).json({ success: false, message: '获取商品列表失败' })
    }
  }

  static async createOrder (req, res) {
    const transaction = await sequelize.transaction()
    try {
      const partnerRow = req.partnerFull
      const body = req.body || {}
      const itemsRaw = Array.isArray(body.items) ? body.items : []
      const mergedItems = mergePartnerOrderLineItems(itemsRaw)
      const notes = body.notes != null ? String(body.notes) : ''
      const partner_address_id = parseInt(body.partner_address_id, 10)

      const agent = isPartnerAgent(partnerRow)
      const moqResolved = agent
        ? { moqUnit: PARTNER_AGENT_MOQ_UNIT, moqMultiplier: PARTNER_AGENT_MOQ_MULTIPLIER }
        : await getPartnerMoqFromDb()
      const moqUnit = moqResolved.moqUnit
      const moqMultiplier = moqResolved.moqMultiplier

      if (!partner_address_id || partner_address_id < 1) {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: '请选择收货地址' })
      }

      const addrRow = await PartnerAddress.findOne({
        where: { id: partner_address_id, partner_id: partnerRow.id },
        transaction
      })
      if (!addrRow) {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: '收货地址不存在或不属于当前账号' })
      }

      const contact_name = addrRow.recipient_name
      const contact_phone = formatPartnerPhoneOnly(addrRow)
      const delivery_address = formatPartnerDeliveryBlock(addrRow)

      if (mergedItems.length === 0) {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: '订货明细不能为空或 SKU/数量无效' })
      }

      const discountPercent = parseFloat(partnerRow.discount_percent) || 0

      if (agent && mergedItems.length > PARTNER_AGENT_MAX_DISTINCT_PRODUCTS) {
        await transaction.rollback()
        return res.status(400).json({
          success: false,
          message: `代理账号每笔订单最多订购 ${PARTNER_AGENT_MAX_DISTINCT_PRODUCTS} 种不同商品`
        })
      }

      const ids = mergedItems.map((it) => it.product_id)
      const products = await Product.findAll({
        where: { id: { [Op.in]: ids }, status: 'active' },
        paranoid: true,
        transaction
      })
      const map = new Map(products.map((p) => [p.id, p]))

      let total = 0
      const lines = []

      for (const raw of mergedItems) {
        const productId = parseInt(raw.product_id, 10)
        const qty = parseInt(raw.quantity, 10)
        try {
          validateMoqOrThrow(qty, moqUnit, moqMultiplier)
        } catch (err) {
          await transaction.rollback()
          const code = err.status || 400
          return res.status(code).json({ success: false, message: err.message })
        }

        const product = map.get(productId)
        if (!product) {
          await transaction.rollback()
          return res.status(400).json({ success: false, message: `商品不存在或已下架: ${productId}` })
        }

        const pj = product.toJSON()
        const baseUnit = retailBaseUnitThb(pj)
        const unitPrice = partnerUnitPriceAfterDiscount(pj, discountPercent)
        const lineTotal = Math.round(unitPrice * qty * 100) / 100

        lines.push({
          product_id: productId,
          quantity: qty,
          base_unit_thb: baseUnit,
          unit_price_thb: unitPrice,
          line_total_thb: lineTotal,
          partner_discount_percent_snapshot: discountPercent,
          product_name_snapshot: pj.name || pj.alias || '',
          product_image_snapshot: pj.image || null
        })

        total = Math.round((total + lineTotal) * 100) / 100
      }

      let order_no = genPartnerOrderNo()
      let order
      let tries = 0
      while (tries < 5) {
        try {
          order = await PartnerOrder.create({
            partner_id: partnerRow.id,
            partner_address_id,
            order_no,
            currency_code: 'THB',
            total_amount_thb: total,
            status: agent ? 'pending_payment' : 'submitted',
            notes,
            contact_name,
            contact_phone,
            delivery_address
          }, { transaction })
          break
        } catch {
          tries++
          order_no = genPartnerOrderNo()
        }
      }
      if (!order) {
        await transaction.rollback()
        return res.status(500).json({ success: false, message: '生成订单号失败' })
      }

      for (const line of lines) {
        await PartnerOrderItem.create(
          {
            partner_order_id: order.id,
            ...line
          },
          { transaction }
        )
      }

      await transaction.commit()

      const full = await PartnerOrder.findByPk(order.id, {
        include: [{ model: PartnerOrderItem, as: 'items' }]
      })

      return res.status(201).json({
        success: true,
        message: '提交成功',
        data: full
      })
    } catch (e) {
      await transaction.rollback()
      console.error('PartnerPortalController.createOrder:', e)
      return res.status(500).json({ success: false, message: '提交订单失败', error: e.message })
    }
  }

  static async confirmPartnerOrderPayment (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (!id) return res.status(400).json({ success: false, message: '无效的订单 ID' })
      const order = await PartnerOrder.findOne({
        where: { id, partner_id: req.partner.id }
      })
      if (!order) return res.status(404).json({ success: false, message: '订单不存在' })
      if (order.status !== 'pending_payment') {
        return res.status(400).json({ success: false, message: '当前订单无需确认支付或已处理' })
      }
      await order.update({ status: 'submitted' })
      const full = await PartnerOrder.findByPk(order.id, {
        include: [{ model: PartnerOrderItem, as: 'items' }]
      })
      return res.json({ success: true, message: '支付已确认', data: full })
    } catch (e) {
      console.error('PartnerPortalController.confirmPartnerOrderPayment:', e)
      return res.status(500).json({ success: false, message: '确认支付失败' })
    }
  }

  static async listMyOrders (req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1)
      const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 5))

      let fromStr = req.query.from != null ? String(req.query.from).trim() : ''
      let toStr = req.query.to != null ? String(req.query.to).trim() : ''

      const pad2 = (n) => String(n).padStart(2, '0')
      /** 默认近三个月（按月减 3，与日历同日 UTC），时间与 admin 导出一致：日界按 UTC */
      if (!fromStr || !toStr) {
        const now = new Date()
        const y = now.getUTCFullYear()
        const m = now.getUTCMonth()
        const d = now.getUTCDate()
        const fromDate = new Date(Date.UTC(y, m - 3, d))
        fromStr = `${fromDate.getUTCFullYear()}-${pad2(fromDate.getUTCMonth() + 1)}-${pad2(fromDate.getUTCDate())}`
        toStr = `${y}-${pad2(m + 1)}-${pad2(d)}`
      }

      let start = new Date(`${fromStr}T00:00:00.000Z`)
      let end = new Date(`${toStr}T23:59:59.999Z`)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return res.status(400).json({ success: false, message: '日期格式无效，请使用 YYYY-MM-DD' })
      }
      if (start > end) [start, end] = [end, start]

      const where = {
        partner_id: req.partner.id,
        created_at: { [Op.between]: [start, end] }
      }

      const { count, rows } = await PartnerOrder.findAndCountAll({
        where,
        order: [['created_at', 'DESC']],
        limit: pageSize,
        offset: (page - 1) * pageSize,
        include: [{ model: PartnerOrderItem, as: 'items', required: false }]
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
      console.error('PartnerPortalController.listMyOrders:', e)
      return res.status(500).json({ success: false, message: '获取订单失败' })
    }
  }

  static async orderDetail (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (!id) return res.status(400).json({ success: false, message: '无效的订单 ID' })

      const order = await PartnerOrder.findOne({
        where: { id, partner_id: req.partner.id },
        include: [{ model: PartnerOrderItem, as: 'items' }]
      })
      if (!order) return res.status(404).json({ success: false, message: '订单不存在' })

      return res.json({ success: true, data: order })
    } catch (e) {
      console.error('PartnerPortalController.orderDetail:', e)
      return res.status(500).json({ success: false, message: '加载订单失败' })
    }
  }

  static async listAddresses (req, res) {
    try {
      const rows = await PartnerAddress.findAll({
        where: { partner_id: req.partner.id },
        order: [['is_default', 'DESC'], ['updated_at', 'DESC']]
      })
      return res.json({ success: true, data: rows })
    } catch (e) {
      console.error('PartnerPortalController.listAddresses:', e)
      return res.status(500).json({ success: false, message: '读取地址失败' })
    }
  }

  static async createAddress (req, res) {
    try {
      const partner_id = req.partner.id
      const body = req.body || {}
      const recipient_name = body.recipient_name != null ? String(body.recipient_name).trim() : ''
      const phone = body.phone != null ? String(body.phone).trim() : ''
      const detail = body.detail != null ? String(body.detail).trim() : ''
      if (!recipient_name || !phone || !detail) {
        return res.status(400).json({ success: false, message: '请填写收货人、电话与详细地址' })
      }
      const province = body.province != null ? String(body.province).trim() : ''
      const city = body.city != null ? String(body.city).trim() : ''
      const district = body.district != null ? String(body.district).trim() : ''
      const postal_code = body.postal_code != null ? String(body.postal_code).trim().slice(0, 10) : ''
      const label = body.label != null ? String(body.label).trim() : ''
      const phone_country_code = normalizePartnerPhoneCc(body.phone_country_code)

      const existing = await PartnerAddress.count({ where: { partner_id } })
      const wantDefault = body.is_default === true || body.is_default === 'true' || existing === 0

      if (wantDefault) {
        await PartnerAddress.update({ is_default: false }, { where: { partner_id } })
      }

      const row = await PartnerAddress.create({
        partner_id,
        recipient_name,
        phone,
        phone_country_code,
        province: province || null,
        city: city || null,
        district: district || null,
        postal_code: postal_code || null,
        detail,
        label: label || null,
        is_default: wantDefault
      })
      return res.status(201).json({ success: true, data: row })
    } catch (e) {
      console.error('PartnerPortalController.createAddress:', e)
      return res.status(500).json({ success: false, message: '保存地址失败' })
    }
  }

  static async updateAddress (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      const partner_id = req.partner.id
      const row = await PartnerAddress.findOne({ where: { id, partner_id } })
      if (!row) return res.status(404).json({ success: false, message: '地址不存在' })

      const body = req.body || {}
      if (body.recipient_name != null) row.recipient_name = String(body.recipient_name).trim()
      if (body.phone != null) row.phone = String(body.phone).trim()
      if (body.phone_country_code !== undefined) {
        row.phone_country_code = normalizePartnerPhoneCc(body.phone_country_code)
      }
      if (body.detail != null) row.detail = String(body.detail).trim()
      if (body.province !== undefined) row.province = body.province != null ? String(body.province).trim() : null
      if (body.city !== undefined) row.city = body.city != null ? String(body.city).trim() : null
      if (body.district !== undefined) row.district = body.district != null ? String(body.district).trim() : null
      if (body.postal_code !== undefined) {
        row.postal_code = body.postal_code != null ? String(body.postal_code).trim().slice(0, 10) : null
      }
      if (body.label !== undefined) row.label = body.label != null ? String(body.label).trim() : null

      if (!row.recipient_name || !row.phone || !row.detail) {
        return res.status(400).json({ success: false, message: '收货人、电话与详细地址不能为空' })
      }

      if (body.is_default === true || body.is_default === 'true') {
        await PartnerAddress.update({ is_default: false }, { where: { partner_id } })
        row.is_default = true
      }

      await row.save()
      return res.json({ success: true, data: row })
    } catch (e) {
      console.error('PartnerPortalController.updateAddress:', e)
      return res.status(500).json({ success: false, message: '更新地址失败' })
    }
  }

  static async deleteAddress (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      const partner_id = req.partner.id
      const row = await PartnerAddress.findOne({ where: { id, partner_id } })
      if (!row) return res.status(404).json({ success: false, message: '地址不存在' })
      const wasDefault = row.is_default
      await row.destroy()

      if (wasDefault) {
        const nextDef = await PartnerAddress.findOne({
          where: { partner_id },
          order: [['updated_at', 'DESC']]
        })
        if (nextDef) {
          nextDef.is_default = true
          await nextDef.save()
        }
      }

      return res.json({ success: true, message: '已删除' })
    } catch (e) {
      console.error('PartnerPortalController.deleteAddress:', e)
      return res.status(500).json({ success: false, message: '删除失败' })
    }
  }

  static async setDefaultAddress (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      const partner_id = req.partner.id
      const row = await PartnerAddress.findOne({ where: { id, partner_id } })
      if (!row) return res.status(404).json({ success: false, message: '地址不存在' })
      await PartnerAddress.update({ is_default: false }, { where: { partner_id } })
      row.is_default = true
      await row.save()
      return res.json({ success: true, data: row })
    } catch (e) {
      console.error('PartnerPortalController.setDefaultAddress:', e)
      return res.status(500).json({ success: false, message: '设置默认地址失败' })
    }
  }
}

export default PartnerPortalController
