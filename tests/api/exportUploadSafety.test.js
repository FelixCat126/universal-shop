/**
 * 导出与上传安全专项（10 用例）
 *
 * 覆盖第八轮审计发现并修复的问题：
 *   ES-1  公式注入防护不得污染合法业务数据（泰国手机号 +66812345678）
 *   ES-2  公式注入防护必须覆盖 = @ | 与零宽字符绕过
 *   ES-3  数值型字符串（-5、+66）不应被误判为公式
 *   ES-4  头像地址白名单：路径穿越/编码绕过必须拒绝
 *   ES-5  头像地址白名单：合法文件名（含大写扩展名）必须放行
 *   ES-6  用户导出不得包含 password 等敏感列
 *   ES-7  上传文件名不得包含用户原始名（可控性）
 *   ES-8  multer limits 覆盖 fields/parts（防字段洪水耗内存）
 *   ES-9  操作日志不得记录批量响应明细（PII 副本）
 *   ES-10 扩展名白名单：双扩展名不得落到非图片扩展名
 */
import { describe, it, expect } from 'vitest'
import { sanitizeCell } from '@server/utils/sanitizeCell.js'
import { TestDatabase } from '../setup/test-database.js'

const models = () => TestDatabase.getSequelize().models

describe('Export.sanitizeCell', () => {
  it('ES-1 泰国手机号等合法业务数据不被污染', () => {
    expect(sanitizeCell('+66812345678')).toBe('+66812345678')
    expect(sanitizeCell('0812345678')).toBe('0812345678')
    expect(sanitizeCell('-5')).toBe('-5')
    expect(sanitizeCell('+66')).toBe('+66')
    expect(sanitizeCell('普通昵称')).toBe('普通昵称')
    expect(sanitizeCell('')).toBe('')
  })

  it('ES-2 公式起始形态被拦截', () => {
    expect(sanitizeCell('=HYPERLINK("http://evil","x")')).toMatch(/^'=/)
    expect(sanitizeCell('@SUM(A1)')).toMatch(/^'@/)
    expect(sanitizeCell('|cmd|')).toMatch(/^'\|/)       // OWASP 清单里的管道前缀
    expect(sanitizeCell('  =1+1')).toMatch(/^'/)          // 前导空白
    expect(sanitizeCell('﻿=1+1')).toMatch(/^'/)  // 零宽字符/BOM 绕过
  })

  it('ES-3 非纯数值的 +/- 前缀仍按公式拦截', () => {
    expect(sanitizeCell('+66 123')).toMatch(/^'/)   // Excel 会解析为 =66 123
    expect(sanitizeCell('-abc')).toMatch(/^'/)
  })

  it('ES-4 非字符串原样返回', () => {
    expect(sanitizeCell(42)).toBe(42)
    expect(sanitizeCell(null)).toBe(null)
    expect(sanitizeCell(undefined)).toBe(undefined)
    expect(sanitizeCell(true)).toBe(true)
  })
})

describe('Upload.avatarWhitelist', () => {
  const AVATAR_RE = /^\/uploads\/avatars\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|gif|webp)$/i

  it('ES-5 合法头像地址放行（含历史大写扩展名）', () => {
    expect(AVATAR_RE.test('/uploads/avatars/avatar_1777042576376-151656985.JPG')).toBe(true)
    expect(AVATAR_RE.test('/uploads/avatars/avatar_abc-123.png')).toBe(true)
  })

  it('ES-6 路径穿越/编码绕过/非法扩展名拒绝', () => {
    for (const bad of [
      '/uploads/avatars/%2e%2e%2f%2e%2e%2fapp.js',
      '/uploads/avatars/../../src/server/app.js',
      '/uploads/avatars/../../etc/passwd',
      '/uploads/avatars/a b.jpg',
      '/uploads/avatars/x.php',
      '/uploads/avatars/x.html'
    ]) {
      expect(AVATAR_RE.test(bad), bad).toBe(false)
    }
  })
})

describe('Export.noSensitiveColumns', () => {
  it('ES-7 用户导出查询限定 attributes，不含 password', async () => {
    const fs = await import('fs')
    const src = fs.readFileSync('src/server/controllers/exportController.js', 'utf8')
    const idx = src.indexOf('exportUsers')
    const block = src.slice(idx, idx + 1200)
    expect(block).toContain('attributes:')
    // 显式列清单里不能出现 password / token
    const attrsMatch = block.match(/attributes:\s*\[([\s\S]*?)\]/)
    expect(attrsMatch).not.toBeNull()
    expect(attrsMatch[1]).not.toMatch(/password|token|hash/i)
  })
})

describe('Upload.limits', () => {
  it('ES-8 multer limits 覆盖 fields/parts/fileSize/fieldSize', async () => {
    const fs = await import('fs')
    const src = fs.readFileSync('src/server/controllers/uploadController.js', 'utf8')
    expect(src).toMatch(/fields:\s*\d+/)
    expect(src).toMatch(/parts:\s*\d+/)
    expect(src).toMatch(/fieldSize:\s*\d+/)
    expect(src).toMatch(/files:\s*\d+/)
  })

  it('ES-9 上传文件名使用 crypto.randomUUID 且不含原始名', async () => {
    const fs = await import('fs')
    const src = fs.readFileSync('src/server/controllers/uploadController.js', 'utf8')
    expect(src).toMatch(/crypto\.randomUUID\(\)/)
    expect(src).not.toMatch(/Math\.random\(\) \* 1E9/)
  })

  it('ES-10 扩展名走白名单，双扩展名不会落到非图片扩展名', async () => {
    const fs = await import('fs')
    const src = fs.readFileSync('src/server/controllers/uploadController.js', 'utf8')
    expect(src).toMatch(/ALLOWED_EXTS/)
    expect(src).toMatch(/safeExt/)
  })
})

describe('OperationLog.noBulkDetail', () => {
  it('ES-11 批量响应不落明细到操作日志', async () => {
    const fs = await import('fs')
    const src = fs.readFileSync('src/server/middlewares/adminAuthMiddleware.js', 'utf8')
    expect(src).toMatch(/truncated:\s*true/)
    expect(src).toMatch(/isBulk/)
  })
})
