/**
 * 路由清单（route inventory）
 *
 * 从 Express 的路由表里把「有哪些接口」抽出来，做两件事：
 *   1. 生成 OpenAPI 文档（scripts/generate-openapi.mjs）
 *   2. 前端契约测试：前端 api 层调用的每个路径，后端都得有对应路由
 *      （前端改了路径、后端没改 → 契约测试当场报出来，而不是等到线上 404）
 *
 * 只读，不改任何运行时行为。
 */

/** 从挂载层的 regexp 里还原路径前缀：^\/api\/products\/?(?=\/|$) → /api/products */
export function prefixFromRegexp (source) {
  if (!source) return ''
  let s = String(source)
  s = s.replace(/^\^/, '')
  // 去掉尾部的「可选斜杠 + 边界断言」
  s = s.replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
  s = s.replace(/\\\/\?\$\(\?=\\\/\|\$\)$/, '')
  s = s.replace(/\$$/, '')
  s = s.replace(/\\\//g, '/')
  // 通配段 * → :wildcard
  s = s.replace(/\*/g, ':wildcard')
  return s
}

/**
 * 收集 app 上的全部路由。
 * @param {object} app Express app
 * @returns {Array<{method: string, path: string, fullPath: string, middleware: boolean}>}
 */
export function collectRoutes (app) {
  const routes = []
  const seen = new Set()

  const walk = (stack, prefix) => {
    for (const layer of stack || []) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods || {}).filter(m => m !== '_all')
        for (const method of methods) {
          const fullPath = normalizePath(prefix + (layer.route.path || ''))
          const key = `${method} ${fullPath}`
          if (seen.has(key)) continue
          seen.add(key)
          routes.push({
            method: method.toUpperCase(),
            path: layer.route.path || '',
            fullPath,
            middleware: false
          })
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, prefix + prefixFromRegexp(layer.regexp?.source))
      }
    }
  }

  walk(app?._router?.stack, '')
  routes.sort((a, b) => a.fullPath.localeCompare(b.fullPath) || a.method.localeCompare(b.method))
  return routes
}

/** 归一化路径：合并斜杠、去掉结尾斜杠（根路径除外） */
export function normalizePath (p) {
  if (!p) return '/'
  let out = String(p).replace(/\/{2,}/g, '/')
  if (out.length > 1) out = out.replace(/\/+$/, '')
  return out || '/'
}

/**
 * 判断一个「实际调用路径」能否命中路由清单里的某条路由。
 *
 *   /api/orders/123        → 命中 /api/orders/:id
 *   /api/orders            → 命中 /api/orders
 *   /api/orders/123/items  → 命中 /api/orders/:id/items
 *
 * @param {Array} routes collectRoutes 的结果
 * @param {string} actualPath 实际调用的路径（已去掉 query）
 * @param {string} [method] 请求方法；给了就必须方法一致
 * @returns {object|null} 命中的路由
 */
export function matchRoute (routes, actualPath, method) {
  const target = normalizePath(actualPath)
  const targetSegs = target.split('/').filter(Boolean)
  const candidates = method
    ? routes.filter(r => r.method === method.toUpperCase())
    : routes

  for (const route of candidates) {
    const segs = route.fullPath.split('/').filter(Boolean)
    if (segs.length !== targetSegs.length) continue
    let ok = true
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      if (s.startsWith(':')) continue // 参数段，任意值都算命中
      if (s !== targetSegs[i]) { ok = false; break }
    }
    if (ok) return route
  }
  return null
}
