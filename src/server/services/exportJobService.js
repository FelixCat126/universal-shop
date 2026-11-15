import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { Op } from 'sequelize'
import ExportJob from '../models/ExportJob.js'
import Order from '../models/Order.js'
import OrderItem from '../models/OrderItem.js'
import Partner from '../models/Partner.js'
import PartnerOrder from '../models/PartnerOrder.js'
import PartnerOrderItem from '../models/PartnerOrderItem.js'
import Product from '../models/Product.js'
import ProductCategory from '../models/ProductCategory.js'
import User from '../models/User.js'
import UserCoupon from '../models/UserCoupon.js'
import { createStreamingExport } from '../utils/excelWorkbook.js'
import { createStreamingCsvExport } from '../utils/csvExporter.js'
import { sanitizeCell } from '../utils/sanitizeCell.js'
import { likeContains } from '../utils/likeSearch.js'
import { logger } from '../utils/logger.js'
import { getBusinessTimezone, parseBusinessDayRange } from '../utils/businessTimezone.js'

/**
 * 异步导出任务服务
 *
 * 解决的问题：同步导出在请求线程里完成全部查询 + Excel 生成 + 传输，
 * 大数据量时长时间占用连接与内存（实测 5 万行峰值堆 400MB+），
 * 且受 HTTP 超时 / 反向代理限制。
 *
 * 异步化后：
 *   - 请求立即返回 jobId，管理员不阻塞
 *   - 后台分批流式写文件，内存占用与总量无关（ExcelJS 的 Row 累积除外，故仍分批）
 *   - 任务有状态可查（pending / running / done / failed），失败可重试
 */

/** 导出目录：放在项目内 uploads 之外的系统临时目录，避免被静态服务直接暴露 */
const EXPORT_DIR = process.env.EXPORT_DIR || path.join(os.tmpdir(), 'shop-exports')
/** 单次导出行数上限（异步场景可放宽：内存按批占用而非按总量） */
const EXPORT_ROW_LIMIT = Number(process.env.EXPORT_MAX_ROWS || 200000)
/** 每批行数 */
const BATCH_SIZE = 1000
/** 同时执行的任务数（超过则排队） */
const MAX_CONCURRENT = Number(process.env.EXPORT_MAX_CONCURRENT || 2)
/**
 * 测试环境默认**不**跑导出 worker。
 *
 * 单元测试里 worker 会和用例抢任务（用例断言中间状态，worker 却把任务跑完了），
 * 所以默认关掉；但 E2E 要验的正是「提交 → 后台生成 → 轮询 → 下载」这条链路，
 * 没有 worker 任务会永远停在 pending。
 * 需要时用 EXPORT_WORKER_ENABLED=1 显式打开。
 */
const workerEnabled = () => process.env.EXPORT_WORKER_ENABLED === '1'
/** 任务文件保留时长（小时），过期由 retention 清理 */
const FILE_TTL_HOURS = Number(process.env.EXPORT_FILE_TTL_HOURS || 48)

let running = 0

const ORDER_EXPORT_HEADERS = [
  '订单号', '订单状态', '客户昵称', '联系电话', '收货地址',
  '商品名称', '商品数量', '订单金额(THB)', '支付方式', '创建时间'
]
const USER_EXPORT_HEADERS = [
  'ID', '用户名', '昵称', '邮箱', '手机号', '推荐码', '被推荐码', '注册时间', '更新时间'
]
const PRODUCT_EXPORT_HEADERS = [
  'ID', '名称', '泰文名', '分类', '售价THB', '库存', '积分', '状态', '创建时间'
]
const PARTNER_EXPORT_HEADERS = [
  'ID', '登录名', '商家名称', '账号类别', '折扣%', '启用', '最后登录', '创建时间'
]
const CATEGORY_EXPORT_HEADERS = ['ID', '分类名', '排序', '创建时间']
const PARTNER_ORDER_EXPORT_HEADERS = [
  '订单号', '合作方登录名', '合作方名称', '状态', '收货人', '收货电话', '送货地址',
  '订单总额THB', '商品ID', '商品快照名', '数量', '合作方折扣快照',
  '零售价等价THB', '单价THB', '行小计THB', '下单时间'
]

