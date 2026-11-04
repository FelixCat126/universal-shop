/**
 * GET 响应缓存中间件（进程内 Map 或 Redis 共享）
 * 仅缓存 200 / JSON 响应；带身份头（Authorization/Session-ID）请求不缓存
 *
 * 配置 REDIS_URL 后，缓存可被多个应用实例共享；
 * 未配置时退化为单实例内存实现，兼容现有开发/测试环境。
 */
import { createSharedStore } from './sharedState.js'

const cache = createSharedStore('http-cache')

/**
 * 正在进行的缓存写入。
 *
 * cache.set 是 fire-and-forget（不阻塞响应），因此「清缓存」可能发生在
 * 某次写入真正落库之前 —— 清完之后那次写入又把旧响应写回去了，
 * 缓存就"复活"了一份陈旧数据。这在测试里表现为
 * 「列表接口返回了上一个用例的数据」，非常难查。
 *
 * 记录在途写入，clearResponseCache 先等它们结束再清。
 */
const pendingWrites = new Set()
/** 等待在途写入的上限（毫秒）—— 不能无限等，否则在途写入堆积时会把请求拖死 */
const PENDING_WAIT_TIMEOUT_MS = 500

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
        // 存储层实现差异：内存版原样返回字符串，Redis 版会 JSON.parse 成对象。
        // res.end() 只接受 string/Buffer，因此这里统一序列化为字符串。
        return res.status(200).end(typeof hit === 'string' ? hit : JSON.stringify(hit))
      }

      const orig = res.json.bind(res)
      res.json = (body) => {
        try {
          if (res.statusCode === 200 && body && body.success !== false) {
            /**
             * 不阻塞响应；写缓存失败只记日志，不影响业务。
             *
             * 注意 pendingWrites 的登记/注销顺序：先把 promise 存进变量、再 add、
             * 最后挂 finally 删除 —— 若把 finally 串在赋值表达式里，
             * 同步结算时回调会在变量初始化前执行（TDZ），删除失败，
             * 在途集合只增不减 → 每次清缓存都要 await 越来越长的列表 →
             * 请求被拖慢甚至超时。
             */
            let write
            write = cache.set(key, JSON.stringify(body), ttlMs).catch(() => {})
            pendingWrites.add(write)
            write.then(() => pendingWrites.delete(write), () => pendingWrites.delete(write))
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
  // 先等在途写入结束，再清 —— 否则刚清完又被写回来
  if (pendingWrites.size > 0) {
    // 加超时上限：在途写入异常卡住时不能把清缓存（以及写接口）一起拖死
    await Promise.race([
      Promise.allSettled([...pendingWrites]),
      new Promise(resolve => setTimeout(resolve, PENDING_WAIT_TIMEOUT_MS))
    ])
  }
  await cache.clear()
}
