/**
 * 共享状态层（类型契约 × 两个后端）
 *
 * 背景：sharedState 有两个后端（进程内 Map / Redis），必须遵守同一套类型契约：
 *   set(key, v) → get(key) 返回与 v 同类型的值
 *
 * 历史上两后端契约不一致：内存版原样存取字符串，Redis 版 get 时 JSON.parse
 * 会把 JSON 字符串变成对象 → res.end(对象) 抛 ERR_INVALID_ARG_TYPE → 生产 500。
 * 该缺陷在只跑内存版的测试中完全不可见，因此本文件显式覆盖类型契约。
 *
 * ⚠️ 为什么契约用例要**点名后端**并跑两遍
 *   createSharedStore 会随 REDIS_URL 的有无切换后端。若契约用例跟着它走，
 *   设了 REDIS_URL 就只测 Redis、不设就只测内存 —— **总有一个后端没被测过**，
 *   而且切换是静默的（用例名还写着"内存后端"，实际测的是 Redis）。
 *   现在用 createMemoryStore / createRedisStore 显式创建，两边都跑。
 *
 * ⚠️ Redis 可达性是**探测**出来的，不是看环境变量
 *   原来只判断 `process.env.REDIS_URL` 是否存在 —— CI/本地通常不设这个变量，
 *   于是 Redis 契约那 4 条护栏在常规回归里**从未执行过**，
 *   而它们守的正是"Redis 版与内存版契约不一致 → 生产 500"这个已发生过的缺陷。
 */
import { describe, it, expect } from 'vitest'
import net from 'node:net'
import { createMemoryStore, createRedisStore } from '@server/utils/sharedState.js'

const REDIS_URL = process.env.TEST_REDIS_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6379/0'

/** 探测 Redis 是否真的可达（连不上就跳过 Redis 那半，别让回归红） */
function probeRedis (url) {
  let u
  try {
    u = new URL(url)
  } catch {
    return Promise.resolve(false)
  }
  const host = u.hostname || '127.0.0.1'
  const port = Number(u.port || 6379)
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (ok) => { socket.destroy(); resolve(ok) }
    socket.setTimeout(500)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.once('timeout', () => done(false))
  })
}

const hasRedis = await probeRedis(REDIS_URL)

/** 要跑契约用例的后端清单 */
const backends = [
  { label: '内存后端', create: (ns) => createMemoryStore(ns) }
]
if (hasRedis) {
  backends.push({ label: 'Redis 后端', create: (ns) => createRedisStore(ns, REDIS_URL) })
} else {
  console.warn('[sharedState] 未探测到可用的 Redis，Redis 后端的契约用例将跳过')
}

for (const backend of backends) {
  describe(`SharedState.typeContract · ${backend.label}`, () => {
    it('SS-1 字符串往返后仍是字符串（不是被 JSON.parse 成对象）', async () => {
      const store = backend.create('test-str')
      const payload = '{"success":true,"data":{"x":1}}'
      await store.set('k', payload, 1000)
      const got = await store.get('k')
      expect(typeof got).toBe('string')
      expect(got).toBe(payload)
    })

    it('SS-2 对象往返后仍是对象', async () => {
      const store = backend.create('test-obj')
      const payload = { success: true, data: { n: 1 } }
      await store.set('k', payload, 1000)
      const got = await store.get('k')
      expect(typeof got).toBe('object')
      expect(got).toEqual(payload)
    })

    it('SS-3 数字往返后仍是数字', async () => {
      const store = backend.create('test-num')
      await store.set('k', 42, 1000)
      expect(await store.get('k')).toBe(42)
    })

    it('SS-4 布尔往返后仍是布尔', async () => {
      const store = backend.create('test-bool')
      await store.set('k', true, 1000)
      expect(await store.get('k')).toBe(true)
    })

    it('SS-5 increment 返回数字且可继续自增，get 拿回的也是数字', async () => {
      const store = backend.create('test-inc')
      expect(await store.increment('k', 1000)).toBe(1)
      expect(await store.increment('k', 1000)).toBe(2)
      expect(await store.increment('k', 1000)).toBe(3)
      // ⚠️ 这一条曾经抓出真 bug：Redis 后端把自增结果写成 '"3"'（带引号），
      //    get 的 JSON.parse('"3"') 得到的是**字符串** '3' —— 契约破了。
      const got = await store.get('k')
      expect(typeof got, 'increment 后 get 拿到的必须是数字，不是字符串').toBe('number')
      expect(got).toBe(3)
    })

    it('SS-6 increment 与 set 混用不冲突（限流 decrement 场景）', async () => {
      const store = backend.create('test-mix')
      await store.increment('k', 1000)      // 1
      await store.increment('k', 1000)      // 2
      await store.set('k', 1, 1000)         // decrement 语义：写回 1
      expect(await store.get('k')).toBe(1)
      expect(await store.increment('k', 1000)).toBe(2)  // 仍能自增
    })

    it('SS-7 TTL 过期后 get 返回 null', async () => {
      const store = backend.create('test-ttl')
      await store.set('k', 'v', 30)
      expect(await store.get('k')).toBe('v')
      await new Promise(r => setTimeout(r, 60))
      expect(await store.get('k')).toBeNull()
    })

    it('SS-8 delete 与 clear 生效', async () => {
      const store = backend.create('test-del')
      await store.set('a', 1, 1000)
      await store.set('b', 2, 1000)
      await store.delete('a')
      expect(await store.get('a')).toBeNull()
      expect(await store.get('b')).toBe(2)
      await store.clear()
      expect(await store.get('b')).toBeNull()
    })
  })
}

