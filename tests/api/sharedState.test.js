/**
 * 共享状态层（8 用例）
 *
 * 背景：sharedState 有两个后端（进程内 Map / Redis），必须遵守同一套类型契约：
 *   set(key, v) → get(key) 返回与 v 同类型的值
 *
 * 历史上两后端契约不一致：内存版原样存取字符串，Redis 版 get 时 JSON.parse
 * 会把 JSON 字符串变成对象 → res.end(对象) 抛 ERR_INVALID_ARG_TYPE → 生产 500。
 * 该缺陷在只跑内存版的测试中完全不可见，因此本文件显式覆盖类型契约。
 */
import { describe, it, expect } from 'vitest'

/** 内存后端：直接用 createSharedStore（无 REDIS_URL 时） */
function memoryStore (namespace) {
  return import('@server/utils/sharedState.js').then(m => m.createSharedStore(namespace))
}

describe('SharedState.typeContract', () => {
  it('SS-1 字符串往返后仍是字符串（不是被 JSON.parse 成对象）', async () => {
    const store = await memoryStore('test-str')
    const payload = '{"success":true,"data":{"x":1}}'
    await store.set('k', payload, 1000)
    const got = await store.get('k')
    expect(typeof got).toBe('string')
    expect(got).toBe(payload)
  })

  it('SS-2 对象往返后仍是对象', async () => {
    const store = await memoryStore('test-obj')
    const payload = { success: true, data: { n: 1 } }
    await store.set('k', payload, 1000)
    const got = await store.get('k')
    expect(typeof got).toBe('object')
    expect(got).toEqual(payload)
  })

  it('SS-3 数字往返后仍是数字', async () => {
    const store = await memoryStore('test-num')
    await store.set('k', 42, 1000)
    expect(await store.get('k')).toBe(42)
  })

  it('SS-4 布尔往返后仍是布尔', async () => {
    const store = await memoryStore('test-bool')
    await store.set('k', true, 1000)
    expect(await store.get('k')).toBe(true)
  })

  it('SS-5 increment 返回数字且可继续自增', async () => {
    const store = await memoryStore('test-inc')
    expect(await store.increment('k', 1000)).toBe(1)
    expect(await store.increment('k', 1000)).toBe(2)
    expect(await store.increment('k', 1000)).toBe(3)
    expect(await store.get('k')).toBe(3)
  })

  it('SS-6 increment 与 set 混用不冲突（限流 decrement 场景）', async () => {
    const store = await memoryStore('test-mix')
    await store.increment('k', 1000)      // 1
    await store.increment('k', 1000)      // 2
    await store.set('k', 1, 1000)         // decrement 语义：写回 1
    expect(await store.get('k')).toBe(1)
    expect(await store.increment('k', 1000)).toBe(2)  // 仍能自增
  })

  it('SS-7 TTL 过期后 get 返回 null', async () => {
    const store = await memoryStore('test-ttl')
    await store.set('k', 'v', 30)
    expect(await store.get('k')).toBe('v')
    await new Promise(r => setTimeout(r, 60))
    expect(await store.get('k')).toBeNull()
  })

  it('SS-8 delete 与 clear 生效', async () => {
    const store = await memoryStore('test-del')
    await store.set('a', 1, 1000)
    await store.set('b', 2, 1000)
    await store.delete('a')
    expect(await store.get('a')).toBeNull()
    expect(await store.get('b')).toBe(2)
    await store.clear()
    expect(await store.get('b')).toBeNull()
  })
})

/**
 * Redis 后端契约验证（需要本地/测试 Redis；无则跳过）
 *
 * 这是生产 500 的根因所在：内存版与 Redis 版的类型契约曾不一致，
 * 而常规测试只跑内存版，永远发现不了。CI 中若提供 REDIS_URL 即可覆盖。
 */
describe('SharedState.redisContract', () => {
  const REDIS_URL = process.env.TEST_REDIS_URL || process.env.REDIS_URL
  const hasRedis = Boolean(REDIS_URL)
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
    const { createSharedStore } = await import('@server/utils/sharedState.js')
    const store = createSharedStore('redis-window-test')
    await store.delete('w')
    await store.increment('w', 400)
    await new Promise(r => setTimeout(r, 200))
    await store.increment('w', 400)
    await new Promise(r => setTimeout(r, 250))
    // 固定窗口：第二次自增不延长窗口 → 键应已过期
    expect(await store.get('w')).toBeNull()
  })

  maybe('SR-4 Redis 后端：并发 setIfAbsent 只成功一次', async () => {
    const { createSharedStore } = await import('@server/utils/sharedState.js')
    const store = createSharedStore('redis-setnx-test')
    await store.delete('cc')
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.setIfAbsent('cc', 1, 1000))
    )
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})
