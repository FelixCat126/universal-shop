/**
 * 流式 CSV 导出写入器
 *
 * 为什么要有（xlsx 之外还要 CSV）：
 *   - **财务对账**用 CSV：财务/会计的工具链（QuickBooks、ERP、数据库导入）
 *     吃 CSV，不吃 xlsx；每月对账导出 xlsx 还得手工再转一次
 *   - CSV 体积约为 xlsx 的 1/5~1/10，10 万行时差别很明显
 *   - 可以直接 `|` 分隔塞进邮件/IM，不用上传附件
 *
 * 与 ExcelJS 的流式导出**同一套接口**（addRow / writeTo / writeToFile），
 * 上层导出任务只需要按格式二选一，不用改业务代码。
 *
 * 两个必须做对的细节：
 *   1) **BOM**：Excel 打开 UTF-8 CSV 不带 BOM 会把中文认成乱码，
 *      用户看到一堆乱码会以为导出坏了。
 *   2) **公式注入防护**：字段以 `=` `+` `-` `@` 开头时，Excel/WPS 会当公式
 *      执行（DDE 风险，可触发外部链接请求或本机命令）。
 *      复用已有的 sanitizeCell（它精确处理了 "+66812345678" 这类
 *      泰国手机号不能被污染的情况）。
 */
import fsSync from 'fs'

/**
 * CSV 字段转义。
 * @param {unknown} value
 * @returns {string}
 */
export function csvCell (value) {
  if (value === null || value === undefined) return ''
  let s = String(value)
  // 公式注入防护（= + @ | 开头，以及控制字符/零宽字符绕过）
  s = sanitizeCsvCell(s)
  // 含分隔符/引号/换行 → 用引号包起来，内部引号翻倍
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/** 公式注入防护（与 utils/sanitizeCell.js 同一套规则） */
function sanitizeCsvCell (value) {
  if (typeof value !== 'string' || value.length === 0) return value
  const FORMULA_START = /^\s*[=@|]/
  const SIGN_FORMULA = /^\s*[+-](?![0-9]\s*$)/
  const CONTROL_PREFIX = /^[\x00-\x1f\x7f]/
  const ZERO_WIDTH = /^[\uFEFF\u200B-\u200D\u2060]/g
  const probe = value.replace(ZERO_WIDTH, '')
  if (FORMULA_START.test(probe) || CONTROL_PREFIX.test(probe)) {
    return `'${value}`
  }
  if (/^\s*[+-]/.test(probe) && !/^\s*[+-]?\d+(\.\d+)?\s*$/.test(probe)) {
    return `'${value}`
  }
  return value
}

/**
 * 创建流式 CSV 导出器。
 *
 * @param {{ headers: string[], delimiter?: string }} options
 * @returns {Promise<{addRow: (values: unknown[]) => Promise<void>, writeTo: (stream) => Promise<void>, writeToFile: (target: string) => Promise<{size: number}>}>}
 */
export async function createStreamingCsvExport ({ headers = [], delimiter = ',' } = {}) {
  const os = await import('os')
  const path = await import('path')
  const fs = await import('fs/promises')
  const crypto = await import('crypto')

  const tmpDir = path.join(os.tmpdir(), 'shop-exports')
  await fs.mkdir(tmpDir, { recursive: true })
  const tmpFile = path.join(tmpDir, `export-${crypto.randomUUID()}.csv`)

  // 直接写文件（不用 stream writer：CSV 是纯文本，顺序追加写最快）
  const handle = await fs.open(tmpFile, 'w')
  // BOM：Excel 打开中文不乱码
  await handle.write('﻿', null, 'utf8')
  await handle.write(headers.map(csvCell).join(delimiter) + '\r\n', null, 'utf8')

  return {
    async addRow (values) {
      const line = values.map(csvCell).join(delimiter) + '\r\n'
      await handle.write(line, null, 'utf8')
    },

    /** 输出到 HTTP 响应（同步导出用）：pipe 临时文件给客户端后清理 */
    async writeTo (stream) {
      await handle.close()
      await new Promise((resolve, reject) => {
        const rs = fsSync.createReadStream(tmpFile)
        rs.on('error', reject)
        stream.on('error', reject)
        rs.on('end', () => resolve())
        rs.pipe(stream)
      })
      await fs.unlink(tmpFile).catch(() => {})
    },

    /** 输出到文件（异步导出任务用）：返回文件大小 */
    async writeToFile (target) {
      await handle.close()
      await fs.copyFile(tmpFile, target)
      const stat = await fs.stat(target)
      await fs.unlink(tmpFile).catch(() => {})
      return { size: stat.size }
    },

    /**
     * 放弃这次导出（失败路径必须调用）。
     *
     * 句柄与临时文件都是在**创建时**就打开/落盘的，只有 writeTo / writeToFile
     * 才会关掉它们 —— 导出中途失败（DB 超时、进程重启、ExcelJS 报错）时，
     * 这个 fd 与临时文件就**永久泄漏**：
     *   - fd 泄漏 → 累积到 ulimit 后，进程所有文件操作（日志落盘、上传、静态文件）一起失败
     *   - 临时文件泄漏 → 每次失败留一份（20 万行 xlsx 可达数十 MB），
     *     而清理任务只回收"ExportJob 表里有 file_path 的行"，**孤儿文件永远收不回来**
     */
    async abort () {
      try { await handle.close() } catch { /* 已关闭 */ }
      await fs.unlink(tmpFile).catch(() => {})
    }
  }
}
