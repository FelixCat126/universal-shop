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
import { withDeadlockRetry } from '../utils/dbRetry.js'
import {
  isPartnerAgent,
  PARTNER_AGENT_MAX_DISTINCT_PRODUCTS,
  PARTNER_AGENT_MOQ_MULTIPLIER,
  PARTNER_AGENT_MOQ_UNIT
} from '../constants/partnerAccountKind.js'
import AuditLog from '../models/AuditLog.js'
import { recordLoginFailure, clearLoginFailures } from '../middlewares/loginGuard.js'
import { logger } from '../utils/logger.js'

function genPartnerOrderNo () {
  const r = Math.floor(Math.random() * 9000) + 1000
  return `PW${Date.now()}${r}`
}

/** PG 唯一约束违例判定（23505；Sequelize 包装或原始错误都认） */
function isUniqueViolation (err) {
  return err?.name === 'SequelizeUniqueConstraintError' ||
    err?.parent?.code === '23505' ||
    err?.original?.code === '23505'
}

/**
 * 区分 23505 的冲突来源是否为 order_no 列（而非 client_order_key 幂等索引）：
 * 优先看 Sequelize 解析出的冲突字段，退化到 PG 约束名（order_no 约束名形如
 * partner_orders_order_no_key；幂等部分索引名不含 "order_no" 子串）。
 */
function isOrderNoUniqueConflict (err) {
  const fields = err?.fields
  if (fields && typeof fields === 'object') {
    const keys = Array.isArray(fields) ? fields : Object.keys(fields)
    if (keys.length > 0) return keys.includes('order_no')
  }
  const constraint = String(err?.parent?.constraint || err?.original?.constraint || '')
  return constraint.includes('order_no')
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

/** 严格正整数解析：先 Number()，非整数或 <1 抛 400，不做 parseInt 式静默截断（如 3.7→3） */
function requirePositiveInt (value, label) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) {
    throw Object.assign(new Error(`${label}必须是不小于 1 的整数`), { status: 400 })
  }
  return n
}

