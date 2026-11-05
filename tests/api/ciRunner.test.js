/**
 * CI 测试执行器（scripts/ci-run-tests.mjs）的自测
 *
 * 这个脚本决定「流水线是红是绿」，它自己出错的话，
 * 就没人知道真实失败和偶发失败被它判成了什么 —— 所以它必须被测。
 *
 *   CR-1 真失败（第 1 轮失败、重跑仍失败）→ 退出码 1
 *   CR-2 偶发失败（第 1 轮失败、重跑通过）→ 退出码 0，且输出里明确标了 FLAKY
 *   CR-3 全绿 → 退出码 0
 *
 * 注意：这里会**再拉起 vitest 子进程**（脚本本身要跑测试才知道成不成功），
 * 所以比普通单测慢不少，timeout 给得比较宽。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const TMP_DIR = path.join(ROOT, 'tests/api')
const MARKER = path.join(ROOT, 'node_modules/.cache/ci-selfcheck-marker')

/** 造一个测试文件：mode=always 必失败；mode=flaky 第一次失败之后成功；mode=pass 恒成功 */
function writeProbeFile (name, mode) {
  const file = path.join(TMP_DIR, `zz-ci-selfcheck-${name}.test.js`)
  const body = mode === 'always'
    ? `import { describe, it, expect } from 'vitest'
describe('CI 自检', () => {
  it('必然失败', () => { expect(1).toBe(2) })
})
`
    : mode === 'flaky'
      ? `import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
const MARKER = ${JSON.stringify(MARKER)}
describe('CI 自检', () => {
  it('第一次失败、第二次通过', () => {
    const first = !fs.existsSync(MARKER)
    if (first) fs.writeFileSync(MARKER, 'x')
    expect(first).toBe(false)
  })
})
`
      : `import { describe, it, expect } from 'vitest'
describe('CI 自检', () => {
  it('恒通过', () => { expect(1).toBe(1) })
})
`
  fs.writeFileSync(file, body, 'utf8')
  return file
}

/** 跑一次 CI 执行器，返回 { code, output } */
function runCi (testFile) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['scripts/ci-run-tests.mjs', testFile],
      { cwd: ROOT, env: { ...process.env, CI_FLAKY_STRICT: '0' } }
    )
    let out = ''
    child.stdout.on('data', d => { out += d.toString() })
    child.stderr.on('data', d => { out += d.toString() })
    child.on('close', code => resolve({ code, output: out }))
  })
}

const created = []

beforeAll(() => {
  fs.mkdirSync(path.dirname(MARKER), { recursive: true })
})

afterAll(() => {
  for (const f of created) fs.rmSync(f, { force: true })
  fs.rmSync(MARKER, { force: true })
})

describe('CI 测试执行器自测', () => {
  it('CR-1 真失败 → 退出码 1', async () => {
    const file = writeProbeFile('always', 'always')
    created.push(file)
    const { code, output } = await runCi(file)
    expect(code).toBe(1)
    expect(output).toContain('真失败')
  }, 180000)

  it('CR-2 偶发失败 → 退出码 0 且明确标记 FLAKY', async () => {
    fs.rmSync(MARKER, { force: true })
    const file = writeProbeFile('flaky', 'flaky')
    created.push(file)
    const { code, output } = await runCi(file)
    expect(code).toBe(0)
    expect(output).toContain('FLAKY')
    // 偶发也必须被醒目提示，不能悄悄放过
    expect(output).toMatch(/有问题还没查清|不是「没事」/)
  }, 180000)

  it('CR-3 全绿 → 退出码 0', async () => {
    const file = writeProbeFile('pass', 'pass')
    created.push(file)
    const { code } = await runCi(file)
    expect(code).toBe(0)
  }, 180000)
})
