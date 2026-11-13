/**
 * JWT 密钥解析测试（config/jwtSecret）
 *
 * 这个模块是**启动期**求值的（import 时就把密钥定死），逻辑短但错不得：
 *   - 生产环境密钥没配好 → 必须直接拒绝启动（而不是拿占位密钥上线）
 *   - 管理端/合作端密钥应当与用户端隔离
 *
 * 用例：
 *   JS-1 有效 JWT_SECRET → 直接采用
 *   JS-2 生产环境缺失/过短/占位值 → 抛错（拒绝启动）
 *   JS-3 非生产环境无效 → 回退占位密钥（并告警）
 *   JS-4 无效的 JWT_ADMIN_SECRET：非生产 → 派生子密钥；生产 → 也派生独立子密钥
 *   JS-5 纯空白字符串按无效处理
 *   JS-6 三把密钥在**任何**环境都互不相同（密钥域隔离）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ENV_KEYS = ['JWT_SECRET', 'JWT_ADMIN_SECRET', 'JWT_PARTNER_SECRET', 'NODE_ENV']
let saved

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  vi.resetModules()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.resetModules()
})

/** 按当前环境变量重新求值 jwtSecret 模块 */
async function loadModule () {
  const mod = await import('@server/config/jwtSecret.js')
  return mod
}

describe('JWT 密钥解析', () => {
  it('JS-1 有效 JWT_SECRET 直接采用', async () => {
    process.env.JWT_SECRET = 'a'.repeat(40)
    delete process.env.NODE_ENV
    const { JWT_SECRET } = await loadModule()
    expect(JWT_SECRET).toBe('a'.repeat(40))
  })

  it('JS-2 生产环境缺失/过短/占位值 → 抛错拒绝启动', async () => {
    process.env.NODE_ENV = 'production'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // 缺失
    delete process.env.JWT_SECRET
    await expect(loadModule()).rejects.toThrow(/JWT_SECRET/)

    // 太短
    process.env.JWT_SECRET = 'short'
    await expect(loadModule()).rejects.toThrow(/JWT_SECRET/)

    // 占位值
    process.env.JWT_SECRET = 'your-secret-key-here'
    await expect(loadModule()).rejects.toThrow(/JWT_SECRET/)

    warn.mockRestore()
  })

  it('JS-3 非生产环境无效 → 回退占位密钥并告警', async () => {
    delete process.env.NODE_ENV
    process.env.JWT_SECRET = 'bad'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { JWT_SECRET } = await loadModule()
    expect(JWT_SECRET).toBe('test-jwt-secret-key-for-testing-only-32-chars-long')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('JS-4 无效的 JWT_ADMIN_SECRET：非生产派生子密钥、生产也派生独立子密钥', async () => {
    process.env.JWT_SECRET = 'b'.repeat(40)
    process.env.JWT_ADMIN_SECRET = 'also-bad'
    delete process.env.NODE_ENV
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const dev = await loadModule()
    // 非生产：派生出独立子密钥（与管理端隔离）
    expect(dev.JWT_ADMIN_SECRET).not.toBe('b'.repeat(40))
    expect(dev.JWT_ADMIN_SECRET.startsWith('b'.repeat(40))).toBe(true)

    // 生产：**同样派生独立子密钥**（旧实现直接回退到 JWT_SECRET ——
    // 那会让"漏配一个环境变量"悄悄抹平管理端的密钥边界）
    process.env.NODE_ENV = 'production'
    vi.resetModules()
    const prod = await loadModule()
    expect(prod.JWT_ADMIN_SECRET).not.toBe('b'.repeat(40))
    expect(prod.JWT_ADMIN_SECRET.length).toBe(64)
    warn.mockRestore()
  })

  it('JS-6 三把密钥在**任何**环境都互不相同（密钥域隔离）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // 场景 A：显式配置但全部配成同一个值（复制粘贴失误）
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = 'c'.repeat(40)
    process.env.JWT_ADMIN_SECRET = 'c'.repeat(40)
    process.env.JWT_PARTNER_SECRET = 'c'.repeat(40)
    vi.resetModules()
    const bad = await loadModule()
    // 显式配错时，如实报告"不隔离"（运维看得见），而不是悄悄说"没问题"
    expect(bad.JWT_SECRET_ISOLATION.adminDistinctFromUser).toBe(false)
    expect(bad.JWT_SECRET_ISOLATION.partnerDistinctFromUser).toBe(false)

    // 场景 B：漏配 → 派生 → 边界依然成立
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = 'd'.repeat(40)
    delete process.env.JWT_ADMIN_SECRET
    delete process.env.JWT_PARTNER_SECRET
    vi.resetModules()
    const derived = await loadModule()
    expect(derived.JWT_SECRET_ISOLATION.adminDistinctFromUser).toBe(true)
    expect(derived.JWT_SECRET_ISOLATION.partnerDistinctFromUser).toBe(true)
    expect(derived.JWT_SECRET_ISOLATION.adminDistinctFromPartner).toBe(true)
    expect(derived.JWT_ADMIN_SECRET).not.toBe(derived.JWT_SECRET)
    expect(derived.JWT_PARTNER_SECRET).not.toBe(derived.JWT_SECRET)
    expect(derived.JWT_ADMIN_SECRET).not.toBe(derived.JWT_PARTNER_SECRET)

    warn.mockRestore()
  })

  it('JS-5 纯空白字符串按无效处理', async () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = '   '
    await expect(loadModule()).rejects.toThrow(/JWT_SECRET/)
  })
})
