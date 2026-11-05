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
 *   JS-4 无效的 JWT_ADMIN_SECRET：非生产 → 派生子密钥；生产 → 回退 JWT_SECRET
 *   JS-5 纯空白字符串按无效处理
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

  it('JS-4 无效的 JWT_ADMIN_SECRET：非生产派生子密钥、生产回退 JWT_SECRET', async () => {
    process.env.JWT_SECRET = 'b'.repeat(40)
    process.env.JWT_ADMIN_SECRET = 'also-bad'
    delete process.env.NODE_ENV
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const dev = await loadModule()
    // 非生产：派生出独立子密钥（与管理端隔离）
    expect(dev.JWT_ADMIN_SECRET).not.toBe('b'.repeat(40))
    expect(dev.JWT_ADMIN_SECRET.startsWith('b'.repeat(40))).toBe(true)

    // 生产：回退到 JWT_SECRET 并告警（提醒独立配置）
    process.env.NODE_ENV = 'production'
    vi.resetModules()
    const prod = await loadModule()
    expect(prod.JWT_ADMIN_SECRET).toBe('b'.repeat(40))
    warn.mockRestore()
  })

  it('JS-5 纯空白字符串按无效处理', async () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = '   '
    await expect(loadModule()).rejects.toThrow(/JWT_SECRET/)
  })
})
