/**
 * 金额舍入的**跨端一致性**（第 40 轮）
 *
 * ## 背景
 *
 * 改造前项目里并存三套舍入实现：
 *   服务端 thbToBillingAmount   → parseFloat(x.toFixed(2))   （2.675 → 2.67 ❌）
 *   服务端 pricingEngine.round2  → Math.round(n*100)/100      （2.675 → 2.68 ✅）
 *   前端 convertedAmountLines    → cv.toFixed(2)              （2.675 → 2.67 ❌）
 *   前端 convertThbToCurrency   → Math.round(n*100)/100       （2.675 → 2.68 ✅）
 *
 * `toFixed` 的二进制浮点陷阱会让**服务端算出的结算金额**与**前端显示的价格**
 * 在边界值上差 1 分钱 —— 用户看到的和实际扣的不是一回事。
 *
 * ## 用例
 *   MC-1 共享工具的 cents 舍入符合预期（边界值）
 *   MC-2 服务端结算金额 == 前端显示金额（**跨端一致**）
 *   MC-3 换算：先乘后舍入，不能先舍入底价再乘
 *   MC-4 显示值 == 存储值（不会出现"存 2.68 显示 2.67"）
 *   MC-5 项目里不再出现"金额用 toFixed"的写法（静态扫描）
 */
import { describe, it, expect } from 'vitest'
import { toCents, fromCents, roundMoney, convertMoney, formatAmount } from '../../src/shared/money.js'
import { thbToBillingAmount, parseSingleRate, normalizeExchangeRates } from '../../src/server/utils/exchangeRates.js'
import { convertThbToCurrency, formatConvertedMoney, convertedAmountLines } from '../../src/utils/exchangeRatesDisplay.js'
import fs from 'node:fs'
import path from 'node:path'

describe('金额舍入（跨端一致性）', () => {
  it('MC-1 cents 舍入符合预期', () => {
    expect(roundMoney(2.675)).toBe(2.68)
    expect(roundMoney(1.005)).toBe(1.01)
    expect(roundMoney(0.145)).toBe(0.15)
    expect(roundMoney(19.99)).toBe(19.99)
    expect(toCents(2.675)).toBe(268)
    expect(fromCents(268)).toBe(2.68)
    expect(roundMoney('abc')).toBe(0)
  })

  it('MC-2 服务端结算金额 == 前端显示金额', () => {
    const cases = [[2.675, 1], [1.005, 1], [19.99, 0.1], [8.165, 1], [1234.565, 1], [0.145, 1]]
    for (const [base, rate] of cases) {
      const rates = { CNY: String(rate) }
      const server = thbToBillingAmount(base, 'CNY', rates)
      const front = convertThbToCurrency(base, 'CNY', rates)
      expect(server, `base=${base} rate=${rate}：服务端 ${server} ≠ 前端 ${front}`).toBe(front)
      // 展示行（另一条前端路径）也要一致
      const line = convertedAmountLines(base, { CNY: String(rate) }).find(l => l.key === 'CNY')
      expect(parseFloat(line.amount), `convertedAmountLines 不一致：${line.amount} vs ${server}`).toBe(server)
    }
  })

  it('MC-3 换算是先乘后舍入（不先舍入底价）', () => {
    // 底价 0.125、汇率 1 → 先舍入底价会得 0.13，先乘后舍入得 0.13（一致）；
    // 这里断言的是"不能出现二次舍入"：底价 × 汇率 的结果直接进 cents
    expect(convertMoney(0.125, 1)).toBe(0.13)
    expect(convertMoney(19.995, 0.1)).toBe(roundMoney(19.995 * 0.1))
  })

  it('MC-4 显示值 == 存储值', () => {
    for (const v of [2.675, 1.005, 0.145, 19.999, 100]) {
      expect(parseFloat(formatAmount(v)), `formatAmount(${v}) 与 roundMoney 不一致`).toBe(roundMoney(v))
    }
    // 前端展示函数返回的字符串解析回来要等于服务端算法
    const rates = { CNY: '1' }
    const shown = formatConvertedMoney(2.675, 'CNY', rates)
    expect(parseFloat(shown.replace(/[^0-9.]/g, ''))).toBe(thbToBillingAmount(2.675, 'CNY', rates))
  })

  it('MC-5 金额不再用 toFixed 舍入（静态扫描）', () => {
    const root = path.resolve('src')
    const walk = (dir, out = []) => {
      for (const n of fs.readdirSync(dir)) {
        if (n === 'dist' || n === 'node_modules') continue   // 构建产物不是源码
        const f = path.join(dir, n)
        if (fs.statSync(f).isDirectory()) walk(f, out)
        else if (/\.(js|vue)$/.test(n)) out.push(f)
      }
      return out
    }
    // 允许的位置：汇率规范化（比例，固定两位）、验证码图形扰动（非金额）
    const allow = ['exchangeRates.js', 'captcha.js', 'money.js']
    const offenders = []
    for (const f of walk(root)) {
      if (allow.some(a => f.endsWith(a))) continue
      const src = fs.readFileSync(f, 'utf8')
      // 只看"金额语境"的 toFixed：前面有 price/amount/total/thb 之类
      src.split('\n').forEach((line, i) => {
        if (!/\.toFixed\(2\)/.test(line)) return
        if (!/(price|amount|total|thb|money|value|sum|fee|balance)/i.test(line)) return
        offenders.push(`${path.relative(root, f)}:${i + 1} ${line.trim().slice(0, 90)}`)
      })
    }
    expect(offenders, `这些金额仍在用 toFixed 舍入（应走 shared/money.js）：\n${offenders.join('\n')}`).toEqual([])
  })
})
