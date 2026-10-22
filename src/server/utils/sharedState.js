import Redis from 'ioredis'

/**
 * 可选 Redis 的共享键值存储。
 * 默认使用进程内 Map（单实例开发/测试零依赖）；
 * 配置 REDIS_URL 后，限流、登录失败计数、验证码一次性 nonce、HTTP 缓存等自动切换为跨实例共享。
 */

let redisClient = null

function getRedisClient () {
  if (!process.env.REDIS_URL) return null
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      lazyConnect: false
    })
    redisClient.on('error', (err) => {
      console.error('[shared-state] Redis error:', err.message)
    })
  }
  return redisClient
}

class MemoryStore {
  constructor (namespace) {
    this.namespace = namespace
    this.map = new Map()
  }

  key (key) { return `${this.namespace}:${key}` }

  async get (key) {
    const k = this.key(key)
    const row = this.map.get(k)
    if (!row) return null
    if (row.expiresAt && row.expiresAt <= Date.now()) {
      this.map.delete(k)
      return null
    }
    // 与 RedisStore 保持同一契约：值按 JSON 序列化存放，get 时还原
    try { return JSON.parse(row.value) } catch { return row.value }
  }

  async set (key, value, ttlMs) {
    if (value === undefined) {
      this.map.delete(this.key(key))
      return
    }
    this.map.set(this.key(key), {
      value: JSON.stringify(value),
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : null
    })
  }

  async delete (key) {
    this.map.delete(this.key(key))
  }

  async increment (key, ttlMs) {
    const current = Number(await this.get(key) || 0) + 1
    // increment 不重置 TTL（与 express-rate-limit 语义一致）
    const existing = this.map.get(this.key(key))
    this.map.set(this.key(key), {
      value: JSON.stringify(current),
      expiresAt: existing?.expiresAt || (ttlMs > 0 ? Date.now() + ttlMs : null)
    })
    return current
  }

  async clear () {
    const prefix = `${this.namespace}:`
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) this.map.delete(key)
    }
  }
}

class RedisStore {
  constructor (namespace, client) {
    this.namespace = namespace
    this.client = client
  }

  key (key) { return `${this.namespace}:${key}` }

  async get (key) {
    const value = await this.client.get(this.key(key))
    if (value == null) return null
    try { return JSON.parse(value) } catch { return value }
  }

  /**
   * 统一以 JSON 序列化写入（字符串也序列化）。
   *
   * 这样 get 的 JSON.parse 能把值还原成「写进去时的类型」：
   *   set(key, '{"a":1}') → 存 '"{\\"a\\":1}"' → get 得到字符串 '{"a":1}'
   *   set(key, { a: 1 })  → 存 '{"a":1}'        → get 得到对象 { a: 1 }
   *   set(key, 5)         → 存 '5'              → get 得到数字 5
   *
   * 若字符串不序列化（早期实现），get 会把它 JSON.parse 成对象，
   * 导致 res.end(对象) 抛 ERR_INVALID_ARG_TYPE（生产 500）。
   * 内存版同样按此契约存取，两种后端行为一致。
   */
  async set (key, value, ttlMs) {
    if (value === undefined) {
      await this.client.del(this.key(key))
      return
    }
    const serialized = JSON.stringify(value)
    if (ttlMs > 0) {
      await this.client.set(this.key(key), serialized, 'PX', ttlMs)
    } else {
      await this.client.set(this.key(key), serialized)
    }
  }

  async delete (key) {
    await this.client.del(this.key(key))
  }

  /**
   * 计数自增。
   *
   * 用 GET+SET 而非 Redis INCR：INCR 要求键值是裸数字，
   * 而 set 写入的是 JSON 形式（"5"），同一 key 上 INCR 会报
   * "value is not an integer"。用 GET+SET 可与 set 保持同一存储格式。
   */
  async increment (key, ttlMs) {
    const k = this.key(key)
    const current = Number(await this.get(key) || 0) + 1
    const ttl = ttlMs > 0 ? ttlMs : null
    if (ttl != null) {
      await this.client.set(k, JSON.stringify(current), 'PX', ttl)
    } else {
      await this.client.set(k, JSON.stringify(current))
    }
    return current
  }

  async clear () {
    const pattern = `${this.namespace}:*`
    let cursor = '0'
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
      cursor = next
      if (keys.length > 0) await this.client.del(...keys)
    } while (cursor !== '0')
  }
}

export function createSharedStore (namespace) {
  const client = getRedisClient()
  return client ? new RedisStore(namespace, client) : new MemoryStore(namespace)
}

export function isSharedStateDistributed () {
  return Boolean(process.env.REDIS_URL)
}

export async function closeSharedState () {
  if (redisClient) {
    await redisClient.quit().catch(() => {})
    redisClient = null
  }
}
