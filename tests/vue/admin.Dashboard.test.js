/**
 * VA-Dashboard — Admin 数据面板（轻量级断言）
 *
 * 策略：不 mount 整个组件（Element Plus 重），只验证文件结构和组件 export。
 */
import { describe, it, expect } from 'vitest'

const Dashboard = (await import('@admin/views/Dashboard.vue')).default

describe('VA.admin.Dashboard', () => {
  it('AD-1 Dashboard 是有效 Vue 组件', () => {
    expect(Dashboard).toBeDefined()
    expect(typeof Dashboard).toBe('object')
  })

  it('AD-2 Dashboard 有 setup 函数（script setup）', () => {
    // script setup 编译后导出 setup 函数
    expect(Dashboard.setup || Dashboard.render || Dashboard.template).toBeTruthy()
  })

  it('AD-3 Dashboard 含 stats-card / chart-card 关键 class', async () => {
    // 读源文件验证模板结构
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(
      process.cwd(),
      'src/admin/views/Dashboard.vue'
    )
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain('stats-card')
    expect(content).toContain('admin-stagger')
    expect(content).toContain('chart-card')
    expect(content).toContain('CountUp')
  })

  it('AD-4 Dashboard 引用 CountUp 组件', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(
      process.cwd(),
      'src/admin/views/Dashboard.vue'
    )
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain("import CountUp from '../components/CountUp.vue'")
  })

  it('AD-5 Dashboard KPI 卡片 4 个（stagger-index 0/1/2/3）', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(
      process.cwd(),
      'src/admin/views/Dashboard.vue'
    )
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain("'--ui-stagger-index': 0")
    expect(content).toContain("'--ui-stagger-index': 1")
    expect(content).toContain("'--ui-stagger-index': 2")
    expect(content).toContain("'--ui-stagger-index': 3")
  })
})