function ensureDir () {
  return fs.mkdir(EXPORT_DIR, { recursive: true })
}

/** 导出订单（分批 keyset 游标） */
/**
 * 导出格式：xlsx（给人看/带样式）| csv（给财务对账、ERP 导入、体积小）
 * 两者共用同一套 addRow 接口，上层业务代码不用分叉。
 */
function exportFormatOf (job) {
  const fmt = String(job?.params?.format || 'xlsx').toLowerCase()
  return fmt === 'csv' ? 'csv' : 'xlsx'
}

/**
 * 按格式创建导出器 + 文件名。
 * @returns {Promise<{exporter: object, fileName: string}>}
 */
/**
 * 进行中的导出器：jobId → exporter。
 *
 * 导出器的句柄与临时文件都是**创建时**就打开/落盘的，
 * 只有成功路径（writeTo / writeToFile）才会关掉。
 * 任务失败时必须能拿到它来清理 —— 否则每次失败泄漏一个 fd + 一份临时文件
 * （清理任务只回收"任务表里有 file_path 的行"，孤儿文件永远收不回来）。
 */
const activeExporters = new Map()

async function makeExporter (job, { sheetName, headers, widths, baseName }) {
  const fmt = exportFormatOf(job)
  const day = new Date().toISOString().split('T')[0]
  let exporter
  let fileName
  if (fmt === 'csv') {
    exporter = await createStreamingCsvExport({ headers })
    fileName = `${baseName}_${day}_${job.id}.csv`
  } else {
    exporter = await createStreamingExport({ sheetName, headers, widths })
    fileName = `${baseName}_${day}_${job.id}.xlsx`
  }
  activeExporters.set(job.id, exporter)
  return { exporter, fileName }
}

/** 释放导出器占用的资源（失败或结束都调用） */
async function disposeExporter (jobId) {
  const exporter = activeExporters.get(jobId)
  activeExporters.delete(jobId)
  if (!exporter) return
  try {
    await exporter.abort?.()
  } catch (e) {
    logger.warn('清理导出器资源失败', { jobId, err: e?.message })
  }
}

async function exportOrdersTo (job) {
  const { exporter, fileName } = await makeExporter(job, {
    sheetName: '订单列表',
    headers: ORDER_EXPORT_HEADERS,
    widths: [22, 14, 16, 18, 34, 28, 10, 16, 14, 20],
    baseName: '订单数据'
  })
  const target = path.join(EXPORT_DIR, fileName)
  await ensureDir()

  let written = 0
  let cursor = 0
  const tz = await getBusinessTimezone()
  const filter = buildOrderFilter(job.params, tz)
  const first = await Order.findOne({ attributes: ['id'], where: filter, order: [['id', 'DESC']] })
  // 游标取「最大 id + 1」：下面查询用的是 id < cursor，
  // 若游标等于最大 id，最新一条会被静默漏掉。
  cursor = first ? first.id + 1 : 0

  while (written < EXPORT_ROW_LIMIT) {
    const size = Math.min(BATCH_SIZE, EXPORT_ROW_LIMIT - written)
    const batch = await Order.findAll({
      include: [
        { model: User, as: 'user', attributes: ['nickname', 'phone'] },
        {
          model: OrderItem,
          as: 'items',
          include: [{ model: Product, as: 'product', paranoid: false, attributes: ['name', 'alias'] }]
        }
      ],
      where: { ...filter, id: { [Op.lt]: cursor } },
      order: [['id', 'DESC']],
      limit: size
    })
    if (batch.length === 0) break
    for (const order of batch) {
      const names = (order.items || [])
        .map(i => i.product?.alias || i.product?.name || '')
        .filter(Boolean)
        .join(', ')
      const qty = (order.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0)
      await exporter.addRow([
        sanitizeCell(order.order_no || ''),
        sanitizeCell(order.status || ''),
        sanitizeCell(order.user?.nickname || ''),
        sanitizeCell(order.contact_phone || ''),
        sanitizeCell(order.delivery_address || ''),
        sanitizeCell(names),
        qty,
        order.total_amount_thb != null ? Number(order.total_amount_thb).toFixed(2) : (order.total_amount || ''),
        sanitizeCell(order.payment_method || ''),
        order.created_at ? new Date(order.created_at).toISOString() : ''
      ])
      written++
    }
    cursor = batch[batch.length - 1].id
    if (batch.length < size) break
  }

  const { size } = await exporter.writeToFile(target)
  return { fileName, filePath: target, fileSize: size, rowCount: written }
}

