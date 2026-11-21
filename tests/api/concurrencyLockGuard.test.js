/**
 * 并发锁设计的静态护栏（第 44 轮 · 架构审查⑥）
 * ==========================================
 *
 * ## 要守住的两条约定
 *
 * **约定一：会加行锁的写路径，必须在 `withDeadlockRetry` 保护区里。**
 *
 * 死锁（PG 40P01）在事务里发生 → 整个事务回滚 → 用户看到 500。
 * `withDeadlockRetry` 的作用就是把它变成"重试一次就好了"。
 * 没有它的地方 = 死锁直接变成 500。
 *
 * 现状（第 44 轮修之前）：**7 条写路径漏了它** ——
 * 售后申请创建、合作方订单改状态、在线支付确认、retention 清流水 …
 * 其中两条是**真的会成环**的：
 *   - 售后「申请」锁 Order→AfterSale，「审核」锁 AfterSale→Order（顺序相反）
 *   - 在线支付确认锁 Order→余额，批量取消锁 余额→Product→…
 *
 * **约定二：全局加锁顺序一致。**
 *
 *   Product（product_id 升序） → UserCoupon → UserPointBalance
 *
 * 下单路径一直是这个顺序；取消路径原来是"积分 → 券"（反了），
 * 批量取消还提前给余额行加了 FOR UPDATE（变成"余额 → 商品"，与下单完全相反）。
 * 第 44 轮把两边都对齐了。
 *
 * ## 为什么用静态扫描而不是只靠并发压测
 *
 * 并发压测只能证明"这次没撞上"，证明不了"设计是对的"——
 * 死锁是概率事件，压测漏掉不等于没有。
 * 而"某条路径有没有被 retry 包住"是**可以静态判定**的事实，
 * 静态扫描能保证：以后新加的写路径如果忘了包，红的就是它。
 *
 * ## 豁免清单为什么不是"全部都包"
 *
 * 有 9 处行锁**故意不包** retry —— 它们锁的是**同一把行**，
 * 与别的路径同序 → 天然串行、不会成环（详见每条的 why）。
 * 把它们也硬塞进 retry 只会让事务变长、掩盖真实问题。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { withDeadlockRetry } from '@server/utils/dbRetry.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCAN_DIRS = ['src/server/controllers', 'src/server/services']

/* ------------------------------------------------------------------ *
 * 扫描工具
 * ------------------------------------------------------------------ */

/** 去掉注释与字符串字面量（保留字符数，便于按偏移定位） */
function stripCode (src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? src.length : nl
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i)
      i = e === -1 ? src.length : e + 2
      out += '  '
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch
      i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === q) { i++; break }
        i++
      }
      out += '""'
      continue
    }
    out += ch
    i++
  }
  return out
}

/** withDeadlockRetry( ... ) 的覆盖区间（括号配对） */
function retrySpans (src) {
  const spans = []
  const re = /withDeadlockRetry\s*\(/g
  let m
  while ((m = re.exec(src))) {
    let i = re.lastIndex
    let depth = 1
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') depth--
      i++
    }
    spans.push([m.index, i])
  }
  return spans
}

/** 某个偏移量所在函数的名（往回找最近的一处函数声明） */
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try', 'new', 'await'])
function enclosingFn (src, idx) {
  const lines = src.slice(0, idx).split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const L = lines[i]
    let m = /^\s*(?:export\s+)?(?:static\s+)?(?:async\s+)?function\s+(\w+)/.exec(L)
    if (m) return m[1]
    m = /^\s*(?:export\s+)?(?:static\s+)?async\s+(\w+)\s*\(/.exec(L)
    if (m) return m[1]
    m = /^\s*(?:export\s+)?(?:static\s+)?(\w+)\s*\([^)]*\)\s*\{/.exec(L)
    if (m && !KEYWORDS.has(m[1])) return m[1]
    m = /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/.exec(L)
    if (m) return m[1]
  }
  return '(顶层)'
}

