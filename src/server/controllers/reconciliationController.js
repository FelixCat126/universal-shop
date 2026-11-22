import { Op } from 'sequelize'
import PaymentReconciliationRecord, { RECONCILE_STATUSES } from '../models/PaymentReconciliationRecord.js'
import AuditLog from '../models/AuditLog.js'
import XLSX from '../utils/excelWorkbook.js'
import { sanitizeCell } from '../utils/sanitizeCell.js'
import { csvCell } from '../utils/csvExporter.js'
import { parseId } from '../utils/params.js'
import { likeContains } from '../utils/likeSearch.js'
import { resolvePagination } from '../utils/pagination.js'
import { respondDbError } from '../utils/dbInputError.js'
import { applyCreatedBetween } from '../utils/dateFilters.js'
import { getBusinessTimezone } from '../utils/businessTimezone.js'
import { logger } from '../utils/logger.js'

/** 单次导出的行数上限（与其它导出接口同一口径） */
const EXPORT_ROW_LIMIT = 50000

/** 截断提示（写在导出表格末尾的一行） */
const appendTruncationNote = (worksheet) => {
  XLSX.utils.sheet_add_aoa(worksheet, [
    [`数据量超过上限，仅导出前 ${EXPORT_ROW_LIMIT} 行（按被清时间倒序）`]
  ], { origin: -1 })
}

/** 核对状态 → 中文 */
const RECONCILE_STATUS_ZH = {
  pending: '待核对',
  received: '已收款',
  not_received: '确认未收款'
}

/** 订单类型 → 中文 */
const ORDER_TYPE_ZH = {
  retail: '零售',
  partner: '合作方'
}

/**
 * 支付对账台账控制器（第 51 轮）
 * ================================
 *
 * ## 这套接口解决什么
 *
 * 超时未支付被清扫掉的订单，单据在 `payment_reconciliation_records` 里
 * 留了完整快照。运营在这里逐单核对"这笔钱到底收没收到"，并记录结论。
 *
 * ## 边界（刻意为之）
 *
 * 标记结论**只改台账行** —— 不恢复订单、不退款、不动库存、不动积分与券。
 * 原因：订单已被删除、库存已回补（货可能已卖光）→ 自动恢复会超卖；
 * 而退款属于支付链路，不在本轮范围内。
 * 补偿走线下，运营处理完回来销账。
 */
