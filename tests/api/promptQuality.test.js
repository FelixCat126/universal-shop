/**
 * 提示信息质量护栏（第 48 轮）
 * ============================
 *
 * 提示是系统对用户说话的唯一出口。这一轮把它立了几条规矩：
 *
 *   PQ-1 校验失败要说**人话**：不许出现 joi 原文（英文 + 正则）
 *   PQ-2 校验失败要**带字段**：details[] 里要有 field，前端才能把红框标到那一栏
 *   PQ-3 订单状态不许甩**内部枚举值**（pending/shipping/cancelled）
 *   PQ-4 账号被停用要**明确区分**于"密码错误"（带 code，前端好翻译）
 *   PQ-5 用户可见的提示里不许出现**网络/框架的技术黑话**
 *        （Network Error / Failed to fetch / Request failed with status code…）
 *   PQ-6 "加载失败"与"没有数据"必须**分开**（列表区要有独立的失败态）
 *
 * ## 为什么这些要立成护栏
 *
 * 这些毛病有一个共同点：**不报错、不白屏、测试也全绿** ——
 * 用户只是"看不懂""点不动"，而 CI 一片安静。
 * 所以只能靠静态扫描 + 行为断言盯着。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import Joi from 'joi'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers } from '../helpers/test-helpers.js'
import { validationErrorBody } from '@server/utils/validationMessages.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const models = () => TestDatabase.getSequelize().models

/** 技术黑话黑名单（出现在用户可见文案里就是 bug） */
const TECH_JARGON = [
  'Network Error',
  'Failed to fetch',
  'Request failed with status code',
  'timeout of ',
  'fails to match',
  'must be a number',
  'must be a string',
  'Validation error',
  'ECONNREFUSED',
  'is not a valid',
  'Cannot read propert'
]

/** 扫一个目录下的 .vue/.js，找"用户可见的提示文案"里有没有技术黑话 */
function scanForTechJargon (relDir) {
  const dir = path.join(ROOT, relDir)
  const offenders = []
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      if (['dist', 'node_modules', 'i18n'].includes(name)) continue
      const p = path.join(d, name)
      const st = fs.statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      if (!/\.(vue|js)$/.test(name)) continue
      const src = fs.readFileSync(p, 'utf8')
      const lines = src.split('\n')
      lines.forEach((line, i) => {
        const trimmed = line.trim()
        // 注释与 console 输出不算（那是给开发看的）
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
        if (/console\./.test(line)) return
        for (const jargon of TECH_JARGON) {
          if (line.includes(jargon)) {
            offenders.push(`${path.relative(ROOT, p)}:${i + 1} —— 文案里出现了技术黑话「${jargon}」`)
          }
        }
      })
    }
  }
  walk(dir)
  return offenders
}

describe('提示信息质量', () => {
  it('PQ-1/2 校验失败：人话 + 字段级 details', () => {
    const schema = Joi.object({
      contact_name: Joi.string().min(1).max(100).required(),
      contact_phone: Joi.string().pattern(/^[1-9]\d{7,14}$/).required(),
      quantity: Joi.number().integer().min(1).max(5000).required()
    })
    const { error } = schema.validate({ contact_name: '', contact_phone: '12', quantity: 0 }, { abortEarly: false })
    const body = validationErrorBody(error)

    // PQ-1：人话（不许出现 joi 原文）
    expect(body.message).not.toMatch(/fails to match|must be|required/i)
    expect(body.message).toContain('收货人姓名')
    expect(body.message).toContain('联系电话')

    // PQ-2：字段级 details
    expect(Array.isArray(body.details)).toBe(true)
    const fields = body.details.map(d => d.field)
    expect(fields).toContain('contact_name')
    expect(fields).toContain('contact_phone')
    expect(fields).toContain('quantity')
    for (const d of body.details) {
      expect(typeof d.message).toBe('string')
      expect(d.message.length).toBeGreaterThan(0)
    }
  })

  it('PQ-3 订单状态提示用中文名，不甩内部枚举值', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/server/controllers/orderController.js'), 'utf8')
    // 不允许再出现 "不允许从「${...}」" 这种直接插枚举的写法
    const rawEnumPatterns = [
      /不允许从「\$\{fromStatus\}」/,
      /不允许从「\$\{order\.status\}」/,
      /无效的订单状态：\$\{invalidStatus\}/
    ]
    for (const re of rawEnumPatterns) {
      expect(re.test(src), `还残留着直接插内部枚举值的写法：${re}`).toBe(false)
    }
    // 中文名映射存在
    const text = fs.readFileSync(path.join(ROOT, 'src/server/utils/orderStatusText.js'), 'utf8')
    expect(text).toContain("pending: '待支付'")
    expect(text).toContain("cancelled: '已取消'")
  })

  it('PQ-4 账号被停用：与"密码错误"区分开，并带 code（前端好翻译）', async () => {
    await TestDatabase.clearAllData()
    const { Administrator } = models()
    const admin = await Administrator.create({
      username: 'disabled_admin',
      password: 'Dis#1234',
      role: 'super_admin',
      is_active: false
    })
    const res = await request(app).post('/api/admin/login')
      .send({ username: 'disabled_admin', password: 'Dis#1234' })
    expect(res.status, '账号被停用应明确告知').toBe(403)
    expect(res.body.code, '前端据此用自己语言说这句话').toBe('ACCOUNT_DISABLED')
    expect(res.body.message).not.toMatch(/密码错误/)

    const { Partner } = models()
    await Partner.create({
      login: 'disabled_partner',
      password: 'Dis#1234',
      display_name: '停用合作方',
      account_kind: 'dealer',
      is_active: false
    })
    const pRes = await request(app).post('/api/partner/login')
      .send({ login: 'disabled_partner', password: 'Dis#1234' })
    expect(pRes.status).toBe(403)
    expect(pRes.body.code).toBe('ACCOUNT_DISABLED')
    expect(pRes.body.message).not.toMatch(/密码错误/)
  })

  it('PQ-5 用户可见的提示里没有技术黑话', () => {
    const offenders = [
      ...scanForTechJargon('src/portal'),
      ...scanForTechJargon('src/admin'),
      ...scanForTechJargon('src/partner')
    ]
    expect(
      offenders,
      `这些提示把技术黑话甩给了用户：\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })

  it('PQ-6 列表区把"加载失败"与"没有数据"分开', () => {
    const checks = [
      { file: 'src/portal/views/Home.vue', must: ['loadError'] },
      { file: 'src/partner/views/Shop.vue', must: ['loadError'] }
    ]
    const problems = []
    for (const c of checks) {
      const src = fs.readFileSync(path.join(ROOT, c.file), 'utf8')
      for (const m of c.must) {
        if (!src.includes(m)) problems.push(`${c.file} —— 缺少 ${m}（加载失败会渲染成"没有数据"）`)
      }
      if (!/v-if="loadError"|v-else-if="loadError"/.test(src)) {
        problems.push(`${c.file} —— 模板里没有按 loadError 分支（加载失败与空数据没分开）`)
      }
    }
    expect(problems, `加载失败与空数据没分开：\n  ${problems.join('\n  ')}`).toEqual([])
  })
})
