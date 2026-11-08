/**
 * CI 测试执行器（scripts/ci-run-tests.mjs）自测
 *
 * 这个脚本决定「流水线是红是绿」—— 它自己出错时没人知道
 * 真实失败和偶发失败被它判成了什么。所以它必须被测。
 *
 *   CR-1 真失败（第 1 轮失败、重跑仍失败）→ 退出码 1
 *   CR-2 偶发失败（第 1 轮失败、重跑通过）→ 退出码 0，且输出里明确标了 FLAKY
 *   CR-3 全绿 → 退出码 0
 *
 * 用一个**轻量配置**跑（不挂 setup 文件、不连库），所以很快。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const TMP_DIR = path.join(ROOT, 'tests/api/__ci-selfcheck__')
const CONFIG = path.join(TMP_DIR, 'vitest.selfcheck.config.js')
const MARKER = path.join(TMP_DIR, 'marker')

/** 跑一次 CI 执行器（用轻量配置），返回 { code, output } */
function runCi (testFile) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['scripts/ci-run-tests.mjs', `--config=${CONFIG}`, testFile],
      { cwd: ROOT, env: { ...process.env, CI_FLAKY_STRICT: '0' } }
    )
    let output = ''
    child.stdout.on('data', d => { output += d.toString() })
    child.stderr.on('data', d => { output += d.toString() })
    child.on('close', code => resolve({ code, output }))
  })
}

beforeAll(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  // 轻量配置：不要 setup 文件（不连库），只跑指定的文件
  fs.writeFileSync(CONFIG, `
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/api/__ci-selfcheck__/**/*.test.js'],
    testTimeout: 20000
  }
})
`, 'utf8')
})

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
  fs.rmSync(MARKER, { force: true })
})

describe('CI 测试执行器自测', () => {
  it('CR-1 真失败 → 退出码 1', async () => {
    const file = path.join(TMP_DIR, 'always.test.js')
    fs.writeFileSync(file, `
import { describe, it, expect } from 'vitest'
describe('自检', () => {
  it('必然失败', () => { expect(1).toBe(2) })
})
`, 'utf8')

    const { code, output } = await runCi(file)
    expect(code).toBe(1)
    expect(output).toContain('真失败')
  }, 120000)

  it('CR-2 偶发失败 → 退出码 0 且标了 FLAKY', async () => {
    fs.rmSync(MARKER, { force: true })
    const file = path.join(TMP_DIR, 'flaky.test.js')
    fs.writeFileSync(file, `
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
const MARKER = ${JSON.stringify(MARKER)}
describe('自检', () => {
  it('第一次失败、第二次通过', () => {
    const first = !fs.existsSync(MARKER)
    if (first) fs.writeFileSync(MARKER, 'x')
    expect(first).toBe(false)
  })
})
`, 'utf8')

    const { code, output } = await runCi(file)
    expect(code).toBe(0)
    expect(output).toContain('FLAKY')
    // 偶发也必须被醒目提示，不能悄悄放过
    expect(output).toMatch(/有问题还没查清|不是「没事」/)
  }, 120000)

  it('CR-3 全绿 → 退出码 0', async () => {
    const file = path.join(TMP_DIR, 'pass.test.js')
    fs.writeFileSync(file, `
import { describe, it, expect } from 'vitest'
describe('自检', () => {
  it('恒通过', () => { expect(1).toBe(1) })
})
`, 'utf8')

    const { code } = await runCi(file)
    expect(code).toBe(0)
  }, 120000)
})