/** 合并同一 SKU 多行（防重复提交），返回去重后的 [{ product_id, quantity }] */
function mergePartnerOrderLineItems (items) {
  const m = new Map()
  for (const raw of items || []) {
    const productId = requirePositiveInt(raw?.product_id, '商品 ID')
    const qty = requirePositiveInt(raw?.quantity, '商品数量')
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
        recordLoginFailure(req, login)
        AuditLog.logPartner({
          partner: partner || { id: null, code: login },
          event: 'partner.login.fail',
          success: false,
          detail: { reason: partner ? 'inactive' : 'not_found' },
          req
        }).catch(() => {})
        return res.status(401).json({ success: false, message: '登录名或密码错误' })
      }
      const ok = await partner.validatePassword(password)
      if (!ok) {
        recordLoginFailure(req, login)
        AuditLog.logPartner({
          partner,
          event: 'partner.login.fail',
          success: false,
          detail: { reason: 'bad_password' },
          req
        }).catch(() => {})
        return res.status(401).json({ success: false, message: '登录名或密码错误' })
      }

      partner.last_login_at = new Date()
      await partner.save()
      clearLoginFailures(req, login)

      const token = jwt.sign(
        { type: 'partner', partnerId: partner.id, login: partner.login },
        JWT_SECRET,
        { expiresIn: '14d' }
      )

      AuditLog.logPartner({ partner, event: 'partner.login.success', req }).catch(() => {})

      return res.json({
        success: true,
        message: '登录成功',
        data: {
          token,
          partner: partner.toSafeJSON()
        }
      })
    } catch (e) {
      logger.error('PartnerPortalController.login', { err: e?.message, stack: e?.stack })
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
      logger.error('PartnerPortalController.me', { err: e?.message, stack: e?.stack })
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
      logger.error('PartnerPortalController.listProducts', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '获取商品列表失败' })
    }
  }

  static async createOrder (req, res) {
    // —— 事务外：请求级解析（控制器自带整数防御，不依赖路由层 Joi）——
    const partnerRow = req.partnerFull
    const body = req.body || {}
    const itemsRaw = Array.isArray(body.items) ? body.items : []
    let mergedItems
    try {
      mergedItems = mergePartnerOrderLineItems(itemsRaw)
    } catch (e) {
      return res.status(e.status || 400).json({ success: false, message: e.message })
    }
    const notes = body.notes != null ? String(body.notes) : ''
    const partner_address_id = parseInt(body.partner_address_id, 10)

    /**
     * 客户端幂等键（可选）：超时重试带同一 key，撞 (partner_id, client_order_key)
     * 部分唯一索引时返回首个已建订单而非双单。列宽 64，超长直接 400。
     * 注意：路由层 Joi（validate.js createPartnerOrderSchema，stripUnknown）
     * 未声明该字段时会被裁剪，此处读不到即退化为无幂等（向后兼容）。
     */
    let clientOrderKey = null
    if (body.client_order_key != null && String(body.client_order_key).trim() !== '') {
      const k = String(body.client_order_key).trim()
      if (k.length > 64) {
        return res.status(400).json({ success: false, message: 'client_order_key 长度不能超过 64' })
      }
      clientOrderKey = k
    }

    const agent = isPartnerAgent(partnerRow)

    /**
     * 下单事务整体包 withDeadlockRetry：PG 40P01/40001 时重建事务重试。
     * fn 可重入（所有 DB 写都在事务内，重试从头再来）；业务校验失败返回
     * { ok:false, status, message } 不触发重试；res.json 等响应副作用一律在事务外。
     */
    let result
    try {
      const moqResolved = agent
        ? { moqUnit: PARTNER_AGENT_MOQ_UNIT, moqMultiplier: PARTNER_AGENT_MOQ_MULTIPLIER }
        : await getPartnerMoqFromDb()
      const moqUnit = moqResolved.moqUnit
      const moqMultiplier = moqResolved.moqMultiplier

      result = await withDeadlockRetry(async () => {
        const transaction = await sequelize.transaction()
        try {
          if (!partner_address_id || partner_address_id < 1) {
            await transaction.rollback()
            return { ok: false, status: 400, message: '请选择收货地址' }
          }

          const addrRow = await PartnerAddress.findOne({
            where: { id: partner_address_id, partner_id: partnerRow.id },
            transaction
          })
          if (!addrRow) {
            await transaction.rollback()
            return { ok: false, status: 400, message: '收货地址不存在或不属于当前账号' }
          }

          const contact_name = addrRow.recipient_name
          const contact_phone = formatPartnerPhoneOnly(addrRow)
          const delivery_address = formatPartnerDeliveryBlock(addrRow)

          if (mergedItems.length === 0) {
            await transaction.rollback()
            return { ok: false, status: 400, message: '订货明细不能为空或 SKU/数量无效' }
          }

          const discountPercent = parseFloat(partnerRow.discount_percent) || 0

          if (agent && mergedItems.length > PARTNER_AGENT_MAX_DISTINCT_PRODUCTS) {
            await transaction.rollback()
            return {
              ok: false,
              status: 400,
              message: `代理账号每笔订单最多订购 ${PARTNER_AGENT_MAX_DISTINCT_PRODUCTS} 种不同商品`
            }
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
            // mergedItems 已经过严格正整数校验，直接使用，不再 parseInt 截断
            const productId = raw.product_id
            const qty = raw.quantity
            try {
              validateMoqOrThrow(qty, moqUnit, moqMultiplier)
            } catch (err) {
              await transaction.rollback()
              return { ok: false, status: err.status || 400, message: err.message }
            }

            const product = map.get(productId)
            if (!product) {
              await transaction.rollback()
              return { ok: false, status: 400, message: `商品不存在或已下架: ${productId}` }
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

          /**
           * 订单号唯一冲突重试（SAVEPOINT 版）：
           * PG 撞 23505 后整个事务进入 aborted 状态，直接在同事务重插只会再吃 25P02
           * （旧实现因此在 PG 下是死代码）。仿 pointsService.lockOrCreateBalance：
           * 每次插入包一层保存点，冲突只回滚到保存点、不污染外层事务，重生成单号再插。
           * 保存点内吞掉的 23505 不会外溢，withDeadlockRetry 只见 40P01/40001。
           */
          let order = null
          let tries = 0
          while (tries < 5 && !order) {
            const order_no = genPartnerOrderNo()
            const sp = await sequelize.transaction({ transaction })
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
                delivery_address,
                client_order_key: clientOrderKey
              }, { transaction: sp })
              await sp.commit()
            } catch (err) {
              await sp.rollback().catch(() => {})
              if (isUniqueViolation(err)) {
                if (isOrderNoUniqueConflict(err)) {
                  // 订单号撞库：重生成再插（最多 5 次）
                  tries++
                  continue
                }
                if (clientOrderKey) {
                  /**
                   * 幂等键冲突：同 (partner_id, client_order_key) 的订单已由先前请求建成。
                   * 整单回滚（含已扣库存），事务外按键查出已存在订单返回去重响应。
                   */
                  await transaction.rollback()
                  return { ok: true, deduplicated: true }
                }
              }
              // 死锁等其余错误上抛给 withDeadlockRetry 重建事务
              throw err
            }
          }
          if (!order) {
            await transaction.rollback()
            return { ok: false, status: 500, message: '生成订单号失败' }
          }

          /**
           * 防超卖：用条件 UPDATE 原子扣减 Product.stock，且仅在 stock>=qty 时生效
           * 之前的实现完全未扣库存（可永远超卖），本次一并修复。
           *
           * 锁顺序：扣减按 product_id 升序逐行加锁，与零售下单、取消/超时回补的
           * 加锁顺序保持一致，消除跨事务相反顺序拿锁导致的 AB-BA 死锁。
           * lines 本身保持请求行顺序用于落库/展示，这里用排序副本扣减。
           */
          const linesByProductId = [...lines].sort((a, b) => a.product_id - b.product_id)
          for (const line of linesByProductId) {
            const [affected] = await Product.update(
              { stock: sequelize.literal(`stock - ${line.quantity}`) },
              {
                where: {
                  id: line.product_id,
                  stock: { [Op.gte]: line.quantity }
                },
                transaction
              }
            )
            if (!affected) {
              await transaction.rollback()
              return {
                ok: false,
                status: 400,
                message: `商品库存不足（商品 ID ${line.product_id}）`
              }
            }
          }

          // 一次性写入订单明细
          const itemRows = lines.map((line) => ({ partner_order_id: order.id, ...line }))
          if (itemRows.length > 0) {
            await PartnerOrderItem.bulkCreate(itemRows, { transaction })
          }

          await transaction.commit()
          return { ok: true, order, lines }
        } catch (e) {
          await transaction.rollback().catch(() => {})
          throw e
        }
      })
    } catch (e) {
      logger.error('PartnerPortalController.createOrder', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '提交订单失败', error: e.message })
    }

    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message })
    }

    // 幂等键命中：先前请求已建成同 key 订单，直接查出返回（不重复扣库存/建行）
    if (result.deduplicated) {
      const existing = await PartnerOrder.findOne({
        where: { partner_id: partnerRow.id, client_order_key: clientOrderKey },
        include: [{ model: PartnerOrderItem, as: 'items' }]
      })
      if (!existing) {
        // 极端场景：唯一索引冲突来自尚未提交/已回滚的并发插入，行不可见——让客户端重试
        logger.error('PartnerPortalController.createOrder 幂等键冲突但未查到已存在订单', {
          partnerId: partnerRow.id
        })
        return res.status(409).json({ success: false, message: '重复提交检测异常，请重试' })
      }
      AuditLog.logPartner({
        partner: req.partnerFull || { id: req.partner?.partnerId },
        event: 'partner_order.create.idempotent_hit',
        resource: 'partner_order',
        resourceId: existing.id,
        detail: { client_order_key: clientOrderKey },
        req
      }).catch(() => {})
      return res.status(200).json({
        success: true,
        message: '提交成功',
        data: existing,
        deduplicated: true
      })
    }

    const { order, lines } = result

    const full = await PartnerOrder.findByPk(order.id, {
      include: [{ model: PartnerOrderItem, as: 'items' }]
    })

    AuditLog.logPartner({
      partner: req.partnerFull || { id: req.partner?.partnerId },
      event: 'partner_order.create',
      resource: 'partner_order',
      resourceId: order.id,
      detail: {
        payment_method: order.payment_method,
        item_count: lines.length,
        total_amount: order.total_amount
      },
      req
    }).catch(() => {})

    return res.status(201).json({
      success: true,
      message: '提交成功',
      data: full
    })
  }

  /**
   * 合作方支付确认幂等：条件 UPDATE 只在 status='pending_payment' 且 online_paid_at IS NULL 时生效；
   *   - online_paid_at 已置位（已确认过的并发/重放请求）：幂等返回最新数据，不重复变更状态；
   *   - 状态已被改走（如已取消）但从未支付：409 冲突，不允许再确认；
   *   - 条件 UPDATE 受影响 0 行时重读订单区分：已支付→幂等成功；订单不存在→404；其余→409，
   *     避免竞争失败方（如超时清扫已删单）被误报"支付已确认"。
   */
  static async confirmPartnerOrderPayment (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (!id) return res.status(400).json({ success: false, message: '无效的订单 ID' })
      const order = await PartnerOrder.findOne({
        where: { id, partner_id: req.partner.id }
      })
      if (!order) return res.status(404).json({ success: false, message: '订单不存在' })

      if (order.online_paid_at) {
        const full = await PartnerOrder.findByPk(order.id, {
          include: [{ model: PartnerOrderItem, as: 'items' }]
        })
        return res.json({ success: true, message: '支付已确认', data: full })
      }
      if (order.status !== 'pending_payment') {
        return res.status(409).json({ success: false, message: '订单当前状态不允许支付确认' })
      }

      const [affected] = await PartnerOrder.update(
        { status: 'submitted', online_paid_at: new Date() },
        {
          where: {
            id: order.id,
            partner_id: req.partner.id,
            status: 'pending_payment',
            online_paid_at: null
          }
        }
      )

      /**
       * 竞争失败方（affected=0）不能一律报"支付已确认"：
       * 条件 UPDATE 命中 0 行有三种真实原因，重读订单区分——
       *   - online_paid_at 已置位：并发确认先提交，幂等成功，走下方统一返回；
       *   - 订单已不存在（如超时清扫删单）：404；
       *   - 其余（状态已被改走且从未支付，如已取消）：409。
       */
      if (affected === 0) {
        const fresh = await PartnerOrder.findOne({
          where: { id: order.id, partner_id: req.partner.id }
        })
        if (!fresh) {
          return res.status(404).json({ success: false, message: '订单不存在' })
        }
        if (!fresh.online_paid_at) {
          return res.status(409).json({ success: false, message: '订单当前状态不允许支付确认' })
        }
      }

      AuditLog.logPartner({
        partner: req.partnerFull || { id: req.partner?.partnerId || req.partner?.id },
        event: affected === 1
          ? 'partner_order.payment.confirm'
          : 'partner_order.payment.confirm.idempotent_hit',
        resource: 'partner_order',
        resourceId: order.id,
        req
      }).catch(() => {})

      const full = await PartnerOrder.findByPk(order.id, {
        include: [{ model: PartnerOrderItem, as: 'items' }]
      })
      return res.json({ success: true, message: '支付已确认', data: full })
    } catch (e) {
      logger.error('PartnerPortalController.confirmPartnerOrderPayment', { err: e?.message, stack: e?.stack })
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
      logger.error('PartnerPortalController.listMyOrders', { err: e?.message, stack: e?.stack })
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
      logger.error('PartnerPortalController.orderDetail', { err: e?.message, stack: e?.stack })
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
      logger.error('PartnerPortalController.listAddresses', { err: e?.message, stack: e?.stack })
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

      /**
       * count→清默认→create 多步写包进同一事务；
       * 先对合作方父行加 FOR UPDATE 锁：仅事务（READ COMMITTED）挡不住并发首建
       * 双双 count=0 都设默认，父行锁把同一合作方的地址写串行化。
       */
      const row = await sequelize.transaction(async (transaction) => {
        await Partner.findByPk(partner_id, { transaction, lock: transaction.LOCK.UPDATE })

        const existing = await PartnerAddress.count({ where: { partner_id }, transaction })
        const wantDefault = body.is_default === true || body.is_default === 'true' || existing === 0

        if (wantDefault) {
          await PartnerAddress.update({ is_default: false }, { where: { partner_id }, transaction })
        }

        return PartnerAddress.create({
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
        }, { transaction })
      })
      return res.status(201).json({ success: true, data: row })
    } catch (e) {
      logger.error('PartnerPortalController.createAddress', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '保存地址失败' })
    }
  }

  static async updateAddress (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      const partner_id = req.partner.id

      /**
       * 清默认→设新默认的多步写包进同一事务；
       * 先锁合作方父行串行化同一合作方的并发地址写（防双默认）。
       * 校验失败返回 { ok:false } 由事务外统一响应。
       */
      const result = await sequelize.transaction(async (transaction) => {
        await Partner.findByPk(partner_id, { transaction, lock: transaction.LOCK.UPDATE })

        const row = await PartnerAddress.findOne({
          where: { id, partner_id },
          transaction,
          lock: transaction.LOCK.UPDATE
        })
        if (!row) return { ok: false, status: 404, message: '地址不存在' }

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
          return { ok: false, status: 400, message: '收货人、电话与详细地址不能为空' }
        }

        if (body.is_default === true || body.is_default === 'true') {
          await PartnerAddress.update({ is_default: false }, { where: { partner_id }, transaction })
          row.is_default = true
        }

        await row.save({ transaction })
        return { ok: true, row }
      })

      if (!result.ok) {
        return res.status(result.status).json({ success: false, message: result.message })
      }
      return res.json({ success: true, data: result.row })
    } catch (e) {
      logger.error('PartnerPortalController.updateAddress', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '更新地址失败' })
    }
  }

  static async deleteAddress (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      const partner_id = req.partner.id

      /**
       * 删除→默认地址递补的多步写包进同一事务（防并发下"无默认"或双默认）；
       * 先锁合作方父行串行化同一合作方的地址写。
       */
      const result = await sequelize.transaction(async (transaction) => {
        await Partner.findByPk(partner_id, { transaction, lock: transaction.LOCK.UPDATE })

        const row = await PartnerAddress.findOne({
          where: { id, partner_id },
          transaction,
          lock: transaction.LOCK.UPDATE
        })
        if (!row) return { ok: false, status: 404, message: '地址不存在' }
        const wasDefault = row.is_default
        await row.destroy({ transaction })

        if (wasDefault) {
          const nextDef = await PartnerAddress.findOne({
            where: { partner_id },
            order: [['updated_at', 'DESC']],
            transaction
          })
          if (nextDef) {
            nextDef.is_default = true
            await nextDef.save({ transaction })
          }
        }
        return { ok: true }
      })

      if (!result.ok) {
        return res.status(result.status).json({ success: false, message: result.message })
      }
      return res.json({ success: true, message: '已删除' })
    } catch (e) {
      logger.error('PartnerPortalController.deleteAddress', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '删除失败' })
    }
  }

  /**
   * 设置默认地址：单条 UPDATE 把同 partner 全部地址按 id=目标 改成对应 is_default。
   *
   * 一条语句的好处：
   *   1) PG 锁行顺序由表扫描决定（同 partner 范围内一致），不会出现两个事务以相反顺序拿锁的死锁。
   *   2) 真原子：要么所有行成功翻转，要么全都不翻；并发时绝不会出现 0 行或 2 行 is_default=true。
   *   3) 自动幂等：再点一次结果一样。
   *
   * 仍包一层 PG 死锁/序列化失败重试（最多 3 次），兜底极小概率的并发碰撞。
   */
  static async setDefaultAddress (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      const partner_id = req.partner.id
      const row = await PartnerAddress.findOne({ where: { id, partner_id } })
      if (!row) {
        return res.status(404).json({ success: false, message: '地址不存在' })
      }

      let attempt = 0
      let lastErr
      while (attempt < 3) {
        attempt++
        try {
          await sequelize.query(
            `UPDATE partner_addresses
                SET is_default = (id = :targetId),
                    updated_at = NOW()
              WHERE partner_id = :partnerId`,
            { replacements: { targetId: id, partnerId: partner_id } }
          )
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          // PG: 40P01 deadlock_detected, 40001 serialization_failure
          const code = e?.parent?.code || e?.original?.code
          if (code === '40P01' || code === '40001') {
            await new Promise(r => setTimeout(r, 20 + Math.floor(Math.random() * 30)))
            continue
          }
          throw e
        }
      }
      if (lastErr) throw lastErr

      const fresh = await PartnerAddress.findByPk(id)
      return res.json({ success: true, data: fresh })
    } catch (e) {
      logger.error('PartnerPortalController.setDefaultAddress', { err: e?.message, stack: e?.stack })
      return res.status(500).json({ success: false, message: '设置默认地址失败' })
    }
  }
}

export default PartnerPortalController
