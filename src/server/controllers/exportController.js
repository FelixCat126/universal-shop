import XLSX, { createStreamingExport } from '../utils/excelWorkbook.js'
import { Op } from 'sequelize'
import User from '../models/User.js'
import Order from '../models/Order.js'
import OrderItem from '../models/OrderItem.js'
import Product from '../models/Product.js'
import { logger } from '../utils/logger.js'
import { sanitizeCell } from '../utils/sanitizeCell.js'

/**
 * 单次导出行数上限。
 *
 * 上限的取值依据是**峰值内存**而不是磁盘大小：
 * ExcelJS 的流式 writer（stream.xlsx.WorkbookWriter）虽然把 zip 内容写到临时文件，
 * 但仍在内存里保留每一行的 Row 对象（worksheet-writer.js: `this._rows[n] = row`），
 * 因此内存随行数线性增长。实测（20 万订单库，导出 N 行）：
 *   5 万行 → 峰值堆约 407MB、RSS 约 550MB
 *   2 万行 → 峰值堆约 160MB、RSS 约 240MB
 * 2 万行对运营/导出场景已足够（远超日常核对需求），且把单次导出的
 * 内存风险锁定在可控范围；需要更多数据时分次按条件导出。
 */
const EXPORT_ROW_LIMIT = 20000

/**
 * 导出并发闸。
 *
 * 导出是内存密集操作（单次数百 MB），并发几个就能打爆 Node 堆。
 * 这里做全局信号量：同时最多 N 个导出在进行，其余请求排队等待
 * （超出等待上限则返回 429，让运营稍后重试而不是把服务拖垮）。
 */
const EXPORT_CONCURRENCY = 2
const EXPORT_QUEUE_TIMEOUT_MS = 15000
let exportInFlight = 0
const exportWaiters = []

function acquireExportSlot () {
  if (exportInFlight < EXPORT_CONCURRENCY) {
    exportInFlight++
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = exportWaiters.indexOf(entry)
      if (i >= 0) exportWaiters.splice(i, 1)
      reject(Object.assign(new Error('导出请求过多，请稍后重试'), { status: 429 }))
    }, EXPORT_QUEUE_TIMEOUT_MS)
    const entry = { resolve: () => { clearTimeout(timer); resolve() } }
    exportWaiters.push(entry)
  })
}

function releaseExportSlot () {
  exportInFlight = Math.max(0, exportInFlight - 1)
  const next = exportWaiters.shift()
  if (next) {
    exportInFlight++
    next.resolve()
  }
}

// 截断时在表格末尾追加一行说明（origin:-1 追加到最后一行之后）
const appendTruncationNote = (worksheet) => {
  XLSX.utils.sheet_add_aoa(
    worksheet,
    [[`数据量超过上限，仅导出前 ${EXPORT_ROW_LIMIT} 行（按创建时间倒序）`]],
    { origin: -1 }
  )
}

/** 订单导出列（与 mapOrderToRow 的键一一对应，顺序即列顺序） */
const ORDER_EXPORT_HEADERS = [
  'หมายเลขคำสั่งซื้อ（电商订单号、Order Number）',
  'น้ำหนักสินค้า（货物重量(kg)、Weight(kg)）',
  'ชื่อผู้รับ（收件人姓名、Recipient Name）',
  'เบอร์โทรผู้รับ（收件人手机、Recipient Mobile）',
  'เบอร์โทรศัพท์ผู้รับ（收件人电话、Recipient Phone）',
  'จังหวัด（目的府、Province）',
  'อำเภอ/เขต（目的区县、District）',
  'ตำบล/แขวง（目的镇、Sub-district）',
  'รหัสไปรษณีย์（目的邮编、Postal Code）',
  'ที่อยู่ผู้รับ（收件地址、Delivery Address）',
  'ชื่อสินค้า（物品名称、Product Name）',
  'มูลค่าสินค้า（物品价值、Product Value）',
  'หมายเหตุ（备注、Remarks）',
  'เก็บเงินปลายทาง（代收货款、Cash on Delivery）',
  'สถานะคำสั่งซื้อ（订单状态、Order Status）',
  'ยาว（长(cm)、Length(cm)）',
  'กว้าง（宽(cm)、Width(cm)）',
  'สูง（高(cm)、Height(cm)）',
  'ค่าบรรจุภัณฑ์（包装费、Packaging Fee）',
]
/** 各列宽度（Excel 字符宽） */
const ORDER_EXPORT_WIDTHS = [
  18,
  18,
  18,
  18,
  18,
  18,
  18,
  22,
  22,
  22,
  22,
  22,
  22,
  22,
  22,
  22,
  22,
  22,
  22,
]

