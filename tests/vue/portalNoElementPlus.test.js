/**
 * 门户端禁用 Element Plus 组件（第 54 轮）
 * ==================================
 *
 * ## 背景：一次真实的"整站白屏"
 *
 * 第 54 轮给门户加通知页时，我在里面写了 `<el-pagination>` ——
 * 而**门户端根本没有引入 Element Plus**（三端里只有管理后台用了它）。
 *
 * 后果：未注册组件在渲染时抛错 → Vue 的 `onErrorCaptured` 兜底遮罩弹出
 * 「页面出了点问题」→ **整个门户（首页、商品页、购物车、结算…）全崩**，
 * 不只是通知页坏掉。
 *
 * 而且它**不会在 lint 或单元测试里暴露** —— 只有真跑起来才炸。
 *
 * ## 这条护栏守什么
 *
 * 扫 `src/portal/**` 里所有 `<el-xxx` 的**模板使用**（排除注释里的示例文字），
 * 发现就红，并说明门户端该用原生标签/Tailwind。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../..')
const PORTAL_DIR = path.join(ROOT, 'src/portal')

/** 递归收集 .vue / .js */
function collect (dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      collect(full, acc)
    } else if (/\.(vue|js)$/.test(entry.name)) {
      acc.push(full)
    }
  }
  return acc
}

describe('门户端不使用 Element Plus 组件', () => {
  it('src/portal 下没有 <el-xxx> 组件的使用', () => {
    const problems = []

    for (const file of collect(PORTAL_DIR)) {
      const src = fs.readFileSync(file, 'utf8')

      // 去掉注释（模板注释 <!-- --> 与 JS 注释 // /* */），避免把说明文字当成使用
      const noComments = src
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')

      // <el-xxx  或  </el-xxx>
      const re = /<\/?el-[a-z0-9-]+/gi
      let m
      while ((m = re.exec(noComments)) !== null) {
        problems.push(`  ${path.relative(ROOT, file)} → ${m[0]}`)
        break // 每个文件只报一次，够定位
      }
    }

    expect(
      problems.join('\n'),
      '门户端**没有引入 Element Plus**（只有管理后台用了）—— ' +
      '在这里用 <el-xxx> 会导致组件未注册、渲染抛错，' +
      '整个门户崩进「页面出了点问题」兜底遮罩（不只是当前页坏）。\n' +
      '门户端请用原生标签 + Tailwind 类。\n' +
      problems.join('\n')
    ).toBe('')
  })
})
