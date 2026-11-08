/**
 * 服务端纯工具函数的边界测试
 *
 * 这些函数的特点：**返回值直接进 SQL**（parseId → findByPk）或者
 * **决定要不要重试**（dbRetry）。它们出错不会崩，只会安静地给出错误结果 ——
 * 比如 parseId 放过 "1 OR 1=1"，或者 dbRetry 把死锁当成普通错误直接抛出。
 *
 *   SU-1 parseId：只放行正整数
 *   SU-2 parseDate：非法日期返回 null
 *   SU-3 parsePositiveInt：夹取到上限
 *   SU-4 resolvePagination：深翻页被钳住
 *   SU-5 withDeadlockRetry：死锁会重试
 *   SU-6 withDeadlockRetry：非死锁错误直接抛（不白重试）
 *   SU-7 withDeadlockRetry：重试用尽后抛出最后一次错误
 *   SU-8 requestLogger：记录方法/路径/状态，不打 body
 */
import { describe, it, expect, vi } from 'vitest'
import { parseId, parseDate, parsePositiveInt, parseStrictInt } from '@server/utils/params.js'
import { resolvePagination } from '@server/utils/pagination.js'
import { withDeadlockRetry } from '@server/utils/dbRetry.js'
import { logger } from '@server/utils/logger.js'

describe('服务端工具函数边界', () => {
  it('SU-1 parseId 只放行正整数', () => {
    expect(parseId('123')).toBe(123)
    expect(parseId(123)).toBe(123)
    expect(parseId(' 42 ')).toBe(42)
    // 以下都必须被拒
    for (const bad of [
      undefined, null, '', 'abc', '0', '-1', '1.5', '1e3', '0x10',
      '1 OR 1=1', '99999999999999999999', NaN, {}, []
    ]) {
      expect(parseId(bad), `parseId(${String(bad)}) 应该返回 null`).toBeNull()
    }
  })

  it('SU-2 parseDate 非法日期返回 null', () => {
    expect(parseDate('2026-01-01')).toBeInstanceOf(Date)
    expect(parseDate('not a date')).toBeNull()
    expect(parseDate('')).toBeNull()
    expect(parseDate(null)).toBeNull()
    expect(parseDate(undefined)).toBeNull()
  })

  it('SU-3 parsePositiveInt 夹取到上限', () => {
    expect(parsePositiveInt('50', 20)).toBe(50)
    expect(parsePositiveInt('500', 20, 100)).toBe(100)
    expect(parsePositiveInt('abc', 20)).toBe(20)
    expect(parsePositiveInt('-5', 20)).toBe(20)
    expect(parsePositiveInt(0, 20)).toBe(20)
    expect(parsePositiveInt('12.7', 20)).toBe(12)
  })

  it('SU-3b parseStrictInt 拒绝小数与脏字符（parseInt 会静默吞掉）', () => {
    expect(parseStrictInt(10)).toBe(10)
    expect(parseStrictInt('10')).toBe(10)
    expect(parseStrictInt(' 10 ')).toBe(10)
    expect(parseStrictInt('-5')).toBe(-5)
    // 这些 parseInt 会"猜"出一个值 —— 严格解析必须拒绝
    expect(parseStrictInt('1.5')).toBeNull()
    expect(parseStrictInt('10abc')).toBeNull()
    expect(parseStrictInt(1.5)).toBeNull()
    expect(parseStrictInt('abc')).toBeNull()
    expect(parseStrictInt('')).toBeNull()
    expect(parseStrictInt(null)).toBeNull()
    expect(parseStrictInt(undefined)).toBeNull()
    expect(parseStrictInt([])).toBeNull()
    expect(parseStrictInt(NaN)).toBeNull()
  })

  it('SU-4 resolvePagination 深翻页被钳住', () => {
    const p = resolvePagination({ page: '1', pageSize: '10' })
    expect(p.page).toBe(1)
    expect(p.pageSize).toBe(10)
    expect(p.offset).toBe(0)

    // 非法值回退默认
    const d = resolvePagination({ page: 'abc', pageSize: 'xyz' })
    expect(d.page).toBe(1)
    expect(d.pageSize).toBe(20)

    // pageSize 超上限被钳
    const capped = resolvePagination({ page: '1', pageSize: '99999' })
    expect(capped.pageSize).toBe(100)

    // 巨大的 page 不会产生巨大 OFFSET（否则 PG 要全表扫）
    const deep = resolvePagination({ page: '99999999', pageSize: '100' })
    expect(deep.offset).toBeLessThanOrEqual(100000)
  })

  it('SU-5 withDeadlockRetry 死锁会重试', async () => {
    const err = Object.assign(new Error('deadlock'), { parent: { code: '40P01' } })
    let calls = 0
    const result = await withDeadlockRetry(async () => {
      calls++
      if (calls < 3) throw err
      return 'ok'
    }, { baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('SU-6 withDeadlockRetry 非死锁错误直接抛（不白重试）', async () => {
    const err = new Error('boom')
    let calls = 0
    await expect(withDeadlockRetry(async () => {
      calls++
      throw err
    }, { baseDelayMs: 1 })).rejects.toThrow('boom')
    expect(calls).toBe(1)
  })

  it('SU-7 withDeadlockRetry 重试用尽后抛出最后一次错误', async () => {
    const err = Object.assign(new Error('still deadlocked'), { parent: { code: '40001' } })
    let calls = 0
    await expect(withDeadlockRetry(async () => {
      calls++
      throw err
    }, { retries: 2, baseDelayMs: 1 })).rejects.toThrow('still deadlocked')
    expect(calls).toBe(2)
  })

  it('SU-8 requestLogger 记录方法/路径/状态，不打 body', async () => {
    const { requestLogger } = await import('@server/utils/logger.js')
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {})

    const req = { method: 'GET', originalUrl: '/api/products', ip: '1.2.3.4', body: { password: 'secret' } }
    let finished
    const res = {
      statusCode: 200,
      on: (evt, cb) => { if (evt === 'finish') finished = cb }
    }
    const next = vi.fn()

    requestLogger()(req, res, next)
    expect(next).toHaveBeenCalled()
    finished()

    expect(spy).toHaveBeenCalledTimes(1)
    const payload = spy.mock.calls[0][1]
    expect(payload.method).toBe('GET')
    expect(payload.path).toBe('/api/products')
    expect(payload.status).toBe(200)
    // 绝不能把请求体写进日志（含密码等敏感信息）
    expect(JSON.stringify(payload)).not.toContain('secret')
    expect(payload.body).toBeUndefined()

    spy.mockRestore()
  })
})
