/**
 * 带 HTTP 状态码的业务错误（第 44 轮抽出为公共工具）。
 *
 * ## 为什么要有它
 *
 * 事务里"发现业务上不可接受"时，正确写法是**抛错**（让事务回滚），
 * 而不是 `res.status(400).json(...)` 之后继续往下走 —— 后者会带着
 * "已经响应了、但事务还没结束"的状态继续执行，连接挂在 idle in transaction。
 *
 * 之前各控制器各写各的（afterSaleController 有本地 httpError，
 * 其它地方直接 `throw new Error()` 然后在 catch 里统一 500），
 * 结果是"带状态码的业务错误"这个约定散落各处。
 *
 * 抽出来之后：抛 `httpError(400, '…')` → 外层 catch 统一
 * `res.status(err.status).json({ success:false, message: err.message })`。
 *
 * ⚠️ 注意：被 `withDeadlockRetry` 包裹的事务里**必须**用抛错，
 * 不能用"提前 return" —— 否则 retry 会把它当成正常返回，
 * 错误响应就丢了（这正是这个工具存在的意义）。
 */
export function httpError (status, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  err.isBusinessError = true
  if (extra && typeof extra === 'object') Object.assign(err, extra)
  return err
}