class ReconciliationController {
  /**
   * 列表：按核对状态 / 订单类型 / 单号 / 被清时间筛选 + 分页
   */
  static async list (req, res) {
    try {
      const { page, pageSize, limit, offset } = resolvePagination(req.query)

      let where = {}
      const status = req.query.status != null ? String(req.query.status).trim() : ''
      const orderType = req.query.order_type != null ? String(req.query.order_type).trim() : ''
      const keyword = req.query.order_no != null ? String(req.query.order_no).trim() : ''

      if (status && RECONCILE_STATUSES.includes(status)) {
        where.reconcile_status = status
      }
      if (orderType === 'retail' || orderType === 'partner') {
        where.order_type = orderType
      }
      if (keyword) {
        where.order_no = { [Op.like]: likeContains(keyword) }
      }
      // 被清时间筛选（对账时通常按"这段时间被清的单"来对）
      where = applyCreatedBetween(
        where,
        { start_date: req.query.start_date, end_date: req.query.end_date },
        { timezone: await getBusinessTimezone(), column: 'swept_at' }
      )

      const { count, rows } = await PaymentReconciliationRecord.findAndCountAll({
        where,
        order: [['swept_at', 'DESC'], ['id', 'DESC']],
        limit,
        offset
      })

      return res.json({
        success: true,
        data: {
          records: rows.map((r) => r.toJSON()),
          total: count,
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize) || 1
        }
      })
    } catch (error) {
      return respondDbError(res, error, {
        logLabel: '查询对账台账失败',
        fallbackMessage: '查询对账台账失败',
        logger
      })
    }
  }

  /**
   * 详情：含完整商品明细快照
   */
  static async detail (req, res) {
    try {
      const id = parseId(req.params.id)
      if (!id) {
        return res.status(400).json({ success: false, message: '无效的记录 ID' })
      }
      const record = await PaymentReconciliationRecord.findByPk(id)
      if (!record) {
        return res.status(404).json({ success: false, message: '对账记录不存在' })
      }
      return res.json({ success: true, data: record.toJSON() })
    } catch (error) {
      return respondDbError(res, error, {
        logLabel: '查询对账记录详情失败',
        fallbackMessage: '查询对账记录详情失败',
        logger
      })
    }
  }

  /**
   * 标记核对结论。
   *
   * 只改台账行本身 —— 不触碰任何订单/库存/积分/券（边界见类注释）。
   */
  static async update (req, res) {
    try {
      const id = parseId(req.params.id)
      if (!id) {
        return res.status(400).json({ success: false, message: '无效的记录 ID' })
      }

      const record = await PaymentReconciliationRecord.findByPk(id)
      if (!record) {
        return res.status(404).json({ success: false, message: '对账记录不存在' })
      }

      const {
        reconcile_status: status,
        received_amount: receivedAmount,
        bank_ref: bankRef,
        note
      } = req.body || {}

      if (!RECONCILE_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `核对状态无效（应为 ${RECONCILE_STATUSES.join(' / ')}）`
        })
      }

      // 实收金额：只接受合法数字；未填时按状态给默认值（已收款 → 应收额）
      let nextReceived = null
      if (receivedAmount !== undefined && receivedAmount !== null && receivedAmount !== '') {
        const n = Number(receivedAmount)
        if (!Number.isFinite(n) || n < 0) {
          return res.status(400).json({ success: false, message: '实收金额不合法' })
        }
        nextReceived = n
      } else if (status === 'received') {
        nextReceived = Number(record.total_amount_thb) || Number(record.amount) || 0
      }

      const before = {
        reconcile_status: record.reconcile_status,
        received_amount: record.received_amount != null ? Number(record.received_amount) : null,
        bank_ref: record.bank_ref
      }

      record.reconcile_status = status
      record.received_amount = nextReceived
      record.bank_ref = bankRef != null ? String(bankRef).trim() || null : record.bank_ref
      record.note = note != null ? String(note).trim() || null : record.note
      record.reconciled_by = req.admin?.id || null
      record.reconciled_by_label = req.admin?.username || null
      record.reconciled_at = new Date()
      await record.save()

      // 留审计：谁在什么时候把哪一单标成了什么结论
      await AuditLog.create({
        actor_type: 'admin',
        actor_id: req.admin?.id != null ? String(req.admin.id) : null,
        actor_label: req.admin?.username || null,
        event: 'reconciliation.reviewed',
        resource: 'payment_reconciliation_record',
        resource_id: String(record.id),
        success: true,
        detail: {
          order_no: record.order_no,
          order_type: record.order_type,
          before,
          after: {
            reconcile_status: status,
            received_amount: nextReceived,
            bank_ref: record.bank_ref
          }
        }
      })

      return res.json({
        success: true,
        message: '核对结论已保存',
        data: record.toJSON()
      })
    } catch (error) {
      return respondDbError(res, error, {
        logLabel: '保存对账结论失败',
        fallbackMessage: '保存对账结论失败',
        logger
      })
    }
  }

  /**
   * 导出（csv / xlsx 双格式）。
   *
   * 财务对账吃的是 CSV（ERP 能导），所以两种都给。
   */
  static async exportRecords (req, res) {
    try {
      const status = req.query.status != null ? String(req.query.status).trim() : ''
      const orderType = req.query.order_type != null ? String(req.query.order_type).trim() : ''
      const keyword = req.query.order_no != null ? String(req.query.order_no).trim() : ''

      const where = {}
      if (status && RECONCILE_STATUSES.includes(status)) where.reconcile_status = status
      if (orderType === 'retail' || orderType === 'partner') where.order_type = orderType
      if (keyword) where.order_no = { [Op.like]: likeContains(keyword) }
      const filtered = applyCreatedBetween(
        where,
        { start_date: req.query.start_date, end_date: req.query.end_date },
        { timezone: await getBusinessTimezone(), column: 'swept_at' }
      )

      // 多取 1 行判断是否截断
      let records = await PaymentReconciliationRecord.findAll({
        where: filtered,
        order: [['swept_at', 'DESC'], ['id', 'DESC']],
        limit: EXPORT_ROW_LIMIT + 1
      })
      const truncated = records.length > EXPORT_ROW_LIMIT
      if (truncated) records = records.slice(0, EXPORT_ROW_LIMIT)

      const flat = records.map((r) => {
        const j = r.toJSON()
        const items = Array.isArray(j.items_snapshot) ? j.items_snapshot : []
        return {
          订单号: j.order_no,
          订单类型: ORDER_TYPE_ZH[j.order_type] || j.order_type,
          应收金额: j.total_amount_thb != null ? parseFloat(j.total_amount_thb) : null,
          币种: j.currency_code || 'THB',
          实收金额: j.received_amount != null ? parseFloat(j.received_amount) : null,
          差额: j.received_amount != null && j.total_amount_thb != null
            ? parseFloat(j.received_amount) - parseFloat(j.total_amount_thb)
            : null,
          核对结论: RECONCILE_STATUS_ZH[j.reconcile_status] || j.reconcile_status,
          凭证号: sanitizeCell(j.bank_ref ?? ''),
          商品明细: sanitizeCell(
            items.map((it) => `${it.name || ''} ×${it.quantity || 0}`).join('; ')
          ),
          收货人: sanitizeCell(j.contact_name ?? ''),
          联系电话: sanitizeCell(j.contact_phone ?? ''),
          送货地址: sanitizeCell((j.delivery_address ?? '').replace(/\n/g, ' ')),
          下单人: sanitizeCell(j.user_label ?? ''),
          客户备注: sanitizeCell(j.notes ?? ''),
          核对备注: sanitizeCell(j.note ?? ''),
          下单时间: formatLocal(j.order_created_at),
          被清时间: formatLocal(j.swept_at),
          核对人: sanitizeCell(j.reconciled_by_label ?? ''),
          核对时间: formatLocal(j.reconciled_at)
        }
      })

      const day = new Date().toISOString().split('T')[0]
      const wantCsv = String(req.query.format || '').toLowerCase() === 'csv'

      if (wantCsv) {
        const headers = flat.length ? Object.keys(flat[0]) : []
        const lines = [headers.map(csvCell).join(',')]
        for (const row of flat) {
          lines.push(headers.map(h => csvCell(row[h])).join(','))
        }
        if (truncated) {
          lines.push(csvCell(`数据量超过上限，仅导出前 ${EXPORT_ROW_LIMIT} 行`))
        }
        // BOM：Excel 打开中文不乱码
        const csv = '﻿' + lines.join('\r\n')
        const fn = `支付对账_${day}.csv`
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fn)}`)
        return res.send(csv)
      }

      const workbook = XLSX.utils.book_new()
      const sheet = XLSX.utils.json_to_sheet(flat.length ? flat : [{}])
      if (truncated) appendTruncationNote(sheet)
      XLSX.utils.book_append_sheet(workbook, sheet, 'reconciliation')

      const buffer = await XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
      const fn = `支付对账_${day}.xlsx`
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fn)}`)
      return res.send(buffer)
    } catch (error) {
      return respondDbError(res, error, {
        logLabel: '导出对账台账失败',
        fallbackMessage: '导出对账台账失败',
        logger
      })
    }
  }
}

/** 本地时间 yyyy-MM-dd HH:mm:ss */
function formatLocal (value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export default ReconciliationController