/** 函数体的区间：从声明处开始做花括号配对 */
function functionSpan (src, fnName) {
  /**
   * 参数表要允许解构（`({ where, batchSize })` 里含 `}` 与 `)`），
   * 所以不能用 `[^)]*` —— 那样会在第一个 `)` 处就截断，导致函数找不到。
   */
  const re = new RegExp(
    `(?:static\\s+)?(?:async\\s+)?(?:function\\s+)?\\b${fnName}\\s*\\([\\s\\S]{0,400}?\\)\\s*\\{`,
    'm'
  )
  const m = re.exec(src)
  if (!m) return null
  /**
   * 从**匹配文本的最后一个字符**（函数体的 `{`）开始做花括号配对。
   * 不能用 `indexOf('{', m.index)` —— 参数是解构时
   * （`({ where, batchSize })`）第一个 `{` 是解构的，会把区间提前截断。
   */
  let i = m.index + m[0].length - 1
  let depth = 0
  const start = i
  while (i < src.length) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return [start, i + 1]
    }
    i++
  }
  return null
}

function scanFiles () {
  const out = []
  for (const d of SCAN_DIRS) {
    const dir = path.join(ROOT, d)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) out.push(path.join(d, f))
    }
  }
  return out
}

const LOCK_RE = /lock:\s*(?:transaction\.LOCK\.(?:UPDATE|SHARE)|true)|FOR UPDATE/g

/* ------------------------------------------------------------------ *
 * 约定一：必须受 retry 保护的写路径
 * ------------------------------------------------------------------ */

const MUST_BE_PROTECTED = [
  {
    file: 'src/server/controllers/orderController.js',
    fn: 'createOrder',
    why: '扣库存 + 核销券 + 扣积分，三类资源都在同一个事务里'
  },
  {
    file: 'src/server/controllers/orderController.js',
    fn: 'updateOrderStatus',
    why: '改单条订单状态：锁 Order 行 + 回补资源'
  },
  {
    file: 'src/server/controllers/orderController.js',
    fn: 'bulkUpdateOrderStatus',
    why: '批量改状态：锁多张 Order 行 + 积分余额行 + 商品行'
  },
  {
    file: 'src/server/controllers/orderController.js',
    fn: 'deleteOrder',
    why: '删单：Order 行 + 商品行 + 余额行 + 券行'
  },
  {
    file: 'src/server/controllers/orderController.js',
    fn: 'confirmOnlinePayment',
    why: '确认支付：Order 行 + 积分余额行（与批量取消成环，第 44 轮补）'
  },
  {
    file: 'src/server/controllers/partnerPortalController.js',
    fn: 'createOrder',
    why: '合作方下单：扣库存 + 建单'
  },
  {
    file: 'src/server/controllers/partnerPortalController.js',
    fn: 'setDefaultAddress',
    why: '锁合作方父行；第 44 轮把手写重试循环换成统一工具'
  },
  {
    file: 'src/server/controllers/partnerAdminController.js',
    fn: 'updatePartnerOrderStatus',
    why: '合作方订单改状态：PartnerOrder 行 + 商品行（第 44 轮补）'
  },
  {
    file: 'src/server/controllers/afterSaleController.js',
    fn: 'create',
    why: '申请售后：Order 行 → AfterSale 行（与「审核」顺序相反，第 44 轮补）'
  },
  {
    file: 'src/server/controllers/afterSaleController.js',
    fn: 'review',
    why: '审核售后：AfterSale 行 → Order 行 → 余额行 → 商品行'
  },
  {
    file: 'src/server/services/couponService.js',
    fn: 'claimCouponForUser',
    why: '领券：锁券模板行，防并发超发'
  },
  {
    file: 'src/server/services/couponService.js',
    fn: 'grantCouponsToUsers',
    why: '管理端定向发券：锁券模板行（与自助领券同一把锁），防并发超发'
  },
  {
    file: 'src/server/services/orderTimeoutService.js',
    fn: 'sweepRetailPendingOrders',
    why: '超时清扫：Order 行 + 商品行 + 余额行'
  },
  {
    file: 'src/server/services/orderTimeoutService.js',
    fn: 'sweepPartnerPendingPaymentOrders',
    why: '合作方超时清扫：PartnerOrder 行 + 商品行'
  },
  {
    file: 'src/server/services/retentionService.js',
    fn: 'purgePointTransactionsWithArchive',
    why: '清积分流水：锁积分余额行（第 44 轮补）'
  }
]

