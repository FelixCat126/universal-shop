/**
 * 前后端接口契约测试
 *
 * 前端 api 层（src/admin/api、src/portal/api、src/partner）里写死了接口路径。
 * 后端改了路由、前端没跟上 —— 编译期发现不了，运行时才 404，
 * 而且往往是在用户点下去的那一刻。
 *
 * 这里把前端调用的每个路径抽出来，逐个核对后端确实有对应路由：
 *   FC-1 admin 端调用的接口，后端都有
 *   FC-2 portal 端调用的接口，后端都有
 *   FC-3 partner 端静态路径的接口，后端都有
 *   FC-4 后端路由清单非空（防抽取逻辑本身失效后"全绿"）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import app from '@server/app.js'
import { collectRoutes, matchRoute, normalizePath } from '@server/utils/routeInventory.js'

const ROOT = path.resolve(process.cwd())

/** 收集某目录下的 js 文件 */
function jsFilesIn (dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(dir, f))
}

/**
 * 从前端 api 文件里抽出「调用了哪些接口」。
 * 匹配 api.get('/xxx') / api.post(`/x/${id}`) 这类写法。
 *
 * 前端的路径拼法不止一种，都得认出来：
 *   - 字面量：api.get('/admin/orders')
 *   - 模板变量：api.get(`/admin/orders/${id}`)        → :param
 *   - 文件内常量：api.get(`${API_BASE_URL}/register`) → 用文件里的常量替换
 *   - axios 实例的 baseURL：baseURL: '/api' / config.apiBaseUrl
 */
function extractCalls (files, { basePrefix = '/api' } = {}) {
  const calls = []
  const re = /\.(get|post|put|delete|patch)\(\s*[`'"]([^`'"]+)[`'"]/g

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')

    // 文件内的字符串常量（用于 ${API_BASE_URL} 这类拼法）
    const constants = {}
    const constRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]/g
    let cm
    while ((cm = constRe.exec(src)) !== null) constants[cm[1]] = cm[2]

    // axios 实例的 baseURL：字面量优先；config.apiBaseUrl 在生产是 '/api'
    let base = ''
    const literalBase = src.match(/baseURL:\s*['"]([^'"]+)['"]/)
    if (literalBase) base = literalBase[1]
    else if (/baseURL:\s*config\.apiBaseUrl/.test(src)) base = '/api'
    else base = basePrefix

    let m
    while ((m = re.exec(src)) !== null) {
      const method = m[1].toUpperCase()
      let raw = m[2].split('?')[0].split('#')[0]

      // ${CONST} → 常量值；${...}（其它）→ :param
      raw = raw.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (all, name) => {
        return constants[name] !== undefined ? constants[name] : ':param'
      })
      // 残留的 ${...}（如函数调用结果）也当参数
      raw = raw.replace(/\$\{[^}]+\}/g, ':param')

      if (raw.startsWith('http')) continue // 绝对地址，跳过

      const normalized = normalizePath(raw)
      // 没带 base 的（自己建 axios 实例且没写 baseURL）→ 路径本身就得是全路径
      const fullPath = base && !normalized.startsWith(base)
        ? normalizePath(base + normalized)
        : normalized

      calls.push({
        method,
        path: normalized,
        fullPath,
        file: path.relative(ROOT, file)
      })
    }
  }
  return calls
}

describe('前后端接口契约', () => {
  const routes = collectRoutes(app)

  it('FC-4 后端路由清单非空（防抽取逻辑失效）', () => {
    expect(routes.length).toBeGreaterThan(50)
    // 抽查几条必须存在的路由，确保清单抽对了
    const has = (method, p) => routes.some(r => r.method === method && r.fullPath === p)
    expect(has('GET', '/api/products')).toBe(true)
    expect(has('POST', '/api/orders')).toBe(true)
    expect(has('GET', '/api/admin/users')).toBe(true)
  })

  it('FC-1 admin 端调用的接口后端都有', () => {
    const files = jsFilesIn(path.join(ROOT, 'src/admin/api'))
    const calls = extractCalls(files, { basePrefix: '/api' })
    expect(calls.length).toBeGreaterThan(10)

    const missing = calls.filter(c => !matchRoute(routes, c.fullPath, c.method))
    expect(
      missing.map(m => `${m.method} ${m.fullPath}  （${m.file}）`),
      '前端调用了后端不存在的接口'
    ).toEqual([])
  })

  it('FC-2 portal 端调用的接口后端都有', () => {
    const files = jsFilesIn(path.join(ROOT, 'src/portal/api'))
    const calls = extractCalls(files, { basePrefix: '/api' })
    expect(calls.length).toBeGreaterThan(5)

    const missing = calls.filter(c => !matchRoute(routes, c.fullPath, c.method))
    expect(
      missing.map(m => `${m.method} ${m.fullPath}  （${m.file}）`),
      '前端调用了后端不存在的接口'
    ).toEqual([])
  })

  it('FC-3 partner 端静态路径的接口后端都有', () => {
    // partner 端用 fetch 直接拼 /api/partner...，这里只取能静态解析的
    const files = []
    const partnerDir = path.join(ROOT, 'src/partner')
    if (fs.existsSync(partnerDir)) {
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(p)
          else if (entry.name.endsWith('.js')) files.push(p)
        }
      }
      walk(partnerDir)
    }

    const calls = []
    const re = /fetch\(\s*[`'"]([^`'"]+)[`'"]/g
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      let m
      while ((m = re.exec(src)) !== null) {
        const p = m[1].split('?')[0]
        if (p.includes('${')) continue // 动态拼接的没法静态核对
        calls.push({
          method: 'GET',
          path: normalizePath(p.replace(/\$\{[^}]+\}/g, ':param')),
          fullPath: normalizePath(p.replace(/\$\{[^}]+\}/g, ':param')),
          file: path.relative(ROOT, file)
        })
      }
    }
    if (calls.length === 0) return // 没有可静态核对的路径就跳过

    const missing = calls.filter(c => !matchRoute(routes, c.fullPath, c.method))
    expect(
      missing.map(m => `${m.method} ${m.fullPath}  （${m.file}）`),
      'partner 端调用了后端不存在的接口'
    ).toEqual([])
  })
})