/** 导出用户 */
async function exportUsersTo (job) {
  const { exporter, fileName } = await makeExporter(job, {
    sheetName: '用户列表',
    headers: USER_EXPORT_HEADERS,
    widths: [8, 20, 16, 24, 18, 16, 16, 20, 20],
    baseName: '用户数据'
  })
  const target = path.join(EXPORT_DIR, fileName)
  await ensureDir()

  const ATTRS = ['id', 'username', 'nickname', 'email', 'phone', 'referral_code', 'referred_by_code', 'created_at', 'updated_at']
  let written = 0
  let cursor = 0
  const tz = await getBusinessTimezone()
  const filter = buildUserFilter(job.params, tz)
  const first = await User.findOne({ attributes: ['id'], where: filter, order: [['id', 'DESC']] })
  // 同上：游标要取最大 id + 1，否则最新一条会被漏掉
  cursor = first ? first.id + 1 : 0

  while (written < EXPORT_ROW_LIMIT) {
    const size = Math.min(BATCH_SIZE, EXPORT_ROW_LIMIT - written)
    const batch = await User.findAll({
      attributes: ATTRS,
      where: { ...filter, id: { [Op.lt]: cursor } },
      order: [['id', 'DESC']],
      limit: size
    })
    if (batch.length === 0) break
    for (const user of batch) {
      await exporter.addRow([
        user.id,
        sanitizeCell(user.username || ''),
        sanitizeCell(user.nickname),
        sanitizeCell(user.email || ''),
        sanitizeCell(user.phone),
        sanitizeCell(user.referral_code || ''),
        sanitizeCell(user.referred_by_code || ''),
        user.created_at ? new Date(user.created_at).toISOString() : '',
        user.updated_at ? new Date(user.updated_at).toISOString() : ''
      ])
      written++
    }
    cursor = batch[batch.length - 1].id
    if (batch.length < size) break
  }

  const { size } = await exporter.writeToFile(target)
  return { fileName, filePath: target, fileSize: size, rowCount: written }
}

/**
 * 导出筛选条件构造
 *
 * 管理员在列表页设了筛选再点导出，期望拿到的就是筛选后的结果；
 * 若忽略 params，导出会变成「全量」，容易让人误判业务数据。
 * 条件口径与列表接口（getAllUsers / getAllOrders）保持一致。
 */
/**
 * 导出筛选里的**状态**：支持逗号分隔的多个值（与列表同一口径）。
 *
 * 之前是 `where.status = String(params.status)` —— 传 "paid,shipping"
 * 会去匹配**字面量** 'paid,shipping' → 一条都导不出来（空文件）。
 * 而列表页早就支持多状态了 → 列表显示 3 单、导出 0 行，"报表对不上"。
 */
