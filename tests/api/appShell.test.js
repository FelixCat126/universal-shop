/**
 * 服务器外壳（app.js）的 HTTP 行为测试
 *
 * app.js 是整个服务的入口：中间件顺序、静态资源、SPA 回退、404 都在这里。
 * 它的问题不会在单元测试里暴露 —— 只会在用户打开页面时暴露
 * （比如 SPA 回退没配好 → 刷新子路由 404；缓存头没配好 → 部署后还引用旧 JS）。
 *
 *   AS-1 GET /api/health → 200 + 健康信息
 *   AS-2 根路径重定向到 /portal/
 *   AS-3 SPA 回退：/admin/orders 这类前端路由返回 index.html
 *   AS-4 SPA 回退不拦截静态资源（.js/.css 等直接 404，不返回 HTML）
 *   AS-5 index.html 不缓存（否则部署后仍引用旧 hash 的 JS）
 *   AS-6 未知 API 路径 → 404（不是 HTML 页面）
 *   AS-7 安全响应头存在
 *   AS-8 静态资源的 Content-Type 与缓存头正确
 *
 * 关于夹具（fixture）：静态资源中间件的 setHeaders **只有在真的取到文件时**
 * 才会执行 —— 没有 dist/ 构建产物时这些分支根本不跑，覆盖率会随
 * "本机跑过 build 没有" 上下浮动 → 覆盖率门禁随机红。
 * 所以这里**自己造**最小 dist 结构，让被测分支确定性地被执行到。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import app from '@server/app.js'

const ROOT = path.resolve(process.cwd())

/**
 * 夹具策略：**只补不删**。
 *
 * 之前这个测试会覆盖 dist 各端的 index.html 再删掉 —— 把真正的构建产物删没了，
 * 导致 dist 状态在多次运行之间不一致 → 覆盖率上下浮动 → 门禁随机红。
 * 现在改成：文件不存在才创建，**永远不删**（dist 本来就是构建产物目录，
 * 下次 npm run build 会覆盖它）。
 */
function ensureFixture (relPath, content) {
  const full = path.join(ROOT, relPath)
  if (fs.existsSync(full)) return false
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
  return true
}

beforeAll(() => {
  // 三个端的最小可服务结构（index.html + 一个 js/css 资源）
  for (const app of ['portal', 'admin', 'partner']) {
    ensureFixture(`dist/${app}/index.html`, `<!doctype html><html><body>${app}</body></html>`)
    ensureFixture(`dist/${app}/assets/app.js`, 'console.log("fixture")')
    ensureFixture(`dist/${app}/assets/app.css`, 'body{color:#000}')
  }
})

describe('服务器外壳 app.js', () => {
  it('AS-1 GET /api/health → 200', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toBeTruthy()
  })

  it('AS-2 根路径重定向到 /portal/', async () => {
    const res = await request(app).get('/')
    expect([301, 302, 307, 308]).toContain(res.status)
    expect(res.headers.location).toMatch(/portal/)
  })

  it('AS-3 SPA 回退：前端路由返回 index.html', async () => {
    const res = await request(app).get('/admin/orders')
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/html/)
    // index.html 不能被缓存 —— 否则部署后浏览器还引用旧 hash 的 JS
    expect(res.headers['cache-control']).toMatch(/no-cache|no-store/)
  })

  it('AS-4 SPA 回退不拦截静态资源（.js 不返回 HTML）', async () => {
    const res = await request(app).get('/admin/assets/does-not-exist-xyz.js')
    expect(res.status).toBe(404)
    expect(res.type).not.toMatch(/html/)
  })

  it('AS-5 未知的 API 路径 → 404（不是 SPA 的 HTML）', async () => {
    const res = await request(app).get('/api/definitely-not-a-real-endpoint')
    expect(res.status).toBe(404)
    expect(res.type).not.toMatch(/html/)
  })

  it('AS-6 安全响应头存在', async () => {
    const res = await request(app).get('/api/health')
    // helmet 至少要给出 nosniff（X-Content-Type-Options）
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options'] || res.headers['content-security-policy']).toBeTruthy()
  })

  it('AS-7 静态资源：Content-Type 与缓存头正确', async () => {
    const js = await request(app).get('/admin/assets/app.js')
    expect(js.status).toBe(200)
    expect(js.headers['content-type']).toMatch(/javascript/)
    // assets 带 hash → 可以长期缓存
    expect(js.headers['cache-control']).toMatch(/max-age=604800|immutable/)

    const css = await request(app).get('/admin/assets/app.css')
    expect(css.status).toBe(200)
    expect(css.headers['content-type']).toMatch(/text\/css/)
  })

  it('AS-8 portal/partner 的 index.html 同样不缓存', async () => {
    for (const appName of ['portal', 'partner']) {
      const res = await request(app).get(`/${appName}/`)
      expect(res.status, appName).toBe(200)
      expect(res.headers['cache-control'], appName).toMatch(/no-cache|no-store/)
    }
  })

  it('AS-9 带扩展名的 SPA 路径不会被回退成 HTML', async () => {
    // 例如 /admin/logo.png 不存在 → 应 404，而不是回退到 index.html
    const res = await request(app).get('/admin/logo-not-here.png')
    expect(res.status).toBe(404)
    expect(res.type).not.toMatch(/html/)
  })

  it('AS-10 三个端的 favicon 都能取到（标签页图标不是空白）', async () => {
    // 注意别把循环变量叫 app —— 会把 import 进来的 Express app 遮掉
    for (const appName of ['portal', 'admin', 'partner']) {
      const res = await request(app).get(`/${appName}/favicon.svg`)
      expect(res.status, appName).toBe(200)
      expect(res.headers['content-type'], appName).toMatch(/svg|xml/)
    }
  })
})
