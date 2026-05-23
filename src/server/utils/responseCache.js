/**
 * 简易 GET 响应缓存中间件（基于 lru-cache）
 * 仅缓存 200 / JSON 响应；带身份头（Authorization/Session-ID）请求不缓存
 *
 * 用法：
 *   router.get('/public', cacheGet({ ttlMs: 30000 }), Controller.getPublic)
 */
import { LRUCache } from 'lru-cache'

const cache = new LRUCache({ max: 500, ttl: 60_000 })

export function cacheGet ({ ttlMs = 30_000, keyFn } = {}) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next()
    if (req.headers.authorization) return next() // 身份相关请求不缓存
    if (req.headers['session-id']) return next()

    const key = keyFn ? keyFn(req) : `${req.method} ${req.originalUrl}`
    const hit = cache.get(key)
    if (hit) {
      res.setHeader('X-Cache', 'HIT')
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.status(200).end(hit)
    }

    const orig = res.json.bind(res)
    res.json = (body) => {
      try {
        if (res.statusCode === 200 && body && body.success !== false) {
          cache.set(key, JSON.stringify(body), { ttl: ttlMs })
          res.setHeader('X-Cache', 'MISS')
        }
      } catch {}
      return orig(body)
    }
    next()
  }
}

export function clearResponseCache () {
  cache.clear()
}
