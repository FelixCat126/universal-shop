#!/usr/bin/env node

/**
 * CI 测试执行器（带 flaky 识别）
 *
 * 为什么需要它：偶发失败如果直接让流水线红，久了大家就会习惯性重跑，
 * 真问题被淹没；如果一律放过，真失败又会漏。
 * 所以这里做三件事：
 *
 *   1. 第一轮跑全量，失败则**只重跑失败的那些文件**（快）
 *   2. 重跑通过 → 判定为 **flaky**：明确打印出来，但默认**不**让流水线失败
 *      （设 CI_FLAKY_STRICT=1 可改成失败，强制收敛）
 *   3. 重跑仍失败 → 真失败，退出码非 0
 *
 * 用法：
 *   node scripts/ci-run-tests.mjs [vitest 的筛选参数...]
 *   例：node scripts/ci-run-tests.mjs tests/api tests/integration
 *
 * 环境变量：
 *   CI_FLAKY_STRICT=1   把 flaky 也当失败（收敛期建议开）
 *   CI_FLAKY_RETRIES=1  重跑轮数（默认 1）
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const strict = process.env.CI_FLAKY_STRICT === '1'
const retries = Math.max(1, Number(process.env.CI_FLAKY_RETRIES || 1))

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-vitest-'))

/** 跑一次 vitest，返回 { code, failedFiles } */
function runVitest (label, extraArgs = []) {
  const outFile = path.join(outDir, `${label}.json`)
  const cmd = [
    'npx', 'vitest', 'run',
    '--config', 'vitest.coverage.config.js',
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${outFile}`,
    ...args,
    ...extraArgs
  ]
  console.log(`\n▶ ${label}: npx vitest run ${args.join(' ')} ${extraArgs.join(' ')}`)
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env
    })
    child.on('close', (code) => {
      let failedFiles = []
      try {
        const report = JSON.parse(fs.readFileSync(outFile, 'utf8'))
        const failed = (report.testResults || []).filter(r => r.status === 'failed')
        failedFiles = failed.map(r => r.name || r.testFilePath).filter(Boolean)
        // 相对路径化，便于再次作为筛选参数传给 vitest
        failedFiles = failedFiles.map(f => path.relative(process.cwd(), f))
      } catch {
        // 没拿到报告就按整轮失败处理
      }
      resolve({ code, failedFiles })
    })
  })
}

/** 从失败文件列表里挑出「测试文件」（去掉 .js 之外的路径噪声） */
function toTestFiles (files) {
  return [...new Set(files.filter(f => f && f.endsWith('.test.js')))]
}

const first = await runVitest('第1轮')
if (first.code === 0) {
  console.log('\n✅ 第 1 轮全绿')
  process.exit(0)
}

let failedFiles = toTestFiles(first.failedFiles)
console.log(`\n⚠️ 第 1 轮失败，涉及 ${failedFiles.length} 个文件`)

for (let round = 2; round <= retries + 1; round++) {
  if (failedFiles.length === 0) break
  console.log(`\n↻ 只重跑这 ${failedFiles.length} 个文件（第 ${round - 1} 次重跑）`)
  const again = await runVitest(`重跑${round - 1}`, failedFiles)
  if (again.code === 0) {
    console.log('\n' + '='.repeat(64))
    console.log('⚠️  FLAKY：这些文件第 1 轮失败、重跑通过 —— 判定为偶发失败')
    for (const f of failedFiles) console.log(`     - ${f}`)
    console.log('='.repeat(64))
    console.log('   这不是「没事」，而是「有问题还没查清」。')
    console.log('   请把它当失败来查：多半是并发/时序/共享状态。')
    console.log(strict
      ? '\n❌ CI_FLAKY_STRICT=1 → 偶发失败也判失败'
      : '\nℹ️ 默认不阻断流水线（设 CI_FLAKY_STRICT=1 可改成阻断）')
    process.exit(strict ? 1 : 0)
  }
  failedFiles = toTestFiles(again.failedFiles)
  console.log(`   重跑后仍有 ${failedFiles.length} 个文件失败`)
}

console.log('\n❌ 重跑后依然失败 —— 是真失败')
process.exit(1)
