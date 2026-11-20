/**
 * PostgreSQL 死锁/串行化冲突重试：
 *   40P01 deadlock_detected / 40001 serialization_failure 时退避重试。
 * 注意：fn 必须是可重入的（整个事务应放在 fn 内部，重试时重建事务）。
 *
 * ## 第 44 轮：重试要留痕
 *
 * 原来重试是**完全静默**的：死锁被吞掉、整个事务重跑，外部看不出任何区别。
 * 后果是"死锁风暴"不可见 —— 数据库日志里一片 40P01，应用侧一切正常，
 * 只表现为"偶尔慢一点"。这类问题往往要等很久才被发现。
 *
 * 现在每次重试都记一条 warn（错误码 + 第几次重试 + 退避时长），
 * 这样"死锁频率"是可观测的：偶发一条正常，成片出现就是锁顺序/锁粒度出问题了。
 *
 * @param {() => Promise<any>} fn
 * @param {{ retries?: number, baseDelayMs?: number, label?: string }} [options]
 */
import { logger } from './logger.js'

export async function withDeadlockRetry (fn, options = {}) {
  const { retries = 3, baseDelayMs = 20, label = '' } = options
  let lastErr
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const code = e?.parent?.code || e?.original?.code
      if (code === '40P01' || code === '40001') {
        const delayMs = baseDelayMs + Math.floor(Math.random() * 30)
        /**
         * 留痕（第 44 轮）：重试不是"没事"，是"出过一次事"。
         * 不记的话，一次死锁风暴在应用日志里是完全看不见的。
         */
        logger.warn('检测到数据库锁冲突，重试中', {
          code,
          label: label || fn.name || '(匿名)',
          attempt: attempt + 1,
          maxAttempts: retries,
          delayMs,
          err: e?.message
        })
        await new Promise(r => setTimeout(r, delayMs))
        continue
      }
      throw e
    }
  }
  /**
   * 重试次数用尽仍失败：把最后一次错误抛出去（调用方按业务错误处理）。
   * 这里再记一条 error —— 连续 N 次都冲突，说明不是偶发抖动。
   */
  logger.error('数据库锁冲突重试耗尽', {
    code: lastErr?.parent?.code || lastErr?.original?.code,
    label: label || fn.name || '(匿名)',
    attempts: retries,
    err: lastErr?.message
  })
  throw lastErr
}
