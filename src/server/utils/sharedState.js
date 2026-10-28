import Redis from 'ioredis'

/**
 * 可选 Redis 的共享键值存储。
 * 默认使用进程内 Map（单实例开发/测试零依赖）；
 * 配置 REDIS_URL 后，限流、登录失败计数、验证码一次性 nonce、HTTP 缓存等自动切换为跨实例共享。
 */

let redisClient = null

/**
 * 原子自增 + 固定窗口 TTL（Redis 侧）
 *
 * KEYS[1] = 键，ARGV[1] = TTL 毫秒（0 表示不设过期）
 * 返回：新的计数值
 *
 * 关键点：键已存在时只更新值、不动 TTL —— 保证窗口从首次写入起算，
 * 与 MemoryStore 的 expiresAt 语义完全一致。
 */
const INCREMENT_LUA = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local raw = redis.call('GET', key)
local current = 0
if raw then
  -- 去掉 JSON 包装（值以 " 开头）
  if string.sub(raw, 1, 1) == '"' then
    raw = string.sub(raw, 2, string.len(raw) - 1)
  end
  current = tonumber(raw) or 0
end
current = current + 1

-- 固定窗口语义：窗口从「首次写入」起算，后续自增不得延长窗口。
-- 实现方式：先取剩余 TTL，再用「相同剩余 TTL」重写值。
-- 不能用 SET ... KEEPTTL（Redis 6+ 才有，生产版本不一定支持），
-- 也不能先 SET 再查 PTTL —— SET 已清掉 TTL，PTTL 恒为 -1，
-- 结果每次自增都重置窗口，固定窗口退化成滑动窗口（风控计数永不衰减）。
local pttl = -1
if ttl > 0 then
  pttl = redis.call('PTTL', key)
end

if ttl > 0 and pttl > 0 then
  -- 已有窗口：保留剩余 TTL 重写值
  redis.call('SET', key, '"' .. current .. '"', 'PX', pttl)
else
  -- 首次写入（或原本无 TTL）：设置完整窗口
  redis.call('SET', key, '"' .. current .. '"', 'PX', ttl)
end
return current
`

/**
 * 原子「不存在才写入」：返回 1 表示写入成功（此前不存在），0 表示已存在
 * 用于一次性 nonce 的消费，避免 get-then-set 的 TOCTOU 竞态
 */
const SETNX_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', tonumber(ARGV[2]))
return 1
`

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

/**
 * 内存 store 的条目上限。
 *
 * key 里含客户端可控成分（IP / 手机号 / Session-ID / userId），
 * 攻击者用大量不同 key 持续请求会让 Map 无限增长 → 进程 OOM。
 * 超限时按插入顺序淘汰最旧的条目（近似 LRU，足够防爆内存）。
 */
const MEMORY_STORE_MAX_ENTRIES = 10_000

class MemoryStore {
  constructor (namespace) {
    this.namespace = namespace
    this.map = new Map()
  }

  key (key) { return `${this.namespace}:${key}` }

  /** 容量保护：超限则淘汰最旧的若干条目 */
  _evictIfNeeded () {
    if (this.map.size <= MEMORY_STORE_MAX_ENTRIES) return
    // Map 保持插入序，迭代前若干个即最旧条目
    const toRemove = this.map.size - MEMORY_STORE_MAX_ENTRIES
    let removed = 0
    for (const k of this.map.keys()) {
      this.map.delete(k)
      if (++removed >= toRemove) break
    }
  }

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
    this._evictIfNeeded()
    this.map.set(this.key(key), {
      value: JSON.stringify(value),
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : null
    })
  }

  async delete (key) {
    this.map.delete(this.key(key))
  }

  /**
   * 原子「不存在才写入」：返回 true 表示本次写入成功
   * Map 写入是同步的（无 await 间隙），单进程内天然原子
   */
  async setIfAbsent (key, value, ttlMs) {
    const k = this.key(key)
    const existing = this.map.get(k)
    if (existing && (!existing.expiresAt || existing.expiresAt > Date.now())) {
      return false
    }
    this._evictIfNeeded()
    this.map.set(k, {
      value: JSON.stringify(value),
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : null
    })
    return true
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
   * 原子「不存在才写入」：返回 true 表示本次写入成功
   * 一次性 nonce 的消费用它替代 get-then-set，消除并发重放/穷举窗口
   */
  async setIfAbsent (key, value, ttlMs) {
    const serialized = JSON.stringify(value)
    const res = await this.client.eval(
      SETNX_LUA,
      1,
      this.key(key),
      serialized,
      String(ttlMs > 0 ? ttlMs : 1)
    )
    return Number(res) === 1
  }

  /**
   * 计数自增（原子，固定窗口语义）。
   *
   * 语义要求与 MemoryStore 一致：
   *   - 窗口从「首次写入」起算，后续自增不延长窗口（否则"每小时 20 次"
   *     会变成"最后一次请求后 1 小时内 20 次"，风控计数永不衰减）
   *   - 自增与设 TTL 是原子的，不能出现"计数已加但 TTL 没设"的中间态
   *
   * 用 Lua 一次完成 GET→加→条件 SET：
   *   - 键不存在：写新值并设 TTL
   *   - 键存在：只更新值，保留原有 TTL（PTTL 不变）
   *
   * 之所以不用 Redis INCR：INCR 要求键值是裸数字，而 set 写入的是 JSON
   * 形式（"5"），同一 key 上 INCR 会报 "value is not an integer"。
   */
  async increment (key, ttlMs) {
    const k = this.key(key)
    const ttl = ttlMs > 0 ? ttlMs : 0
    const raw = await this.client.eval(
      INCREMENT_LUA,
      1,
      k,
      String(ttl)
    )
    return Number(raw)
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
