/**
 * GET 响应缓存中间件（进程内 Map 或 Redis 共享）
 * 仅缓存 200 / JSON 响应；带身份头（Authorization/Session-ID）请求不缓存
 *
 * 配置 REDIS_URL 后，缓存可被多个应用实例共享；
 * 未配置时退化为单实例内存实现，兼容现有开发/测试环境。
 */
import { createSharedStore } from './sharedState.js'

const cache = createSharedStore('http-cache')

export function cacheGet ({ ttlMs = 30_000, keyFn } = {}) {
  return async (req, res, next) => {
    try {
      if (req.method !== 'GET') return next()
      if (req.headers.authorization) return next() // 身份相关请求不缓存
      if (req.headers['session-id']) return next()

      const key = keyFn ? keyFn(req) : `${req.method} ${req.originalUrl}`
      const hit = await cache.get(key)
      if (hit) {
        res.setHeader('X-Cache', 'HIT')
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        return res.status(200).end(hit)
      }

      const orig = res.json.bind(res)
      res.json = (body) => {
        try {
          if (res.statusCode === 200 && body && body.success !== false) {
            // 不阻塞响应；写缓存失败只记日志，不影响业务
            cache.set(key, JSON.stringify(body), ttlMs).catch(() => {})
            res.setHeader('X-Cache', 'MISS')
          }
        } catch {}
        return orig(body)
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

export async function clearResponseCache () {
  await cache.clear()
}
