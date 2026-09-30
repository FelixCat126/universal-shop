/**
 * PostgreSQL 死锁/串行化冲突重试：
 *   40P01 deadlock_detected / 40001 serialization_failure 时退避重试。
 * 注意：fn 必须是可重入的（整个事务应放在 fn 内部，重试时重建事务）。
 *
 * @param {() => Promise<any>} fn
 * @param {{ retries?: number, baseDelayMs?: number }} [options]
 */
export async function withDeadlockRetry (fn, options = {}) {
  const { retries = 3, baseDelayMs = 20 } = options
  let lastErr
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const code = e?.parent?.code || e?.original?.code
      if (code === '40P01' || code === '40001') {
        await new Promise(r => setTimeout(r, baseDelayMs + Math.floor(Math.random() * 30)))
        continue
      }
      throw e
    }
  }
  throw lastErr
}
