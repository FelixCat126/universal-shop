import ExcelJS from 'exceljs'
import fsSync from 'fs'

/**
 * 轻量 SheetJS 兼容写适配器（仅覆盖本项目导出所需的 API）。
 * 用 ExcelJS 替代存在已知漏洞且长期未维护的 xlsx 包。
 */

function columnLetter (index) {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function newSheet (rows) {
  return {
    __rows: Array.isArray(rows) ? rows : [],
    __extraRows: [],
    '!cols': []
  }
}

async function writeWorkbook (workbook) {
  const out = new ExcelJS.Workbook()
  for (const entry of workbook.__sheets) {
    const ws = out.addWorksheet(entry.name)
    const rows = entry.sheet.__rows
    const first = rows[0] || {}
    const keys = Object.keys(first)
    ws.columns = keys.map((key, i) => ({
      key,
      header: key,
      width: entry.sheet['!cols']?.[i]?.width || 22
    }))
    for (const row of rows) ws.addRow(row)
    for (const extra of entry.sheet.__extraRows) ws.addRow(extra)

    if (rows.length > 0 || keys.length > 0) {
      const header = ws.getRow(1)
      header.font = { bold: true }
      header.alignment = { horizontal: 'center', vertical: 'center' }
      header.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD0D0D0' }
      }
    }
  }
  if (workbook.__sheets.length === 0) out.addWorksheet('Sheet1')
  return out.xlsx.writeBuffer()
}

const XLSX = {
  utils: {
    book_new () {
      return { __sheets: [] }
    },
    json_to_sheet (rows) {
      return newSheet(rows)
    },
    book_append_sheet (workbook, sheet, name) {
      workbook.__sheets.push({ name, sheet })
    },
    sheet_add_aoa (sheet, rows) {
      sheet.__extraRows.push(...rows)
    },
    encode_cell ({ r, c }) {
      return `${columnLetter(c)}${r + 1}`
    }
  },
  async write (workbook) {
    return writeWorkbook(workbook)
  }
}

export default XLSX

/**
 * 流式导出器（ExcelJS stream.xlsx.WorkbookWriter —— 基于临时文件的真流式写）。
 *
 * 解决的问题：导出原本一次性 findAll 全部行 → 映射成数组 → 写进 ExcelJS workbook
 * → writeBuffer() 再生成完整 buffer，峰值内存约「行数 × 列数 × 常数倍」。
 * 20 万订单实测：导出 5 万行峰值堆 672MB（最终文件仅 3.3MB），
 * 并发几个导出就可能打爆 Node 堆。
 *
 * 注意：ExcelJS 的 addWorksheet(..., {headers}) 流式模式**仍会在内存累积行**，
 * 只有 stream.xlsx.WorkbookWriter 才是基于临时文件的真流式（内存恒定）。
 *
 * 用法：
 *   const exp = await createStreamingExport({ sheetName, headers, widths })
 *   await exp.addRow([...])
 *   await exp.writeTo(res)   // 内部写临时文件 → pipe → 清理
 */
export async function createStreamingExport ({ sheetName, headers, widths = [] }) {
  const os = await import('os')
  const path = await import('path')
  const fs = await import('fs/promises')
  const crypto = await import('crypto')

  const tmpDir = path.join(os.tmpdir(), 'shop-exports')
  await fs.mkdir(tmpDir, { recursive: true })
  const tmpFile = path.join(tmpDir, `export-${crypto.randomUUID()}.xlsx`)

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: tmpFile, useStyles: false })
  const sheet = workbook.addWorksheet(sheetName, {
    headers,
    useSharedStrings: false,
    useStyles: false
  })
  if (widths.length) {
    sheet.columns = headers.map((header, i) => ({
      header,
      key: `c${i}`,
      width: widths[i] || 18
    }))
  }
  // 表头样式（流式下 useStyles:false，需单独设置一次）
  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.alignment = { horizontal: 'center', vertical: 'center' }

  return {
    async addRow (values) {
      sheet.addRow(values)
    },
    async writeTo (stream) {
      await workbook.commit()
      await new Promise((resolve, reject) => {
        const rs = fsSync.createReadStream(tmpFile)
        rs.on('error', reject)
        stream.on('error', reject)
        rs.on('end', () => resolve())
        rs.pipe(stream)
      })
      // 清理临时文件（失败不阻塞主流程）
      await fs.unlink(tmpFile).catch(() => {})
    }
  }
}
