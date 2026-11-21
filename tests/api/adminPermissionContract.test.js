/**
 * 管理端「界面动作 ↔ 后端权限」一致性护栏（第 47 轮）
 * ==================================================
 *
 * ## 为什么要有这条
 *
 * 后端对高危操作收得很紧（资损级/账号级操作只给 admin/super_admin），
 * 但**界面原来不拦** → 操作员点「删除订单」「重置客户密码」「审核售后」，
 * 得到的只有一句"权限不足"，看起来像系统坏了。
 *
 * 权限还**抄了两份**：后端 `models/Administrator.js` 的 ROLE_PERMISSIONS 是权威，
 * 前端 `stores/admin.js` 里又抄了一份 → 改一边忘了另一边，界面就会拦错/放错。
 *
 * ## 用例
 *   PM-1 前端的权限表必须与后端权威表**逐字一致**（防漂移）
 *   PM-2 高权限动作：界面必须按角色隐藏（且后端守卫仍在）
 *   PM-3 super_admin 专属页面：路由 meta 必须带 requiresSuperAdmin
 *      （否则直接输 URL 会看到一个报错页，而不是明确的"无权限"）
 *   PM-4 后端的高权限守卫不能被摘掉（防"为了方便"放开）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROLE_PERMISSIONS } from '@server/models/Administrator.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * 高权限动作清单：
 *   route    —— 后端路由（用于核对守卫还在不在）
 *   level    —— 后端要求的门槛
 *   view     —— 界面文件
 *   gate     —— 界面里必须出现的门槛判断（角色 helper）
 *   apiCall  —— 界面里调用的接口片段（用于确认这是同一个动作）
 */
const HIGH_RISK_ACTIONS = [
  {
    route: "router.delete('/orders/:id'",
    level: 'super_admin',
    view: 'src/admin/views/Orders.vue',
    gate: 'adminStore.isSuperAdmin',
    apiCall: "command=\"delete\""
  },
  {
    route: "router.put('/users/:id/password'",
    level: 'admin',
    view: 'src/admin/views/Users.vue',
    gate: 'adminStore.isAdminOrAbove',
    apiCall: 'resetPassword'
  },
  {
    route: "router.delete('/users/:id'",
    level: 'admin',
    view: 'src/admin/views/Users.vue',
    gate: 'adminStore.isAdminOrAbove',
    apiCall: 'deleteUserAccount'
  },
  {
    route: "router.put('/after-sales/:id/status'",
    level: 'admin',
    view: 'src/admin/views/AfterSales.vue',
    gate: 'canReview',
    apiCall: 'openReview'
  }
]

describe('管理端权限一致性', () => {
  it('PM-1 前端的权限表与后端权威表逐字一致', () => {
    const store = read('src/admin/stores/admin.js')
    // 前端 store 里抄了一份 rolePermissions（注释里也写了"权限检查"）
    const m = /const rolePermissions = \{([\s\S]*?)\n {4}\}/.exec(store)
    expect(m, '前端 store 里找不到 rolePermissions 副本').toBeTruthy()
    const body = m[1]
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      // ⚠️ 必须锚到行首：`admin:` 会误匹配 `super_admin:` 里的那一段
      const roleRe = new RegExp(`^\\s*${role}:\\s*\\[([^\\]]*)\\]`, 'm')
      const rm = roleRe.exec(body)
      expect(rm, `前端权限表缺少角色 ${role}`).toBeTruthy()
      const front = rm[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
      const back = perms.map(String)
      expect(
        front.slice().sort(),
        `角色 ${role} 的前端权限表与后端不一致（后端是权威）`
      ).toEqual(back.slice().sort())
    }
  })

  it('PM-2 高权限动作：界面按角色隐藏，且后端守卫仍在', () => {
    const routes = read('src/server/routes/adminRoutes.js')
    const problems = []
    for (const item of HIGH_RISK_ACTIONS) {
      // 后端守卫还在不在
      const line = routes.split('\n').find(l => l.includes(item.route))
      if (!line) {
        problems.push(`${item.route} —— 后端路由找不到了`)
        continue
      }
      const needSuper = item.level === 'super_admin'
      const hasSuper = line.includes('requireSuperAdmin')
      const hasAdmin = line.includes('requireUserAdmin') || line.includes('requireAdminOnly')
      if (needSuper && !hasSuper) problems.push(`${item.route} —— 后端的 super_admin 守卫没了`)
      if (!needSuper && !hasAdmin) problems.push(`${item.route} —— 后端的 admin 守卫没了`)

      // 界面有没有按角色隐藏
      const view = read(item.view)
      if (!view.includes(item.gate)) {
        problems.push(`${item.view} —— ${item.apiCall} 没有按角色隐藏（缺 ${item.gate}）`)
      }
      if (!view.includes(item.apiCall)) {
        problems.push(`${item.view} —— 找不到动作 ${item.apiCall}`)
      }
    }
    expect(problems, `界面与后端权限不一致：\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('PM-3 super_admin 专属页面的路由 meta 带 requiresSuperAdmin', () => {
    const router = read('src/admin/router/index.js')
    const problems = []
    for (const p of ['/operation-logs', '/audit-logs', '/system-config']) {
      const m = new RegExp(`path: '${p}'[\\s\\S]{0,200}?meta: \\{([^}]*)\\}`).exec(router)
      if (!m) {
        problems.push(`路由 ${p} 找不到了`)
        continue
      }
      if (!m[1].includes('requiresSuperAdmin')) {
        problems.push(`路由 ${p} 缺 requiresSuperAdmin（直接输 URL 会看到报错页）`)
      }
    }
    expect(problems, `超管专属页面的路由门槛：\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('PM-4 后端的高权限守卫没被摘掉（防"为了方便"放开）', () => {
    const routes = read('src/server/routes/adminRoutes.js')
    const mustKeep = [
      { route: "router.delete('/orders/:id'", guard: 'requireSuperAdmin' },
      { route: "router.get('/operation-logs'", guard: 'requireSuperAdmin' },
      { route: "router.get('/audit-logs'", guard: 'requireSuperAdmin' },
      { route: "router.get('/metrics'", guard: 'requireSuperAdmin' },
      { route: "router.put('/users/:id/password'", guard: 'requireUserAdmin' },
      { route: "router.delete('/users/:id'", guard: 'requireUserAdmin' },
      { route: "router.put('/after-sales/:id/status'", guard: 'requireAdminOnly' }
    ]
    const missing = []
    for (const item of mustKeep) {
      const line = routes.split('\n').find(l => l.includes(item.route))
      if (!line) { missing.push(`${item.route} —— 路由没了`); continue }
      if (!line.includes(item.guard)) {
        missing.push(`${item.route} —— 缺少 ${item.guard}`)
      }
    }
    expect(missing, `高权限守卫被摘掉了：\n  ${missing.join('\n  ')}`).toEqual([])
  })
})
