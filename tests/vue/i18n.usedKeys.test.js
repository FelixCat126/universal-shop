/**
 * i18n **已用 key 覆盖**门禁（第 54 轮）
 * ====================================
 *
 * ## 为什么要有这条
 *
 * 现有的 `i18n.keyParity.test.js` 保证的是"**语言包彼此之间**键集一致"，
 * 但它**管不到"代码里 t() 用到的 key 是不是真的存在"**。
 *
 * 结果就是这种真实事故（2026-11-26 排查发现）：
 *
 *   - `common.noData` —— admin 端 **15 张表格**的"暂无数据"全部显示 `common.noData`
 *   - `common.loadFailed` —— portal 首页 + partner 商店的错误提示显示 key 原文
 *   - `products.messages.loadFailed` —— admin 商品页加载失败 toast 显示 key 原文
 *   - `common.copySuccess` —— admin 复制成功 toast 显示 key 原文
 *
 * 这些**三份语言包都缺**（所以 keyParity 测试全绿），
 * 但代码在用 → vue-i18n 找不到就**原样输出 key** → 用户看到机器标识。
 *
 * ## 这条测试做什么
 *
 * 扫三端源码里 `t('...')` 的**字面量**引用，逐个核对对应语言包里是否有这个点路径。
 *
 * 只查字面量是刻意的：动态 key（`t(\`${a}.${b}\`)`）无法静态判定，
 * 强行猜测会产出大量误报。动态 key 的风险由"该段落整体人工复核"承担。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../..')

/** 递归展开嵌套对象为扁平点路径 */
function flatten (obj, prefix = '') {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key))
    else out[key] = v
  }
  return out
}

/** 从语言包源码里解析出默认导出的对象（避免 import 触发运行时依赖） */
function loadLocale (file) {
  const src = fs.readFileSync(file, 'utf8')
  const m = src.match(/export\s+default\s+([\s\S]*?)\n\}/)
  if (!m) throw new Error(`无法解析 ${file}`)
  // eslint-disable-next-line no-new-func
  const obj = new Function(`return (${m[1].trim()}\n})`)()
  return flatten(obj)
}

/** 递归收集目录下的 .vue / .js 文件 */
function collectFiles (dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'i18n') continue
      collectFiles(full, acc)
    } else if (/\.(vue|js)$/.test(entry.name)) {
      acc.push(full)
    }
  }
  return acc
}

/**
 * 提取源码里的 `t('key')` / `t("key")` 字面量引用。
 *
 * 排除：
 *   - 模板字符串 `t(\`...\`)`（动态，无法静态判定）
 *   - 变量 `t(someVar)`
 */
function collectUsedKeys (src) {
  const keys = new Set()
  // t('x') / t("x") —— 后面必须紧跟 ) 或 , 才算完整调用
  const re = /\bt\(\s*'([a-zA-Z0-9_.]+)'\s*[),]/g
  const re2 = /\bt\(\s*"([a-zA-Z0-9_.]+)"\s*[),]/g
  let m
  while ((m = re.exec(src)) !== null) keys.add(m[1])
  while ((m = re2.exec(src)) !== null) keys.add(m[1])
  return keys
}

const APPS = [
  { app: 'portal', src: 'src/portal', i18n: 'src/portal/i18n' },
  { app: 'admin', src: 'src/admin', i18n: 'src/admin/i18n' },
  { app: 'partner', src: 'src/partner', i18n: 'src/partner/i18n' }
]

describe('i18n 已用 key 覆盖门禁', () => {
  for (const { app, src: srcDir, i18n } of APPS) {
    it(`${app} 端 t() 引用的 key 都在语言包里定义`, () => {
      // 以 zh-CN 为基准集（三份语言包由 keyParity 测试保证彼此一致）
      const locale = loadLocale(path.join(ROOT, i18n, 'zh-CN.js'))
      const defined = new Set(Object.keys(locale))

      const missing = new Map()
      for (const file of collectFiles(path.join(ROOT, srcDir))) {
        const content = fs.readFileSync(file, 'utf8')
        for (const key of collectUsedKeys(content)) {
          if (!defined.has(key)) {
            if (!missing.has(key)) missing.set(key, [])
            missing.get(key).push(path.relative(ROOT, file))
          }
        }
      }

      const report = [...missing.entries()]
        .map(([key, files]) => `  ${key}\n    ← ${[...new Set(files)].join(', ')}`)
        .join('\n')

      expect(
        report,
        `${app} 端有 ${missing.size} 个 t() 引用的 key 在语言包里不存在 —— ` +
        'vue-i18n 找不到时会**原样输出 key**，用户看到的是机器标识：\n' + report
      ).toBe('')
    })
  }
})
