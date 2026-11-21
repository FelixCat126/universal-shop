/**
 * 管理端「模板里用的变量必须在 setup 顶层可见」（第 47 轮）
 * =====================================================
 *
 * ## 为什么要有这条
 *
 * 第 47 轮给用户列表加了「按角色隐藏」的门槛后，**整个用户页渲染不出来** ——
 * 连「搜索」按钮都没了，e2e 直接超时。
 *
 * 根因：模板里写了 `adminStore.isAdminOrAbove`，但那个文件里
 * `const adminStore = useAdminStore()` **只写在函数内部**（两个局部声明），
 * `<script setup>` 的模板作用域里根本没有 `adminStore` →
 * 渲染时 `adminStore.isAdminOrAbove` 抛 TypeError → **整页白**。
 *
 * 这类错误 api 测试**抓不到**（后端没问题），只有浏览器里才炸，
 * 而且症状是"整个页面没了"，很容易误判成"我改坏了别的地方"。
 *
 * ## 断言
 *   TS-1 模板里引用了 `adminStore.*` 的视图，必须有**顶层** `const adminStore = ...`
 *   TS-2 其它常见的 store/工具引用同理（useRouter / useRoute 等 hook 也必须在顶层）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const VIEW_DIR = path.join(ROOT, 'src/admin/views')

/**
 * 取 <script setup> 段与**模板段**。
 *
 * ⚠️ 模板段不能用 `/<template>[\s\S]*?<\/template>/` 取：
 * Vue SFC 里还有**嵌套的 `<template #default="...">`**（表格列的插槽），
 * 非贪婪匹配会在第一个内层 `</template>` 就停 → 模板段只取到一小截
 * → 后面真正的模板引用就"看不见"了（第一版就这么翻车的）。
 *
 * 正确做法：模板段 = 第一个 `<template>` 到 `<script setup>` 之间。
 */
function splitSfc (src) {
  const tStart = src.indexOf('<template>')
  const sStart = src.indexOf('<script setup>')
  const template = (tStart >= 0 && sStart > tStart) ? src.slice(tStart, sStart) : ''
  const setup = /<script setup>([\s\S]*?)<\/script>/.exec(src)?.[1] || ''
  return { template, setup }
}

/**
 * 脚本里"顶层"的声明。
 *
 * 判定用**行首缩进为 0**（<script setup> 的顶层语句都是 0 缩进，
 * 函数体内的声明一定缩进）——
 * 不用花括号深度计数：代码里的字符串/正则含花括号会把深度算错
 * （第一版就是这么翻车的：函数内的声明被当成顶层，护栏形同虚设）。
 */
function topLevelDeclarations (setup) {
  const names = new Set()
  for (const rawLine of setup.split('\n')) {
    if (rawLine.length !== rawLine.trimStart().length) continue // 有缩进 → 在函数体内
    const m = /^const\s+(\w+)\s*=/.exec(rawLine.trim())
    if (m) names.add(m[1])
  }
  return names
}

describe('管理端模板作用域', () => {
  it('TS-1 模板里用到的 adminStore / 常用组合式函数，必须在 setup 顶层声明', () => {
    const problems = []
    const files = fs.readdirSync(VIEW_DIR).filter(f => f.endsWith('.vue'))
    for (const f of files) {
      const src = fs.readFileSync(path.join(VIEW_DIR, f), 'utf8')
      const { template, setup } = splitSfc(src)
      if (!template) continue
      const top = topLevelDeclarations(setup)

      // 模板里出现 adminStore. 就必须有顶层 adminStore
      if (/\badminStore\s*\./.test(template) && !top.has('adminStore')) {
        problems.push(`${f} —— 模板里用了 adminStore.*，但 setup 顶层没有 const adminStore = ...`)
      }
      // 组合式函数（useXxx() 的结果被模板直接用）—— 只查最常被模板直接引用的几个
      for (const name of ['router', 'route', 't', 'locale']) {
        if (new RegExp(`\\b${name}\\s*[.\\[]`).test(template) && !top.has(name)) {
          problems.push(`${f} —— 模板里用了 ${name}. ，但 setup 顶层没有 const ${name} = ...`)
        }
      }
    }
    expect(
      problems,
      `模板引用了 setup 顶层不存在的变量（运行时整页报错，api 测试抓不到）：\n  ${problems.join('\n  ')}`
    ).toEqual([])
  })

  it('TS-2 模板用到 adminStore 的视图，必须是"顶层 const adminStore = useAdminStore()"', () => {
    const problems = []
    const files = fs.readdirSync(VIEW_DIR).filter(f => f.endsWith('.vue'))
    for (const f of files) {
      const src = fs.readFileSync(path.join(VIEW_DIR, f), 'utf8')
      const { template, setup } = splitSfc(src)
      // 只管"模板真的用到"的视图 —— 模板不用它时，写在函数里完全无害
      if (!/\badminStore\s*\./.test(template)) continue
      if (!/^const adminStore = useAdminStore\(\)/m.test(setup)) {
        problems.push(`${f} —— adminStore 的顶层声明写法应为 const adminStore = useAdminStore()`)
      }
    }
    expect(problems, `adminStore 声明方式不一致：\n  ${problems.join('\n  ')}`).toEqual([])
  })
})