/* ------------------------------------------------------------------ *
 * 约定一（续）：豁免清单 —— 故意不包 retry 的行锁点
 * ------------------------------------------------------------------ */

const EXEMPT = [
  {
    file: 'src/server/controllers/addressController.js',
    fn: 'lockUserAddressScope',
    why: '锁辅助函数：调用方（地址 4 条写路径）都只锁**同一把用户行** → 天然串行，不成环'
  },
  {
    file: 'src/server/controllers/afterSaleController.js',
    fn: 'assertNoActiveAfterSale',
    why: '锁辅助函数：调用方 create / review **都在 retry 保护区内**'
  },
  {
    file: 'src/server/controllers/afterSaleController.js',
    fn: 'assertPointsCanBeRevoked',
    why: '锁辅助函数：调用方 create / review **都在 retry 保护区内**'
  },
  {
    file: 'src/server/controllers/partnerPortalController.js',
    fn: 'createAddress',
    why: '锁合作方父行：与 update/delete/setDefault 同序（都先锁 Partner 行）→ 串行，不成环'
  },
  {
    file: 'src/server/controllers/partnerPortalController.js',
    fn: 'updateAddress',
    why: '同上'
  },
  {
    file: 'src/server/controllers/partnerPortalController.js',
    fn: 'deleteAddress',
    why: '同上'
  },
  {
    file: 'src/server/controllers/userController.js',
    fn: 'deleteAccount',
    why: '锁用户行：与地址 4 条路径同序（都先锁用户行）→ 串行，不成环'
  },
  {
    file: 'src/server/services/addressService.js',
    fn: 'createUserAddress',
    why: '锁用户行（第 44 轮新增）：调用方地址控制器已持同一把锁；游客下单在同一事务内 → 同一把锁，串行'
  },
  {
    file: 'src/server/services/userAccountService.js',
    fn: 'anonymizeUserAccount',
    why: '锁辅助函数：两个调用方（自助注销 / 管理端注销）**都在 withDeadlockRetry 保护区内** ✓'
  },
  {
    file: 'src/server/services/pointsService.js',
    fn: 'lockOrCreateBalance',
    why: '积分余额行锁辅助函数：所有调用方都按全局顺序取这一把锁（Product → UserCoupon → UserPointBalance）'
  },
  {
    file: 'src/server/services/couponService.js',
    fn: 'lockTemplate',
    why: '券模板行锁辅助函数：调用方 claimCouponForUser / grantCouponsToUsers **都在 retry 保护区内**，且都只锁同一把券模板行 → 串行，不成环'
  }
]

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */

