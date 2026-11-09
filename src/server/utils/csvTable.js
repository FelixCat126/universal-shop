/**
 * 通用 CSV 表格解析
 *
 * 商品导入、合作方导入用的是同一套解析逻辑（表头归一 + 引号处理 + 空行跳过），
 * 各写一遍必然漂移 —— 所以抽到这里，**只解析，不管业务**。
 *
 * 业务语义（哪些列必填、怎么校验、怎么落库）留给各自的 service。
 */
import ExcelJS from 'exceljs'
import { Readable } from 'node:stream'

/** 一次最多多少行 —— 防止误传的大文件把服务拖垮 */
export const DEFAULT_MAX_ROWS = 500

/** 文件大小上限（字节） */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

/**
 * 表头归一：把各种写法的表头映射到标准列名。
 *
 * 运营手搓的 CSV 表头五花八门（"商品名称"/"品名"/"name"），
 * 认几个常见写法能省掉大量"导进来发现列不对"的来回。
 *
 * @param {Array<{col: number, header: unknown}>} entries 表头单元格（col 是 1-based 列号）
 * @param {Record<string, string[]>} aliases 标准列名 → 别名列表（小写比较）
 * @returns {{map: Record<string, {col: number, header: string}>, unknown: string[]}}
 */
export function normalizeCsvHeaders (entries, aliases) {
  const map = {}
  const unknown = []
  for (const entry of entries) {
    const col = entry?.col
    const raw = entry?.header
    if (!col) continue
    const h = String(raw ?? '').trim().toLowerCase()
    if (!h) continue
    let matched = null
    for (const [canonical, names] of Object.entries(aliases)) {
      if (names.some(a => a.toLowerCase() === h)) {
        matched = canonical
        break
      }
    }
    if (matched) {
      // 同一个标准列出现两次 → 以第一次为准
      if (!(matched in map)) map[matched] = { col, header: String(raw) }
    } else {
      unknown.push(String(raw))
    }
  }
  return { map, unknown }
}

/**
 * 解析 CSV 文本 → 行数组（不含表头）。
 *
 * 用 ExcelJS 解析：引号里的逗号/换行、BOM、CRLF 都由它处理 ——
 * 这些是手写解析器最容易出错的地方。
 *
 * @param {Buffer} buffer
 * @param {object} options
 * @param {Record<string, string[]>} options.aliases 标准列名 → 别名
 * @param {string[]} options.required 必填的标准列
 * @param {number} [options.maxRows]
 * @param {number} [options.maxBytes]
 * @returns {Promise<{headers: string[], unknownHeaders: string[], rows: Array<{rowNumber: number, cells: Record<string, any>}>}>}
 */
export async function parseCsvTable (buffer, options) {
  const {
    aliases,
    required = [],
    maxRows = DEFAULT_MAX_ROWS,
    maxBytes = DEFAULT_MAX_BYTES
  } = options || {}

  if (!buffer || buffer.length === 0) {
    throw Object.assign(new Error('文件为空'), { status: 400 })
  }
  if (buffer.length > maxBytes) {
    throw Object.assign(
      new Error(`文件过大（上限 ${Math.round(maxBytes / 1024 / 1024)}MB）`),
      { status: 400 }
    )
  }

  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.csv.read(Readable.from([buffer]))
  } catch (e) {
    throw Object.assign(new Error(`CSV 解析失败：${e.message}`), { status: 400 })
  }

  const sheet = workbook.worksheets[0]
  if (!sheet || sheet.rowCount < 1) {
    throw Object.assign(new Error('CSV 里没有数据'), { status: 400 })
  }

  // 表头行：收集每个表头单元格的**列号**（ExcelJS 的 getCell 不能用表头字符串取值，
  // 它会把字符串当列字母去找列）
  const headerRow = sheet.getRow(1)
  const headerEntries = []
  const headers = []
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headerEntries.push({ col, header: cell.value })
    headers[col] = cell.value
  })

  const { map, unknown } = normalizeCsvHeaders(headerEntries, aliases)

  const missing = required.filter(c => !(c in map))
  if (missing.length > 0) {
    throw Object.assign(
      new Error(`CSV 缺少必填列：${missing.join('、')}`),
      { status: 400, missing, unknownHeaders: unknown }
    )
  }

  const total = sheet.rowCount - 1
  if (total > maxRows) {
    throw Object.assign(
      new Error(`一次最多导入 ${maxRows} 行（当前 ${total} 行）`),
      { status: 400 }
    )
  }

  const rows = []
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const cells = {}
    let hasValue = false
    for (const [canonical, { col }] of Object.entries(map)) {
      let value = null
      if (col) {
        const cell = row.getCell(col)
        value = cell.value
        // ExcelJS 的富文本/公式/超链接对象 → 取文本
        if (value && typeof value === 'object') {
          if (value.text != null) value = value.text
          else if (value.result != null) value = value.result
          else if (Array.isArray(value.richText)) value = value.richText.map(t => t.text).join('')
          else if (value.hyperlink != null) value = value.hyperlink
          else value = null
        }
      }
      if (value !== null && value !== undefined && String(value).trim() !== '') hasValue = true
      cells[canonical] = value
    }
    // 整行都是空 → 跳过（Excel 里常见的空行）
    if (!hasValue) continue
    rows.push({ rowNumber: r, cells })
  }

  return {
    headers: headers.filter(Boolean),
    unknownHeaders: unknown,
    rows
  }
}