/**
 * Redis 后端契约验证（需要可达的 Redis；探测不到则跳过）
 *
 * 这是生产 500 的根因所在：内存版与 Redis 版的类型契约曾不一致，
 * 而常规测试只跑内存版，永远发现不了。
 */
describe('SharedState.redisContract', () => {
  const maybe = hasRedis ? it : it.skip

  maybe('SR-1 Redis 后端：字符串往返仍是字符串', async () => {
    const { Redis } = await import('ioredis')
    const client = new Redis(REDIS_URL)
    try {
      // 复刻 RedisStore 的读写契约（与 sharedState.js 保持一致）
      const set = async (k, v) => client.set(`ct:${k}`, JSON.stringify(v))
      const get = async (k) => {
        const raw = await client.get(`ct:${k}`)
        if (raw == null) return null
        try { return JSON.parse(raw) } catch { return raw }
      }
      await set('s', '{"success":true}')
      const v = await get('s')
      expect(typeof v).toBe('string')
      expect(v).toBe('{"success":true}')
      await client.del('ct:s')
    } finally {
      await client.quit()
    }
  })

  maybe('SR-2 Redis 后端：increment 与 set 混用不冲突', async () => {
    const { Redis } = await import('ioredis')
    const client = new Redis(REDIS_URL)
    try {
      const set = async (k, v) => client.set(`ct2:${k}`, JSON.stringify(v))
      const get = async (k) => {
        const raw = await client.get(`ct2:${k}`)
        if (raw == null) return null
        try { return JSON.parse(raw) } catch { return raw }
      }
      // 限流 decrement 场景：increment → set → increment
      const inc = async (k) => {
        const cur = Number(await get(k) || 0) + 1
        await set(k, cur)
        return cur
      }
      expect(await inc('k')).toBe(1)
      await set('k', 1)
      expect(await inc('k')).toBe(2)
      await client.del('ct2:k')
    } finally {
      await client.quit()
    }
  })

  maybe('SR-3 Redis 后端：increment 不重置 TTL（固定窗口）', async () => {
    const store = createRedisStore('redis-window-test', REDIS_URL)
    await store.delete('w')
    await store.increment('w', 400)
    await new Promise(r => setTimeout(r, 200))
    await store.increment('w', 400)
    await new Promise(r => setTimeout(r, 250))
    // 固定窗口：第二次自增不延长窗口 → 键应已过期
    expect(await store.get('w')).toBeNull()
  })

  maybe('SR-4 Redis 后端：并发 setIfAbsent 只成功一次', async () => {
    const store = createRedisStore('redis-setnx-test', REDIS_URL)
    await store.delete('cc')
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.setIfAbsent('cc', 1, 1000))
    )
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})