function buildStatusCondition (params) {
  const list = String(params.status || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  if (list.length === 0) return null
  if (list.length === 1) return list[0]
  return { [Op.in]: list }
}

/**
 * 导出筛选里的**日期范围**：按业务时区的日历日切（与列表 applyCreatedBetween 同一口径）。
 *
 * 之前是 `[Op.between]: [params.startDate, params.endDate]` 传裸 'YYYY-MM-DD' 字符串
 * → PG 当成 **UTC 午夜** → 与列表（业务时区日界）**整整差一天**：
 * 结束日当天的单全漏掉，开始日当天的单也漏掉。
 *
 * 参数名同时认 startDate/endDate 与 start_from/end_from
 * （前端两个地方各叫各的，导出那处叫 start_from）。
 */
function buildDateRangeCondition (params, tz) {
  // 参数名兼容：startDate/endDate（零售导出）、start_from/end_from、from/to（合作方订单）
  const fromRaw = params.startDate ?? params.start_from ?? params.from
  const toRaw = params.endDate ?? params.end_from ?? params.to
  if (!fromRaw && !toRaw) return null

  /**
   * 一个边界值的解析：
   *   - 'YYYY-MM-DD' → 按**业务时区**的日历日（与列表 applyCreatedBetween 同一口径）
   *   - 完整 ISO 时间戳 → 当作精确时刻用（保持原有能力）
   */
  const bound = (raw, edge) => {
    if (raw == null || raw === '') return null
    const text = String(raw).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const range = parseBusinessDayRange(tz, text)
      return range ? (edge === 'start' ? range.start : range.end) : null
    }
    const d = new Date(text)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const range = {}
  const from = bound(fromRaw, 'start')
  const to = bound(toRaw, 'end')
  if (from) range[Op.gte] = from
  if (to) range[Op.lte] = to
  if (Reflect.ownKeys(range).length === 0) return null
  return range
}

function buildOrderFilter (params = {}, tz) {
  const where = {}
  const status = buildStatusCondition(params)
  if (status) where.status = status
  const range = buildDateRangeCondition(params, tz)
  if (range) where.created_at = range
  if (params.keyword) {
    const like = likeContains(params.keyword)
    where[Op.or] = [
      { order_no: { [Op.like]: like } },
      { contact_name: { [Op.like]: like } },
      { contact_phone: { [Op.like]: like } }
    ]
  }
  return where
}

/**
 * 合作方订单的筛选条件（与直接导出 /api/admin/partner-orders/export 的口径一致）。
 */
function buildPartnerOrderFilter (params = {}, tz) {
  const where = {}
  const status = buildStatusCondition(params)
  if (status) where.status = status
  const range = buildDateRangeCondition(params, tz)
  if (range) where.created_at = range
  if (params.partner_keyword) {
    const like = likeContains(params.partner_keyword)
    where.partner = {
      [Op.or]: [
        { login: { [Op.like]: like } },
        { display_name: { [Op.like]: like } }
      ]
    }
  }
  return where
}

function buildProductFilter (params = {}, tz) {
  const where = {}
  const status = buildStatusCondition(params)
  if (status) where.status = status
  if (params.keyword) {
    const like = likeContains(params.keyword)
    where[Op.or] = [
      { name: { [Op.like]: like } },
      { name_th: { [Op.like]: like } },
      { alias: { [Op.like]: like } }
    ]
  }
  return where
}

function buildPartnerFilter (params = {}) {
  const where = {}
  if (params.login) {
    where.login = { [Op.like]: likeContains(params.login) }
  }
  if (params.display_name) {
    where.display_name = { [Op.like]: likeContains(params.display_name) }
  }
  if (params.account_kind) {
    where.account_kind = String(params.account_kind)
  }
  return where
}

function buildUserFilter (params = {}, tz) {
  /**
   * 条件用 **Op.and 数组**（与列表 getAllUsers 同一构造）。
   *
   * 之前是分别往 where[Op.or] 里赋值 —— **后一次覆盖前一次**：
   * 同时传 email 与 referral_code 时，email 条件被冲掉 →
   * 导出结果比列表多（列表是"同时满足"）。对账时就会发现"导出来的比看到的多"。
   */
  const conditions = []
  if (params.email) {
    const like = likeContains(params.email)
    conditions.push({
      [Op.or]: [
        { email: { [Op.like]: like } },
        { username: { [Op.like]: like } }
      ]
    })
  }
  if (params.phone) {
    conditions.push({ phone: { [Op.like]: likeContains(params.phone) } })
  }
  if (params.referral_code) {
    const like = likeContains(params.referral_code)
    conditions.push({
      [Op.or]: [
        { referral_code: { [Op.like]: like } },
        { referred_by_code: { [Op.like]: like } }
      ]
    })
  }
  if (conditions.length === 0) return {}
  return { [Op.and]: conditions }
}

/**
 * 导出合作方订单（批发对账）。
 *
 * 按**订单行**展开（一行一个商品），和直接导出的口径一致 ——
 * 财务对账看的是"哪个合作方、买了哪个商品、多少件、多少钱"。
 */
async function exportPartnerOrdersTo (job) {
  const { exporter, fileName } = await makeExporter(job, {
    sheetName: '合作方订货',
    headers: PARTNER_ORDER_EXPORT_HEADERS,
    widths: [22, 16, 18, 12, 14, 18, 30, 14, 10, 26, 8, 12, 14, 12, 14, 20],
    baseName: '合作方订货'
  })
  const target = path.join(EXPORT_DIR, fileName)
  await ensureDir()

  const tz = await getBusinessTimezone()
  const filter = buildPartnerOrderFilter(job.params, tz)
  let written = 0
  let cursor = 0
  const first = await PartnerOrder.findOne({ attributes: ['id'], where: filter, order: [['id', 'DESC']] })
  // 游标要取最大 id + 1，否则最新一条会被漏掉
  cursor = first ? first.id + 1 : 0

  while (written < EXPORT_ROW_LIMIT) {
    const size = Math.min(BATCH_SIZE, EXPORT_ROW_LIMIT - written)
    const batch = await PartnerOrder.findAll({
      where: { ...filter, id: { [Op.lt]: cursor } },
      order: [['id', 'DESC']],
      limit: size,
      include: [
        { model: Partner, as: 'partner', attributes: ['login', 'display_name'], required: false },
        { model: PartnerOrderItem, as: 'items' }
      ]
    })
    if (batch.length === 0) break
    for (const order of batch) {
      const oj = order.toJSON()
      const partnerLogin = sanitizeCell(oj.partner?.login ?? '')
      const partnerName = sanitizeCell(oj.partner?.display_name ?? '')
      const items = oj.items || []
      if (items.length === 0) {
        await exporter.addRow([
          sanitizeCell(oj.order_no || ''), partnerLogin, partnerName,
          sanitizeCell(oj.status || ''), sanitizeCell(oj.contact_name || ''),
          sanitizeCell(oj.contact_phone || ''), sanitizeCell(oj.delivery_address || ''),
          oj.total_amount_thb != null ? Number(oj.total_amount_thb).toFixed(2) : '',
          '', '', '', '', '', '', '', '',
          oj.created_at ? new Date(oj.created_at).toISOString() : ''
        ])
        written++
        continue
      }
      for (const it of items) {
        await exporter.addRow([
          sanitizeCell(oj.order_no || ''),
          partnerLogin,
          partnerName,
          sanitizeCell(oj.status || ''),
          sanitizeCell(oj.contact_name || ''),
          sanitizeCell(oj.contact_phone || ''),
          sanitizeCell((oj.delivery_address ?? '').replace(/\n/g, ' ')),
          oj.total_amount_thb != null ? Number(oj.total_amount_thb).toFixed(2) : '',
          it.product_id,
          sanitizeCell(it.product_name_snapshot || ''),
          it.quantity,
          it.partner_discount_percent_snapshot != null ? Number(it.partner_discount_percent_snapshot).toFixed(2) : '',
          it.base_unit_thb != null ? Number(it.base_unit_thb).toFixed(2) : '',
          it.unit_price_thb != null ? Number(it.unit_price_thb).toFixed(2) : '',
          it.line_total_thb != null ? Number(it.line_total_thb).toFixed(2) : '',
          oj.created_at ? new Date(oj.created_at).toISOString() : ''
        ])
        written++
      }
    }
    cursor = batch[batch.length - 1].id
    if (batch.length < size) break
  }

  const { size } = await exporter.writeToFile(target)
  return { fileName, filePath: target, fileSize: size, rowCount: written }
}

/**
 * 导出商品。
 */
async function exportProductsTo (job) {
  const { exporter, fileName } = await makeExporter(job, {
    sheetName: '商品列表',
    headers: PRODUCT_EXPORT_HEADERS,
    widths: [8, 24, 24, 16, 12, 10, 8, 10, 20],
    baseName: '商品数据'
  })
  const target = path.join(EXPORT_DIR, fileName)
  await ensureDir()

  let written = 0
  let cursor = 0
  const tz = await getBusinessTimezone()
  const filter = buildProductFilter(job.params, tz)
  const first = await Product.findOne({ attributes: ['id'], where: filter, order: [['id', 'DESC']] })
  cursor = first ? first.id + 1 : 0

  while (written < EXPORT_ROW_LIMIT) {
    const size = Math.min(BATCH_SIZE, EXPORT_ROW_LIMIT - written)
    const batch = await Product.findAll({
      where: { ...filter, id: { [Op.lt]: cursor } },
      order: [['id', 'DESC']],
      limit: size,
      include: [{ model: ProductCategory, as: 'productCategory', attributes: ['id', 'name'], required: false }]
    })
    if (batch.length === 0) break
    for (const product of batch) {
      await exporter.addRow([
        product.id,
        sanitizeCell(product.name || ''),
        sanitizeCell(product.name_th || ''),
        sanitizeCell(product.productCategory?.name || ''),
        product.price != null ? Number(product.price).toFixed(2) : '',
        product.stock ?? '',
        product.points ?? '',
        sanitizeCell(product.status || ''),
        product.created_at ? new Date(product.created_at).toISOString() : ''
      ])
      written++
    }
    cursor = batch[batch.length - 1].id
    if (batch.length < size) break
  }

  const { size } = await exporter.writeToFile(target)
  return { fileName, filePath: target, fileSize: size, rowCount: written }
}

/**
 * 导出合作方名单。
 */
async function exportPartnersTo (job) {
  const { exporter, fileName } = await makeExporter(job, {
    sheetName: '合作方名单',
    headers: PARTNER_EXPORT_HEADERS,
    widths: [8, 18, 22, 12, 10, 8, 20, 20],
    baseName: '合作方数据'
  })
  const target = path.join(EXPORT_DIR, fileName)
  await ensureDir()

  let written = 0
  let cursor = 0
  const filter = buildPartnerFilter(job.params)
  const first = await Partner.findOne({ attributes: ['id'], where: filter, order: [['id', 'DESC']] })
  cursor = first ? first.id + 1 : 0

  while (written < EXPORT_ROW_LIMIT) {
    const size = Math.min(BATCH_SIZE, EXPORT_ROW_LIMIT - written)
    const batch = await Partner.findAll({
      where: { ...filter, id: { [Op.lt]: cursor } },
      order: [['id', 'DESC']],
      limit: size
    })
    if (batch.length === 0) break
    for (const partner of batch) {
      await exporter.addRow([
        partner.id,
        sanitizeCell(partner.login || ''),
        sanitizeCell(partner.display_name || ''),
        sanitizeCell(partner.account_kind || ''),
        partner.discount_percent != null ? Number(partner.discount_percent).toFixed(2) : '',
        partner.is_active ? 'true' : 'false',
        partner.last_login_at ? new Date(partner.last_login_at).toISOString() : '',
        partner.created_at ? new Date(partner.created_at).toISOString() : ''
      ])
      written++
    }
    cursor = batch[batch.length - 1].id
    if (batch.length < size) break
  }

  const { size } = await exporter.writeToFile(target)
  return { fileName, filePath: target, fileSize: size, rowCount: written }
}

/**
 * 导出商品分类。
 */
async function exportCategoriesTo (job) {
  const { exporter, fileName } = await makeExporter(job, {
    sheetName: '商品分类',
    headers: CATEGORY_EXPORT_HEADERS,
    widths: [8, 24, 10, 20],
    baseName: '商品分类数据'
  })
  const target = path.join(EXPORT_DIR, fileName)
  await ensureDir()

  const rows = await ProductCategory.findAll({ order: [['id', 'ASC']] })
  for (const cat of rows) {
    await exporter.addRow([
      cat.id,
      sanitizeCell(cat.name || ''),
      cat.sort_order ?? '',
      cat.created_at ? new Date(cat.created_at).toISOString() : ''
    ])
  }

  const { size } = await exporter.writeToFile(target)
  return { fileName, filePath: target, fileSize: size, rowCount: rows.length }
}

const RUNNERS = {
  users: exportUsersTo,
  orders: exportOrdersTo,
  partner_orders: exportPartnerOrdersTo,
  products: exportProductsTo,
  partners: exportPartnersTo,
  categories: exportCategoriesTo
}

/** 创建导出任务 */
export async function createExportJob ({ adminId, adminUsername, type, params = {} }) {
  if (!RUNNERS[type]) {
    const err = new Error('不支持的导出类型')
    err.status = 400
    throw err
  }
  return ExportJob.create({
    admin_id: adminId,
    admin_username: adminUsername,
    type,
    status: 'pending',
    params
  })
}

/** 执行单个任务（供 worker 调用） */
export async function runExportJob (job) {
  const runner = RUNNERS[job.type]
  if (!runner) {
    await job.update({ status: 'failed', error_message: '不支持的导出类型', completed_at: new Date() })
    return
  }
  await job.update({ status: 'running', started_at: new Date() })
  try {
    const result = await runner(job)
    await job.update({
      status: 'done',
      row_count: result.rowCount,
      file_name: result.fileName,
      file_path: result.filePath,
      file_size: result.fileSize,
      completed_at: new Date()
    })
    logger.info('导出任务完成', { jobId: job.id, type: job.type, rows: result.rowCount, ms: Date.now() - job.started_at })
    /**
     * 成功路径**不要**调 abort()。
     *
     * writeToFile 已经关掉句柄并清理了临时文件；再调 abort 会对**已 commit 的
     * workbook 二次 commit** → archiver 抛 "archive already finalizing"，
     * 且那个 promise 若没人接住就是 unhandledRejection → **整个进程退出**
     * （E2E 里表现为 WebServer 崩溃，后续全部用例失败）。
     */
    activeExporters.delete(job.id)
  } catch (error) {
    logger.error('导出任务失败', { jobId: job.id, err: error?.message, stack: error?.stack })
    // 失败路径必须清理：句柄 + 临时文件（成功路径已由 writeToFile 处理）
    await disposeExporter(job.id)
    await job.update({
      status: 'failed',
      error_message: String(error?.message || '导出失败').slice(0, 500),
      completed_at: new Date()
    })
  }
}

/**
 * 回收僵死任务：进程在导出中途崩溃/被重启时，任务会永远停在 running。
 * 超过阈值（默认 30 分钟）仍在 running 的，判定为失败并允许重新提交。
 */
export async function recoverStaleExportJobs ({ staleMinutes = 30 } = {}) {
  const cutoff = new Date(Date.now() - staleMinutes * 60000)
  const stale = await ExportJob.findAll({
    where: { status: 'running', started_at: { [Op.lt]: cutoff } },
    limit: 50
  })
  for (const job of stale) {
    await job.update({
      status: 'failed',
      error_message: '导出进程中断，请重新提交',
      completed_at: new Date()
    })
  }
  return stale.length
}

/**
 * worker：扫描 pending 任务并执行。
 * @param {number} limit 本轮最多处理的任务数
 */
export async function processPendingExportJobs (limit = 5) {
  const jobs = await ExportJob.findAll({
    where: { status: 'pending' },
    order: [['id', 'ASC']],
    limit
  })
  for (const job of jobs) {
    if (running >= MAX_CONCURRENT) break
    running++
    try {
      /**
       * 抢占式标记为 running，避免多实例重复执行。
       *
       * 注意 Sequelize 的 Model.update() 返回的是 **[影响行数]**（数组），
       * 数组恒为真值 —— 早前写成 `if (!claimed)` 永远不成立，
       * 于是「抢占失败」（任务已被另一个 worker 置为 running）也会继续往下跑，
       * 同一个任务会被导出两次（文件写两遍、file_path 取决于谁最后写回）。
       * 必须拆开数组看首元素。
       */
      const [affected] = await ExportJob.update(
        { status: 'running', started_at: new Date() },
        { where: { id: job.id, status: 'pending' } }
      )
      if (!affected) continue
      await runExportJob(job)
    } catch (err) {
      /**
       * 抢占那一句也可能抛错（连接池耗尽、DB 短暂不可用）。
       * 之前异常直接冒泡到 worker 外层，**running 永远少减一次** ——
       * 累计 MAX_CONCURRENT(2) 次之后 `running >= MAX_CONCURRENT` 恒成立，
       * worker 每轮直接 break → **后台导出彻底停摆**，
       * 管理员提交的任务永远停在 pending（回收逻辑只捞 running，救不了 pending）。
       */
      logger.error('导出任务抢占失败', { jobId: job.id, err: err?.message })
    } finally {
      running--
    }
  }
  return jobs.length
}

/**
 * 立即触发一次处理（不等待下一个轮询周期）。
 *
 * 管理员点「导出」后期望几秒内就能看到任务开始，
 * 若只靠 15s 的定时轮询，最坏要等 15s 才有反馈，体验上像是卡住了。
 */
let triggering = false
export function triggerExportJobs () {
  // 测试环境不自动触发：测试会显式调用 processPendingExportJobs，
  // 自动触发会和它抢任务，导致断言读到中间状态
  // （E2E 需要真实链路，用 EXPORT_WORKER_ENABLED=1 打开）
  if (process.env.NODE_ENV === 'test' && !workerEnabled()) return
  if (triggering) return
  triggering = true
  // 放到下一个 tick，避免阻塞当前请求的响应
  setImmediate(() => {
    processPendingExportJobs().catch(err => {
      logger.error('导出任务触发失败', { err: err?.message })
    }).finally(() => {
      triggering = false
    })
  })
}

/** 启动 worker（与其它后台任务同款：setInterval + unref） */
export function startExportJobWorker () {
  if (process.env.NODE_ENV === 'test' && !workerEnabled()) return null
  const interval = Number(process.env.EXPORT_WORKER_INTERVAL_MS || 15000)
  const timer = setInterval(() => {
    recoverStaleExportJobs()
      .catch(err => logger.error('回收僵死导出任务失败', { err: err?.message }))
      .then(() => processPendingExportJobs())
      .catch(err => {
        logger.error('导出任务 worker 异常', { err: err?.message, stack: err?.stack })
      })
  }, interval)
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}

/**
 * 清理：过老的已完成任务 + 其残留文件。
 * @returns {Promise<{ removed: number, filesRemoved: number }>}
 */
export async function cleanupExportJobs ({ keepDays = 7 } = {}) {
  const cutoff = new Date(Date.now() - keepDays * 86400000)
  const stale = await ExportJob.findAll({
    where: {
      status: { [Op.in]: ['done', 'failed'] },
      created_at: { [Op.lt]: cutoff }
    },
    limit: 500
  })
  let filesRemoved = 0
  for (const job of stale) {
    if (job.file_path) {
      try {
        await fs.unlink(job.file_path)
        filesRemoved++
      } catch { /* 文件可能已被清理 */ }
    }
  }
  const removed = await ExportJob.destroy({ where: { id: stale.map(j => j.id) }, limit: 500 })
  return { removed, filesRemoved }
}

/** 清理超过 TTL 的导出文件（任务记录保留，文件先删） */
export async function cleanupExpiredExportFiles () {
  const cutoff = new Date(Date.now() - FILE_TTL_HOURS * 3600000)
  const jobs = await ExportJob.findAll({
    where: { status: 'done', file_path: { [Op.ne]: null }, completed_at: { [Op.lt]: cutoff } },
    limit: 200
  })
  let removed = 0
  for (const job of jobs) {
    try {
      await fs.unlink(job.file_path)
      removed++
      await job.update({ file_path: null })
    } catch { /* ignore */ }
  }

  /**
   * 再扫一遍目录，回收**孤儿文件**。
   *
   * 上一段只能删"ExportJob 表里有记录且已过期"的文件。而这些文件永远没人管：
   *   - 导出任务**失败**时留下的临时文件（export-*.csv / export-*.xlsx）
   *   - 任务记录被删/被清库、但文件还在的成品文件
   * 它们的共同点：**数据库里没有对应记录**。
   *
   * 实测（本地）：tmp 目录里堆了 80+ 个跨 4 天的导出文件，全是孤儿 ——
   * 磁盘只增不减，容器磁盘满了服务就挂。
   *
   * 判据：文件在目录里、**不在**数据库记录里、且 mtime 已超过 TTL → 删。
   */
  let orphans = 0
  try {
    const names = await fs.readdir(EXPORT_DIR)
    const known = new Set(
      (await ExportJob.findAll({ attributes: ['file_path'] }))
        .map(j => j.file_path)
        .filter(Boolean)
    )
    const ttlMs = FILE_TTL_HOURS * 3600000
    for (const name of names) {
      const full = path.join(EXPORT_DIR, name)
      if (known.has(full)) continue
      const st = await fs.stat(full).catch(() => null)
      if (!st || !st.isFile()) continue
      // 刚生成的文件可能正在被写 → 只删超过 TTL 的
      if (Date.now() - st.mtimeMs < ttlMs) continue
      await fs.unlink(full).catch(() => {})
      orphans++
    }
  } catch (e) {
    logger.warn('扫描导出目录清理孤儿文件失败', { err: e?.message })
  }

  return removed + orphans
}