describe('并发锁设计 · 静态护栏', () => {
  it('LG-1 必须受 retry 保护的写路径，都真的在 withDeadlockRetry 保护区里', () => {
    const missing = []
    for (const item of MUST_BE_PROTECTED) {
      const abs = path.join(ROOT, item.file)
      if (!fs.existsSync(abs)) {
        missing.push(`${item.file}#${item.fn} —— 文件不存在`)
        continue
      }
      const src = stripCode(fs.readFileSync(abs, 'utf8'))
      const span = functionSpan(src, item.fn)
      if (!span) {
        missing.push(`${item.file}#${item.fn} —— 找不到该函数（改了函数名？）`)
        continue
      }
      const body = src.slice(span[0], span[1])
      if (!body.includes('withDeadlockRetry(')) {
        missing.push(`${item.file}#${item.fn} —— ${item.why}`)
      }
    }
    expect(
      missing,
      `这些写路径必须在 withDeadlockRetry 保护区内（死锁 → 500）：\n  ${missing.join('\n  ')}`
    ).toEqual([])
  })

  it('LG-2 除豁免清单外，不允许出现"行锁但没有 retry 保护"的写路径', () => {
    const exemptKeys = new Set(EXEMPT.map(e => `${e.file}#${e.fn}`))
    const offenders = []
    for (const file of scanFiles()) {
      const raw = fs.readFileSync(path.join(ROOT, file), 'utf8')
      const src = stripCode(raw)
      const spans = retrySpans(src)
      LOCK_RE.lastIndex = 0
      let m
      while ((m = LOCK_RE.exec(src))) {
        if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue
        const key = `${file}#${enclosingFn(src, m.index)}`
        if (exemptKeys.has(key)) continue
        const line = raw.slice(0, m.index).split('\n').length
        offenders.push(`${key}（第 ${line} 行）`)
      }
    }
    expect(
      offenders,
      `发现"加行锁但不在 retry 保护区"的写路径 —— 死锁会直接变成 500：\n  ${offenders.join('\n  ')}\n` +
      '（若确实安全，请把它加进测试里的 EXEMPT 清单并写清理由）'
    ).toEqual([])
  })

  it('LG-3 豁免清单里的每一项都仍然存在（防止清单失效后被当成免检区）', () => {
    const missing = []
    for (const e of EXEMPT) {
      const abs = path.join(ROOT, e.file)
      if (!fs.existsSync(abs)) {
        missing.push(`${e.file} —— 文件不存在`)
        continue
      }
      const src = stripCode(fs.readFileSync(abs, 'utf8'))
      if (!functionSpan(src, e.fn)) missing.push(`${e.file}#${e.fn} —— 函数不存在（改名了？）`)
    }
    expect(missing, `豁免清单里的函数都不见了，请同步更新：\n  ${missing.join('\n  ')}`).toEqual([])
  })
})

describe('并发锁设计 · withDeadlockRetry 行为', () => {
  it('LG-4 遇到 40P01（死锁）会重试并最终成功', async () => {
    let calls = 0
    const result = await withDeadlockRetry(async () => {
      calls++
      if (calls < 3) {
        const err = new Error('deadlock detected')
        err.parent = { code: '40P01' }
        throw err
      }
      return 'ok'
    }, { baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(calls, '应当重试到第 3 次才成功').toBe(3)
  })

  it('LG-5 遇到 40001（序列化冲突）同样重试', async () => {
    let calls = 0
    await withDeadlockRetry(async () => {
      calls++
      if (calls < 2) {
        const err = new Error('serialization failure')
        err.original = { code: '40001' }
        throw err
      }
      return 'ok'
    }, { baseDelayMs: 1 })
    expect(calls).toBe(2)
  })

  it('LG-6 其它错误码**不重试**（业务错误不该被重试掩盖）', async () => {
    let calls = 0
    await expect(withDeadlockRetry(async () => {
      calls++
      const err = new Error('唯一约束冲突')
      err.parent = { code: '23505' }
      throw err
    }, { baseDelayMs: 1 })).rejects.toThrow('唯一约束冲突')
    expect(calls, '23505 不该重试').toBe(1)
  })

  it('LG-7 重试次数用尽后抛出最后一次错误（不吞错）', async () => {
    let calls = 0
    await expect(withDeadlockRetry(async () => {
      calls++
      const err = new Error('一直死锁')
      err.parent = { code: '40P01' }
      throw err
    }, { retries: 2, baseDelayMs: 1 })).rejects.toThrow('一直死锁')
    expect(calls, '重试次数上限要生效').toBe(2)
  })
})
