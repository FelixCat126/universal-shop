import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { Op } from 'sequelize'
import ExportJob from '../models/ExportJob.js'
import Order from '../models/Order.js'
import OrderItem from '../models/OrderItem.js'
import Product from '../models/Product.js'
import User from '../models/User.js'
import UserCoupon from '../models/UserCoupon.js'
import { createStreamingExport } from '../utils/excelWorkbook.js'
import { sanitizeCell } from '../utils/sanitizeCell.js'
import { likeContains } from '../utils/likeSearch.js'
import { logger } from '../utils/logger.js'

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

function ensureDir () {
  return fs.mkdir(EXPORT_DIR, { recursive: true })
}

/** 导出订单（分批 keyset 游标） */
async function exportOrdersTo (job) {
  const fileName = `订单数据_${new Date().toISOString().split('T')[0]}_${job.id}.xlsx`
  const target = path.join(EXPORT_DIR, fileName)
  await ensureDir()

  const exporter = await createStreamingExport({
    sheetName: '订单列表',
    headers: ORDER_EXPORT_HEADERS,
    widths: [22, 14, 16, 18, 34, 28, 10, 16, 14, 20]
  })

  let written = 0
  let cursor = 0
  const filter = buildOrderFilter(job.params)
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
  const fileName = `用户数据_${new Date().toISOString().split('T')[0]}_${job.id}.xlsx`
  const target = path.join(EXPORT_DIR, fileName)
  await ensureDir()

  const exporter = await createStreamingExport({
    sheetName: '用户列表',
    headers: USER_EXPORT_HEADERS,
    widths: [8, 20, 15, 25, 15, 12, 12, 20, 20]
  })

  const ATTRS = ['id', 'username', 'nickname', 'email', 'phone', 'referral_code', 'referred_by_code', 'created_at', 'updated_at']
  let written = 0
  let cursor = 0
  const filter = buildUserFilter(job.params)
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
function buildOrderFilter (params = {}) {
  const where = {}
  if (params.status) {
    where.status = String(params.status)
  }
  if (params.startDate && params.endDate) {
    where.created_at = { [Op.between]: [params.startDate, params.endDate] }
  }
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

function buildUserFilter (params = {}) {
  const where = {}
  if (params.email) {
    const like = likeContains(params.email)
    where[Op.or] = [
      { email: { [Op.like]: like } },
      { username: { [Op.like]: like } }
    ]
  }
  if (params.phone) {
    where.phone = { [Op.like]: likeContains(params.phone) }
  }
  if (params.referral_code) {
    const like = likeContains(params.referral_code)
    where[Op.or] = [
      { referral_code: { [Op.like]: like } },
      { referred_by_code: { [Op.like]: like } }
    ]
  }
  return where
}

const RUNNERS = {
  users: exportUsersTo,
  orders: exportOrdersTo
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
  } catch (error) {
    logger.error('导出任务失败', { jobId: job.id, err: error?.message, stack: error?.stack })
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
    if (!affected) { running--; continue }
    try {
      await runExportJob(job)
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
  return removed
}
