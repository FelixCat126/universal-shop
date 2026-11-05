#!/usr/bin/env node

/**
 * 从 Express 路由表生成 OpenAPI 文档（docs/openapi.json）
 *
 * 为什么要有：
 *   - 路由清单不该只活在代码里 —— 有了文档就能 diff、能查、能给别人看
 *   - 前后端契约测试（tests/api/frontendContract.test.js）已经能挡住
 *     「前端调了后端没有的接口」，这份文档是它的可视化版本
 *
 * 诚实说明：这里生成的是**路由骨架**（方法 + 路径 + 参数段 + 标签），
 * 请求/响应体结构没有自动推导 —— 那需要给每个控制器写 schema，
 * 属于后续可以补的工作。文档里用 x-generated-from 标明了来源是路由表。
 *
 * 用法：
 *   npm run gen:openapi          # 生成
 *   npm run gen:openapi -- --check   # 只检查是否与当前路由一致（CI 用）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_FILE = path.join(ROOT, 'docs/openapi.json')

process.env.NODE_ENV = process.env.NODE_ENV || 'test'

/** 路径 → 标签（按前缀归类；没匹配到的归到 default） */
function tagOf (p) {
  if (p.startsWith('/api/admin/export')) return '导出任务'
  if (p.startsWith('/api/admin')) return '管理端'
  if (p.startsWith('/api/partner')) return '合作方'
  if (p.startsWith('/api/auth') || p.startsWith('/api/users')) return '用户与认证'
  if (p.startsWith('/api/orders') || p.startsWith('/api/cart')) return '订单'
  if (p.startsWith('/api/products') || p.startsWith('/api/product-categories')) return '商品'
  if (p.startsWith('/api/coupons')) return '抵扣券'
  if (p.startsWith('/api/bundles')) return '组合包'
  if (p.startsWith('/api/system-config')) return '系统配置'
  if (p.startsWith('/api/security')) return '安全'
  if (p.startsWith('/api/addresses') || p.startsWith('/api/administrative-regions')) return '地址'
  return '其它'
}

/** 已知的接口说明（人工维护，给常用接口补一句人话） */
const SUMMARIES = {
  'POST /api/orders': '创建订单（零售）',
  'GET /api/orders': '我的订单列表',
  'POST /api/orders/quote': '下单前试算（价格/优惠/积分）',
  'GET /api/products': '商品列表',
  'POST /api/admin/export/jobs': '提交异步导出任务',
  'GET /api/admin/export/jobs': '导出任务列表（前端每 3s 轮询）',
  'GET /api/admin/export/jobs/:id/download': '下载已完成的导出文件',
  'DELETE /api/admin/export/jobs/:id': '删除导出任务（连同磁盘文件）',
  'POST /api/auth/login': '用户登录',
  'POST /api/admin/login': '管理员登录'
}

const { default: app } = await import(path.join(ROOT, 'src/server/app.js'))
const { collectRoutes } = await import(path.join(ROOT, 'src/server/utils/routeInventory.js'))

const routes = collectRoutes(app)

/** 把 Express 的 :param 转成 OpenAPI 的 {param} */
function toOpenApiPath (p) {
  return p.replace(/:([A-Za-z_]\w*)/g, '{$1}')
}

const paths = {}
for (const route of routes) {
  if (!route.fullPath.startsWith('/api/')) continue // 只收录 API
  const oaPath = toOpenApiPath(route.fullPath)
  const key = `${route.method} ${route.fullPath}`

  // 路径参数
  const params = [...route.fullPath.matchAll(/:([A-Za-z_]\w*)/g)].map(m => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' }
  }))

  paths[oaPath] = paths[oaPath] || {}
  paths[oaPath][route.method.toLowerCase()] = {
    summary: SUMMARIES[key] || `${route.method} ${route.fullPath}`,
    tags: [tagOf(route.fullPath)],
    parameters: params,
    responses: {
      200: { description: '成功' },
      400: { description: '参数错误' },
      401: { description: '未登录或凭证失效' },
      403: { description: '权限不足' },
      404: { description: '资源不存在' }
    },
    'x-generated-from': 'express-route-table'
  }
}

const doc = {
  openapi: '3.0.3',
  info: {
    title: 'Universal Shop API',
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    description:
      '路由骨架自动生成（来源：Express 路由表）。请求/响应体结构未自动推导 —— ' +
      '以控制器与前端 api 层为准。前后端接口一致性由 tests/api/frontendContract.test.js 守护。'
  },
  servers: [{ url: '/api', description: '同源 API 前缀' }],
  tags: [...new Set(Object.values(paths).flatMap(p => Object.values(p).flatMap(op => op.tags)))]
    .sort()
    .map(name => ({ name })),
  paths
}

const json = JSON.stringify(doc, null, 2)

if (process.argv.includes('--check')) {
  // CI 用：文档是否与当前路由表一致
  const existing = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : ''
  if (existing !== json) {
    console.error('❌ docs/openapi.json 与当前路由表不一致 —— 请运行 npm run gen:openapi')
    process.exit(1)
  }
  console.log('✅ docs/openapi.json 与当前路由表一致')
} else {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, json + '\n', 'utf8')
  const count = Object.values(paths).reduce((n, p) => n + Object.keys(p).length, 0)
  console.log(`✅ 已生成 ${path.relative(ROOT, OUT_FILE)}（${Object.keys(paths).length} 条路径 / ${count} 个操作）`)
}