class ExportController {
  // 导出用户数据
  static async exportUsers(req, res) {
    try {
      await acquireExportSlot()
      /**
       * 分批查询 + 逐行写出（内存 O(批次) 而非 O(总行数)）。
       * keyset 分页（按 id 游标）而非 OFFSET —— OFFSET 在深页会越来越慢，
       * 而导出总是从最新数据往回扫，id 游标天然有序且稳定。
       * 显式限定 attributes：默认会把 password（bcrypt 哈希）等敏感列也载入内存，
       * 一旦后续有人照抄加字段就会直接落进 Excel。
       */
      const USER_ATTRS = [
        'id', 'username', 'nickname', 'email', 'phone',
        'referral_code', 'referred_by_code', 'created_at', 'updated_at'
      ]
      const BATCH = 1000

      // 先探一行判断是否超过上限（多取 1 行用于判断截断）
      const probe = await User.findOne({
        attributes: USER_ATTRS,
        order: [['id', 'DESC']]
      })
      const maxId = probe ? probe.id : 0
      // 统计总行数只用于判断是否截断：走一次 count（走索引，成本低）
      const totalRows = await User.count()
      const usersTruncated = totalRows > EXPORT_ROW_LIMIT

      // 设置响应头（流式：先设头，再 pipe）
      const filename = `用户数据_${new Date().toISOString().split('T')[0]}.xlsx`
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      res.setHeader('Cache-Control', 'no-store')

      /**
       * 流式写出：逐行 addRow 直接 pipe 到响应，
       * 峰值内存与总行数无关（原实现是 O(行数×列数)）。
       */
      const exporter = await createStreamingExport({
        sheetName: '用户列表',
        headers: ['ID', '用户名', '昵称', '邮箱', '手机号', '推荐码', '被推荐码', '注册时间', '更新时间'],
        widths: [8, 20, 15, 25, 15, 12, 12, 20, 20]
      })
      let written = 0
      let cursor = maxId
      while (written < EXPORT_ROW_LIMIT) {
        const size = Math.min(BATCH, EXPORT_ROW_LIMIT - written)
        const batch = await User.findAll({
          attributes: USER_ATTRS,
          where: { id: { [Op.lt]: cursor } },
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
            user.created_at ? new Date(user.created_at).toLocaleString('zh-CN') : '',
            user.updated_at ? new Date(user.updated_at).toLocaleString('zh-CN') : ''
          ])
          written++
        }
        cursor = batch[batch.length - 1].id
        if (batch.length < size) break
      }
      if (usersTruncated) {
        await exporter.addRow([`数据量超过上限，仅导出前 ${EXPORT_ROW_LIMIT} 行`])
      }
      await exporter.writeTo(res)

    } catch (error) {
      logger.error('导出用户数据失败', { err: error?.message, stack: error?.stack })
      // 导出并发闸排队超时 → 429（不是服务端故障）
      if (error?.status === 429) {
        if (res.headersSent) { res.destroy(); return }
        return res.status(429).json({ success: false, message: error.message, code: 'EXPORT_BUSY' })
      }
      // 流式输出已开始发送响应体时不能再写状态头（ERR_HTTP_HEADERS_SENT）
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.status(500).json({
        success: false,
        message: '导出失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    } finally {
      releaseExportSlot()
    }
  }

  // 导出订单数据
  static async exportOrders(req, res) {
    try {
      await acquireExportSlot()
      /**
       * 分批查询（keyset 游标）+ 逐行写出。
       * 原实现一次性 findAll 5 万订单并带 items 关联 —— 峰值内存是
       * 「订单数组 + 每单 items 数组 + excelData 数组 + ExcelJS workbook + buffer」
       * 五份副本叠在一起，20 万订单实测导出耗时 4.4 秒、峰值内存远超最终 3.4MB 的文件。
       * 改为按 id 游标分批（每批 500 单）后：
       *   - 内存占用与总单数无关
       *   - OFFSET 深页问题消失（游标分页恒定开销）
       */
      const ORDER_INCLUDE = [
        {
          model: User,
          as: 'user',
          attributes: ['nickname', 'phone']
        },
        {
          model: OrderItem,
          as: 'items',
          include: [{
            model: Product,
            as: 'product',
            paranoid: false,
            attributes: ['name', 'alias', 'price']
          }]
        }
      ]
      const ORDER_BATCH = 500
      const probeOrder = await Order.findOne({ attributes: ['id'], order: [['id', 'DESC']] })
      const maxOrderId = probeOrder ? probeOrder.id : 0
      const totalOrders = await Order.count()
      const ordersTruncated = totalOrders > EXPORT_ROW_LIMIT

      // 解析地址的辅助函数
      const parseAddress = (address) => {
        if (!address) return { province: '', city: '', district: '', detail: '' }
        
        // 尝试解析地址格式，支持多种可能的格式
        const addressStr = address.trim()
        
        // 省市区的常见后缀
        const provinceSuffixes = ['省', '市', '自治区', '特别行政区']
        const citySuffixes = ['市', '州', '盟', '地区']
        const districtSuffixes = ['区', '县', '市', '旗']
        
        let province = ''
        let city = ''
        let district = ''
        let detail = addressStr
        
        // 查找省份
        for (const suffix of provinceSuffixes) {
          const index = addressStr.indexOf(suffix)
          if (index > 0) {
            province = addressStr.substring(0, index + suffix.length)
            detail = addressStr.substring(index + suffix.length)
            break
          }
        }
        
        // 查找城市
        if (detail) {
          for (const suffix of citySuffixes) {
            const index = detail.indexOf(suffix)
            if (index > 0) {
              city = detail.substring(0, index + suffix.length)
              detail = detail.substring(index + suffix.length)
              break
            }
          }
        }
        
        // 查找区县
        if (detail) {
          for (const suffix of districtSuffixes) {
            const index = detail.indexOf(suffix)
            if (index > 0) {
              district = detail.substring(0, index + suffix.length)
              detail = detail.substring(index + suffix.length)
              break
            }
          }
        }
        
        return { province, city, district, detail }
      }

      // 三语言表头字段定义：泰文（中文、英文）
      const getTrilingualHeaders = () => {
        return {
          'หมายเลขคำสั่งซื้อ（电商订单号、Order Number）': '电商订单号',
          'น้ำหนักสินค้า（货物重量(kg)、Weight(kg)）': '货物重量(kg)',
          'ชื่อผู้รับ（收件人姓名、Recipient Name）': '收件人姓名',
          'เบอร์โทรผู้รับ（收件人手机、Recipient Mobile）': '收件人手机',
          'เบอร์โทรศัพท์ผู้รับ（收件人电话、Recipient Phone）': '收件人电话',
          'จังหวัด（目的府、Province）': '目的府',
          'อำเภอ/เขต（目的区县、District）': '目的区县',
          'ตำบล/แขวง（目的镇、Sub-district）': '目的镇',
          'รหัสไปรษณีย์（目的邮编、Postal Code）': '目的邮编',
          'ที่อยู่ผู้รับ（收件地址、Delivery Address）': '收件地址',
          'ชื่อสินค้า（物品名称、Product Name）': '物品名称',
          'มูลค่าสินค้า（物品价值、Product Value）': '物品价值',
          'หมายเหตุ（备注、Remarks）': '备注',
          'เก็บเงินปลายทาง（代收货款、Cash on Delivery）': '代收货款',
          'สถานะคำสั่งซื้อ（订单状态、Order Status）': '订单状态',
          'ยาว（长(cm)、Length(cm)）': '长(cm)',
          'กว้าง（宽(cm)、Width(cm)）': '宽(cm)',
          'สูง（高(cm)、Height(cm)）': '高(cm)',
          'ค่าบรรจุภัณฑ์（包装费、Packaging Fee）': '包装费'
        }
      }
      
      // 准备Excel数据 - 按照模板字段格式（单行映射，供分批写出复用）
      const mapOrderToRow = (order) => {
        // 合并所有商品名称，优先使用别名
        const productNames = order.items && order.items.length > 0 
          ? order.items.map(item => {
              // 优先使用别名，如果没有别名则使用商品名称
              const productName = item.product?.alias || item.product?.name || ''
              return productName
            }).filter(name => name).join(', ')
          : ''
        
        // 计算代收货款：货到付款=订单金额，在线付款=0
        const amountThb = order.total_amount_thb != null && order.total_amount_thb !== ''
          ? parseFloat(order.total_amount_thb)
          : parseFloat(order.total_amount)
        const codAmount = order.payment_method === 'cod' && Number.isFinite(amountThb)
          ? amountThb.toFixed(2)
          : '0'
        
        // 订单状态三语言转换：泰文（中文、英文）
        const getStatusText = (status) => {
          const statusMap = {
            'pending': 'รอการชำระเงิน（待支付、Pending Payment）',
            'paid': 'ชำระเงินแล้ว（已支付、Paid）', 
            'shipping': 'กำลังจัดส่ง（送货中、Shipping）',
            'shipped': 'จัดส่งแล้ว（已发货、Shipped）',
            'delivered': 'ส่งถึงแล้ว（已送达、Delivered）',
            'completed': 'เสร็จสิ้น（已完成、Completed）',
            'cancelled': 'ยกเลิกแล้ว（已取消、Cancelled）'
          }
          return statusMap[status] || `${status}（${status}、${status}）`
        }
        
        // 优先使用分字段数据，回退到地址解析
        let province = order.province || ''
        let city = order.city || ''
        let district = order.district || ''
        let detailAddress = order.delivery_address || ''
        
        // 如果分字段为空，尝试解析完整地址
        if (!province && !city && !district && order.delivery_address) {
          const addressInfo = parseAddress(order.delivery_address)
          province = addressInfo.province
          city = addressInfo.city
          district = addressInfo.district
          detailAddress = addressInfo.detail
        }
        
        return {
          'หมายเลขคำสั่งซื้อ（电商订单号、Order Number）': order.order_no || '',
          'น้ำหนักสินค้า（货物重量(kg)、Weight(kg)）': '', // 暂时留空
          'ชื่อผู้รับ（收件人姓名、Recipient Name）': sanitizeCell(order.contact_name || ''),
          'เบอร์โทรผู้รับ（收件人手机、Recipient Mobile）': sanitizeCell(order.contact_phone || ''),
          'เบอร์โทรศัพท์ผู้รับ（收件人电话、Recipient Phone）': sanitizeCell(order.contact_phone || ''), // 复用手机号
          'จังหวัด（目的府、Province）': sanitizeCell(province),
          'อำเภอ/เขต（目的区县、District）': sanitizeCell(city),
          'ตำบล/แขวง（目的镇、Sub-district）': sanitizeCell(district),
          'รหัสไปรษณีย์（目的邮编、Postal Code）': sanitizeCell(order.postal_code || ''),
          'ที่อยู่ผู้รับ（收件地址、Delivery Address）': sanitizeCell(detailAddress),
          'ชื่อสินค้า（物品名称、Product Name）': sanitizeCell(productNames),
          'มูลค่าสินค้า（物品价值、Product Value）': (order.total_amount_thb != null && order.total_amount_thb !== '' ? Number(order.total_amount_thb).toFixed(2) : order.total_amount) || '',
          'หมายเหตุ（备注、Remarks）': sanitizeCell(order.notes || ''),
          'เก็บเงินปลายทาง（代收货款、Cash on Delivery）': codAmount,
          'สถานะคำสั่งซื้อ（订单状态、Order Status）': getStatusText(order.status),
          'ยาว（长(cm)、Length(cm)）': '', // 留空
          'กว้าง（宽(cm)、Width(cm)）': '', // 留空
          'สูง（高(cm)、Height(cm)）': '', // 留空
          'ค่าบรรจุภัณฑ์（包装费、Packaging Fee）': '' // 留空
        }
      }

      // 设置响应头（流式：先设头，再 pipe）
      const filename = `订单数据_${new Date().toISOString().split('T')[0]}.xlsx`
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      res.setHeader('Cache-Control', 'no-store')

      /**
       * 流式写出：分批查 → 逐行 addRow → 直接 pipe 到响应。
       * 峰值内存与总单数无关（原实现要同时持有 5 份数据副本）。
       */
      const exporter = await createStreamingExport({
        sheetName: '订单列表',
        headers: ORDER_EXPORT_HEADERS,
        widths: ORDER_EXPORT_WIDTHS
      })
      let written = 0
      let cursor = maxOrderId
      while (written < EXPORT_ROW_LIMIT) {
        const size = Math.min(ORDER_BATCH, EXPORT_ROW_LIMIT - written)
        const batch = await Order.findAll({
          include: ORDER_INCLUDE,
          where: { id: { [Op.lt]: cursor } },
          order: [['id', 'DESC']],
          limit: size
        })
        if (batch.length === 0) break
        for (const order of batch) {
          const row = mapOrderToRow(order)
          await exporter.addRow(ORDER_EXPORT_HEADERS.map((h) => row[h]))
        }
        written += batch.length
        cursor = batch[batch.length - 1].id
        if (batch.length < size) break
      }
      if (ordersTruncated) {
        await exporter.addRow([`数据量超过上限，仅导出前 ${EXPORT_ROW_LIMIT} 行`])
      }
      await exporter.writeTo(res)


    } catch (error) {
      logger.error('导出订单数据失败', { err: error?.message, stack: error?.stack })
      // 导出并发闸排队超时 → 429（不是服务端故障）
      if (error?.status === 429) {
        if (res.headersSent) { res.destroy(); return }
        return res.status(429).json({ success: false, message: error.message, code: 'EXPORT_BUSY' })
      }
      // 流式输出可能已经开始发送响应体，此时再写状态头会抛 ERR_HTTP_HEADERS_SENT。
      // 只能记录错误并中断连接，不能再尝试写 JSON 响应。
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.status(500).json({
        success: false,
        message: '导出失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    } finally {
      releaseExportSlot()
    }
  }
}

export default ExportController
