/**
 * 部署脚本的护栏（第 44 轮）
 * ==========================
 *
 * ## 发现的 bug
 *
 * `deploy-on-server.sh` 用 `rsync -a --delete` 同步代码。
 * `--delete` 会删掉"**本地包里没有、服务器上有**"的文件。
 *
 * `.deploy_initialized` 就是这样一个文件：它标记"这个目录已经初始化过了"，
 * 脚本靠它区分**首次部署**与**增量部署**。
 *
 * 它不在本地包里，也**没在排除清单里** → 每次部署都被删掉 →
 * **每一次部署都被当成首次部署**：
 *   - 重跑 `npm install`（`DEPLOY_UPGRADE_SKIP_NPM` 的"增量跳过 npm"意图完全失效）
 *   - 重跑整套初始化流程（PG sync + 配置播种 + 管理员检查）
 *
 * 本次线上排查时的实测证据：部署输出里出现了
 * `✅ 已写入首次部署标记` —— 而增量部署时**不应该**出现这行。
 *
 * 当时没出事，是因为初始化流程恰好是幂等的（且明确"不改管理员密码"）；
 * 但"每次都当首次部署"这件事本身就是隐患：
 * 将来任何一个**不幂等**的初始化步骤，都会在每次部署时重复执行。
 *
 * ## 用例
 *   DS-1 用 `--delete` 时，服务器专属文件必须都在排除清单里
 *   DS-2 排除清单里不能有**通配**（`--exclude '*'` 之类会把要同步的东西也排除掉）
 *   DS-3 脚本里的注释必须用 `#`（bash 会把 JS 风格的块注释当命令执行 —— 第 41 轮的事故）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = path.join(ROOT, 'scripts/deploy-on-server.sh')

/**
 * 服务器上**本地包里没有**、但必须留在服务器上的文件/目录。
 *
 * 每加一个"部署过程自己产生的文件"，都要往这里加一条 ——
 * 否则下一次 rsync 就会把它删掉。
 */
const SERVER_ONLY_ENTRIES = [
  '.deploy_initialized', // 首次/增量部署标记（本次 bug 的主角）
  '.deps-hash',          // 依赖指纹（被删过 → 每次部署都判成"依赖变化" → 每次都 npm install）
  '.env',                // 生产配置（密钥、DSN）
  'database/',           // 备份
  'public/uploads/',     // 用户上传的图片
  'logs/',               // 运行日志
  'ssl/',                // 证书
  'node_modules/',       // 依赖（服务器上按平台装）
  '.pg_migration_done'   // SQLite→PG 迁移标记
]

describe('部署脚本护栏', () => {
  const script = fs.readFileSync(SCRIPT, 'utf8')

  it('DS-1 用 --delete 时，服务器专属文件必须都在 rsync 排除清单里', () => {
    // 找出 rsync 那条命令（含换行续接）
    const m = /rsync\s+[^\n]*\\[\s\S]*?\$\{SOURCE_DIR\}\/"\s+"\$\{DEPLOY_PATH\}\/"/.exec(script)
    expect(m, '没找到 rsync 命令 —— 脚本结构变了？').toBeTruthy()
    const rsyncCmd = m[0]

    const usesDelete = /--delete/.test(rsyncCmd)
    const excludes = [...rsyncCmd.matchAll(/--exclude\s+'([^']+)'/g)].map(x => x[1])

    expect(excludes.length, 'rsync 应当有排除清单').toBeGreaterThan(0)
    if (!usesDelete) {
      // 没有 --delete 就不会删文件，排除清单可以宽松一点
      return
    }
    const missing = SERVER_ONLY_ENTRIES.filter(
      e => !excludes.some(x => x === e || x === e.replace(/\/$/, '') || `${x}/` === e)
    )
    expect(
      missing,
      `这些服务器专属文件没有排除 → rsync --delete 会把它们删掉：\n  ${missing.join('\n  ')}`
    ).toEqual([])
  })

  it('DS-2 排除清单里不能有通配（会把要同步的代码也排除掉）', () => {
    const m = /rsync\s+[^\n]*\\[\s\S]*?\$\{SOURCE_DIR\}\/"\s+"\$\{DEPLOY_PATH\}\/"/.exec(script)
    expect(m).toBeTruthy()
    const excludes = [...m[0].matchAll(/--exclude\s+'([^']+)'/g)].map(x => x[1])
    const wildcards = excludes.filter(e => e.includes('*') || e === '.' || e === './')
    expect(
      wildcards,
      `排除项里出现通配会把要同步的代码一起排掉：${wildcards.join(', ')}`
    ).toEqual([])
  })

  it('DS-3 bash 脚本里的注释必须用 # （/** */ 会被 bash 当命令执行）', () => {
    /**
     * 第 41 轮的事故：脚本里写了 JS 风格的块注释（斜杠星号开头、星号斜杠结尾），
     * bash 把它当成命令执行 → "/bin: Is a directory" → 部署中断、服务停着。
     *
     * 判定：行首（缩进后）出现块注释的开始记号或结束记号，就是可疑写法。
     *
     * ⚠️ 本文件自己的注释里也**不能**出现那两个记号的字面量 ——
     * 否则会提前终止注释（写这个测试时真踩了一次）。
     */
    const lines = script.split('\n')
    const offenders = []
    lines.forEach((line, i) => {
      const t = line.trim()
      if (t.startsWith('/**') || t === '*/' || t.startsWith('/*')) {
        offenders.push(`第 ${i + 1} 行: ${t.slice(0, 60)}`)
      }
    })
    expect(
      offenders,
      `bash 脚本里的注释必须用 # ：\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })
})
