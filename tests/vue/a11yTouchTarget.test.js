/**
 * 触控热区护栏：高频图标按钮的可点区域不能小于 44px
 *
 * 手机上 32px 的按钮很难点中（iOS HIG 建议 44pt、Android 建议 48dp）。
 * 购物车里的"加/减数量""删除"是**最常点**的按钮，原来只有 32px。
 *
 * 为什么只查这两个页面而不是全仓：全仓扫描会把文字链接、Tab、
 * 包装组件（Ripple）也算进来 —— 那些热区偏小是合理的设计（它们不是主操作），
 * 混进来就成了噪声测试。聚焦"只有图标 + 有 aria-label 的按钮"，
 * 那是真正的**图标按钮**，热区必须够。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')

/** 目标页面：用户最常点的两个 */
const TARGETS = [
  'src/portal/views/cart/Cart.vue',
  'src/portal/views/product/ProductDetail.vue'
]

/** 触控热区达标的特征（Tailwind 类名） */
const BIG_ENOUGH = [
  /min-h-\[44px\]/,
  /min-h-\[48px\]/,
  /\bh-11\b/,
  /\bh-12\b/,
  /\bw-11\b/,
  /py-3/,
  /py-4/
]

describe('触控热区', () => {
  it('TAP-1 购物车/商品详情的图标按钮，触控热区 ≥ 44px', () => {
    const offenders = []
    for (const rel of TARGETS) {
      const file = path.join(ROOT, rel)
      const src = fs.readFileSync(file, 'utf8')
      // 只有图标的按钮 = 有 aria-label 且 body 里没有文本
      const re = /<button\b([^>]*)>([\s\S]{0,300}?)<\/button>/g
      let m
      while ((m = re.exec(src))) {
        const attrs = m[1]
        const body = m[2]
        if (!/aria-label/.test(attrs)) continue          // 有文字的按钮不算图标按钮
        const text = body.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').trim()
        if (text) continue                              // 有可见文字 → 不算图标按钮
        const classAttr = /class="([^"]*)"/.exec(attrs)?.[1] || ''
        if (BIG_ENOUGH.some(re => re.test(classAttr))) continue
        const line = src.slice(0, m.index).split('\n').length
        offenders.push(`${rel}:${line}  ${classAttr.slice(0, 60)}`)
      }
    }
    expect(
      offenders,
      '图标按钮的触控热区应 ≥44px（手机上点不中）：\n' + offenders.join('\n')
    ).toEqual([])
  })
})
