/**
 * 前端响应解析口径的护栏（第 45 轮）
 * ================================
 *
 * ## 为什么要有这条
 *
 * 项目里有**两套**前端请求写法，返回的东西形状完全不同：
 *
 * | 写法 | 返回值 | 业务字段在哪 |
 * |---|---|---|
 * | `adminStore.apiRequest()` / `partnerStore.api()` | **fetch 的 Response 对象** | 得先 `await res.json()`，字段在 `json.success` |
 * | `src/admin/api/*` `src/portal/api/*` 里的 axios 封装 | **axios 响应对象** | 字段在 `res.data.success` |
 * | store 自己的方法（`cartStore.addToCart` 等） | **业务对象** | 直接 `result.success` |
 *
 * 混着写就会出现"操作其实成功了，界面却报失败"这类问题 ——
 * 第 45 轮查出**三处**真 bug：
 *
 * | 位置 | 现象 |
 * |---|---|
 * | 合作方「再来一单」 | 把 Response 当 axios 用（`res.data.data.products`）→ 恒为空 → **功能 100% 失效**，每次都弹「无法重新下单」 |
 * | 管理端改密页 | 判 `res.success`（Response 上没有）→ **改密成功了却弹「失败」**，且不跳登录（服务端 token_version 已递增） |
 * | 管理端订单行内改状态 | 判 axios 响应的 `res.success`（在 `res.data` 里）→ **状态改成功了却弹「错误」，且不刷新列表** |
 *
 * 这类 bug **不会报错、不会白屏**，只是"结果永远不对"，很容易被当成"偶发"。
 *
 * ## 用例
 *   RP-1 fetch 系（apiRequest / partner store.api）：结果必须先 `.json()`，不许直接读 `.success` / `.data`
 *   RP-2 axios 系（admin/portal 的 api 模块导出函数）：业务字段必须读 `res.data.*`，不许直接读 `res.success`
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 扫描的目录 */
const SCAN_DIRS = ['src/admin', 'src/partner', 'src/portal']

function walk (dir, out = []) {
  for (const name of fs.readdirSync(path.join(ROOT, dir))) {
    if (['dist', 'node_modules'].includes(name)) continue
    const p = path.join(dir, name)
    const st = fs.statSync(path.join(ROOT, p))
    if (st.isDirectory()) walk(p, out)
    else if (/\.(vue|js)$/.test(name)) out.push(p)
  }
  return out
}

/**
 * 收集 axios 系接口函数名（src/admin/api/*.js、src/portal/api/*.js 导出的函数）。
 * 这些函数返回的是 **axios 响应对象**（业务字段在 res.data）。
 */
function axiosApiFunctionNames () {
  const names = new Set()
  for (const dir of ['src/admin/api', 'src/portal/api']) {
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) continue
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.js')) continue
      const src = fs.readFileSync(path.join(abs, f), 'utf8')
      for (const m of src.matchAll(/export\s+(?:const|function|async\s+function)\s+(\w+)/g)) {
        names.add(m[1])
      }
    }
  }
  return names
}

/**
 * 去掉注释与字符串字面量（保留字符数，便于按偏移定位）。
 *
 * 必须去注释 —— 否则注释里写一句「之前这里判的是 res.success」就会被当成真的代码，
 * 护栏自己写出假阳性（写这个护栏时真踩了一次）。
 */
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

/** 取出「变量 = await 调用(...)」这种赋值 */
const ASSIGN_AWAIT = /const\s+(\w+)\s*=\s*await\s+([\w.]+)\s*\(/

/** fetch 系的调用（返回 Response） */
const FETCH_CALLERS = ['adminStore.apiRequest', 'store.apiRequest', 'partnerStore.api', 'store.api']

describe('前端响应解析口径', () => {
  it('RP-1 fetch 系接口：结果必须先 .json()，不能直接读 .success / .data', () => {
    const offenders = []
    for (const file of SCAN_DIRS.flatMap(d => walk(d))) {
      const raw = fs.readFileSync(path.join(ROOT, file), 'utf8')
      const src = stripCode(raw)
      const lines = src.split('\n')
      lines.forEach((line, i) => {
        const m = ASSIGN_AWAIT.exec(line)
        if (!m) return
        const [, v, caller] = m
        if (!FETCH_CALLERS.includes(caller)) return
        const window = lines.slice(i + 1, i + 13).join('\n')
        const hasJson = window.includes(`${v}.json()`)
        const bareSuccess = new RegExp(`\\b${v}\\??\\.success\\b`).test(window)
        const bareData = new RegExp(`\\b${v}\\??\\.data\\b`).test(window)
        if (hasJson) return
        if (bareSuccess || bareData) {
          offenders.push(
            `${file}:${i + 1} —— ${caller}() 返回的是 fetch Response，` +
            `必须先 await ${v}.json() 再读业务字段（现在直接读了 ${bareSuccess ? '.success' : '.data'}）`
          )
        }
      })
    }
    expect(
      offenders,
      `这些地方把 fetch 的 Response 当成业务对象用了（操作会"成功却报错"或功能恒失效）：\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })

  it('RP-2 axios 系接口：业务字段必须读 res.data.*，不能直接读 res.success', () => {
    const axiosNames = axiosApiFunctionNames()
    const offenders = []
    for (const file of SCAN_DIRS.flatMap(d => walk(d))) {
      const raw = fs.readFileSync(path.join(ROOT, file), 'utf8')
      const src = stripCode(raw)
      const lines = src.split('\n')
      lines.forEach((line, i) => {
        const m = ASSIGN_AWAIT.exec(line)
        if (!m) return
        const [, v, fn] = m
        // 只看 axios 系的接口函数（最后一节是函数名）
        const fnName = fn.split('.').pop()
        if (!axiosNames.has(fnName)) return
        const window = lines.slice(i + 1, i + 13).join('\n')
        const bareSuccess = new RegExp(`\\b${v}\\??\\.success\\b`).test(window)
        const dataSuccess = new RegExp(`\\b${v}\\??\\.data\\??\\.success\\b`).test(window)
        if (bareSuccess && !dataSuccess) {
          offenders.push(
            `${file}:${i + 1} —— ${fn}() 返回的是 axios 响应对象，` +
            `业务字段在 ${v}.data 里（现在读的是 ${v}.success → 恒为 undefined）`
          )
        }
      })
    }
    expect(
      offenders,
      `这些地方把 axios 响应对象当业务对象读了（操作会"成功却报错"）：\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })
})
