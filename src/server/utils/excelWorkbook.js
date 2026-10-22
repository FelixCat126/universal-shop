import ExcelJS from 'exceljs'

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
