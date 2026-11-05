/**
 * 覆盖率门禁自身的守卫测试
 *
 * 背景：这道门禁曾经**完全空转** —— 配置写成了
 *   thresholds: { global: {...}, 'src/server/controllers/': {...} }
 * 而 Vitest 1.6 只认**顶层数字键** + 带 `**` 的 glob：
 *   - `global` 被当成 glob 模式，匹配不到任何文件 → 该分组为空 → 直接跳过
 *   - 'src/server/controllers/'（尾斜杠）同样匹配不到文件
 * 结果：branches 64% < 写的 70%，CI 照样绿 —— 门禁是假的。
 *
 * 门禁本身没有测试，就意味着有人再写错格式时没人会发现。
 * 这里把它钉住：
 *   CG-1 顶层必须有数字键（statements/branches/functions/lines）
 *   CG-2 不能出现 `global` 子对象（Vitest 1.6 不认，会被当成 glob）
 *   CG-3 每个 glob 键都必须真的匹配到文件（否则是死门槛）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import config from '../../vitest.config.js'

const thresholds = config.test.coverage.thresholds
const ROOT = path.resolve(process.cwd())

describe('覆盖率门禁配置', () => {
  it('CG-1 顶层必须是数字键（这才是 Vitest 1.6 认的全局门槛）', () => {
    for (const key of ['statements', 'branches', 'functions', 'lines']) {
      expect(typeof thresholds[key], `thresholds.${key} 必须是数字`).toBe('number')
    }
  })

  it('CG-2 不能用 global 子对象（会被当成 glob 匹配不到文件 → 门槛失效）', () => {
    expect(thresholds.global).toBeUndefined()
  })

  it('CG-3 每个 glob 键都要真的匹配到文件（死门槛等于没门槛）', () => {
    const globKeys = Object.keys(thresholds).filter(k => !['statements', 'branches', 'functions', 'lines', 'perFile', 'autoUpdate'].includes(k))
    expect(globKeys.length).toBeGreaterThan(0)

    for (const glob of globKeys) {
      // 把 'src/server/controllers/**' 还原成目录前缀再数文件
      const dir = glob.replace(/\/\*\*$/, '').replace(/\/$/, '')
      const abs = path.join(ROOT, dir)
      expect(fs.existsSync(abs), `glob ${glob} 对应的目录不存在`).toBe(true)

      const files = fs.readdirSync(abs).filter(f => f.endsWith('.js'))
      expect(files.length, `glob ${glob} 没有匹配到任何文件`).toBeGreaterThan(0)
    }
  })

  it('CG-4 门槛值不能是 0（0 意味着永不失败）', () => {
    const collect = (obj) => Object.entries(obj)
      .filter(([k]) => ['statements', 'branches', 'functions', 'lines'].includes(k))
      .flatMap(([, v]) => (typeof v === 'object' ? collect(v) : [[null, v]]))
    for (const [, v] of collect(thresholds)) {
      expect(v).toBeGreaterThan(0)
    }
  })
})
