/**
 * 运维健壮性：健康检查与优雅停机
 *
 *   GS-1 数据库正常 → /api/health 200
 *   GS-2 数据库不可用 → /api/health **503**（就绪探针不能误报"正常"）
 *   GS-3 优雅停机：收到 SIGTERM 要走 server.close（等在途请求做完），不是直接杀
 *   GS-4 PM2 的 kill_timeout 要 ≥ 服务端的停机超时（否则优雅停机白做）
 *
 * GS-2 是真实故障注入：把 sequelize.query 打挂，看健康检查会不会仍然报"正常"。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import request from 'supertest'
import app from '@server/app.js'
import sequelize from '@server/config/database.js'
import { injectFault, restoreFaults } from '../helpers/faultInjection.js'

const ROOT = path.resolve(__dirname, '../..')

afterEach(() => {
  restoreFaults()
})

describe('健康检查', () => {
  it('GS-1 数据库正常 → 200', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.ready).toBe(true)
  })

  it('GS-2 数据库不可用 → 503（不能误报"服务器运行正常"）', async () => {
    // 运行期数据库断开 —— 之前健康检查只看**启动时**的状态，
    // 数据库断了照样返回 200，就绪探针会一直往坏实例上打流量。
    injectFault(sequelize, 'query', new Error('connection terminated'))

    const res = await request(app).get('/api/health')
    expect(res.status).toBe(503)
    expect(res.body.ready).toBe(false)
    expect(res.body.message).toMatch(/数据库/)
  })
})

describe('优雅停机', () => {
  it('GS-3 收到 SIGTERM 要停收新连接、等在途请求做完', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/server/app.js'), 'utf8')
    expect(src, '缺少 SIGTERM 处理 → 部署时 pm2 stop 会硬砍在途请求').toMatch(/process\.on\(['"]SIGTERM['"]/)
    expect(src, '缺少 server.close → 停机时会立刻断开所有连接').toMatch(/server\.close\(/)
    expect(src, '缺少强制退出兜底 → 在途请求卡住时进程永远不退出').toMatch(/强制退出|process\.exit\(0\)/)
  })

  it('GS-4 PM2 的 kill_timeout 要 ≥ 服务端的停机超时', () => {
    const pkg = fs.readFileSync(path.join(ROOT, 'package.sh'), 'utf8')
    const m = pkg.match(/kill_timeout:\s*(\d+)/)
    expect(m, 'PM2 配置缺少 kill_timeout（默认只有 1.6s，优雅停机会被 SIGKILL 打断）').toBeTruthy()
    const killTimeout = Number(m[1])
    const appSrc = fs.readFileSync(path.join(ROOT, 'src/server/app.js'), 'utf8')
    const t = appSrc.match(/GRACEFUL_SHUTDOWN_TIMEOUT_MS\s*=\s*(\d+)/)
    expect(t, '服务端停机超时常量不见了').toBeTruthy()
    const serverTimeout = Number(t[1])
    expect(killTimeout, `PM2 kill_timeout(${killTimeout}) 必须 ≥ 服务端超时(${serverTimeout})`).toBeGreaterThanOrEqual(serverTimeout)
  })
})

describe('运维指标', () => {
  it('GS-5 /api/admin/metrics 含连接池状态与慢请求数', async () => {
    const { TestHelpers } = await import('../helpers/test-helpers.js')
    const { Administrator } = (await import('@server/models/index.js')).default
    const admin = await Administrator.create({
      username: `gs_admin_${Date.now()}`,
      password: 'GsPwd#1234',
      role: 'super_admin',
      is_active: true
    })
    const token = TestHelpers.generateAdminToken(admin)
    const res = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d).toHaveProperty('databasePool')
    expect(d).toHaveProperty('slowRequests')
    expect(d).toHaveProperty('uptimeSeconds')
  })
})

describe('PM2 配置', () => {
  it('GS-6 package.sh 生成的 PM2 配置能被 require（ESM 项目里必须是 .cjs）', () => {
    const require = createRequire(import.meta.url)
    const pkg = fs.readFileSync(path.join(ROOT, 'package.sh'), 'utf8')
    const m = pkg.match(/ecosystem\.config\.cjs[\s\S]*?<< 'EOF'\n([\s\S]*?)\nEOF/)
    expect(m, 'package.sh 里应生成 ecosystem.config.cjs（.js 在 ESM 项目里 PM2 加载不了）').toBeTruthy()

    // 放到项目目录里再 require —— .cjs 是否被当 CommonJS 取决于最近的 package.json
    const tmp = path.join(ROOT, 'ecosystem.config.check.cjs')
    fs.writeFileSync(tmp, m[1] + '\n')
    try {
      const cfg = require(tmp)
      expect(cfg.apps?.[0]?.name).toBe('universal-shop')
      expect(cfg.apps?.[0]?.kill_timeout, '缺 kill_timeout → 优雅停机被 SIGKILL 打断').toBeGreaterThanOrEqual(15000)
    } finally {
      fs.unlinkSync(tmp)
    }
  })
})
