/**
 * 故障注入测试辅助
 *
 * 为什么需要：
 *   订单/合作方控制器里有一批**只在出错时才走**的分支 ——
 *   catch 里的 500、PG 死锁(40P01)后的重试、唯一约束冲突(23505)后的兜底。
 *   它们平时测不到（要真的死锁、真的并发撞唯一索引才能触发），
 *   但恰恰是**出事时才会跑**的代码 —— 没测过就等于没写过。
 *
 *   故障注入让这些分支变得**可确定地**触发：
 *   - 让某个方法抛出带 PG 错误码的错误
 *   - 让它第一次失败、第二次成功（模拟"重试后成功"）
 *
 * 用法：
 *   injectFault(Order, 'findAll', () => { throw pgError('40P01', 'deadlock') })
 *   failOnce(Order, 'findAll', pgError('40P01'), () => [rows])
 */
import { vi } from 'vitest'

/**
 * 造一个带 PG 错误码的错误。
 *
 * 尽量**忠实还原真实 PG 错误**：真实错误里除了 code，还有
 *   - parent.constraint：约束名（用来分辨"撞的是哪个唯一索引"）
 *   - fields：冲突的列（Sequelize 解析出来的）
 * 少了这些，业务代码里"是订单号撞库还是幂等键撞库"的分支就分不出来 ——
 * 注入的错误要能真正走到那条分支。
 *
 * @param {string} code PG 错误码（如 '40P01' 死锁 / '23505' 唯一冲突）
 * @param {string} [message]
 * @param {object} [extra] { constraint, fields }
 */
export function pgError (code, message = `pg error ${code}`, extra = {}) {
  const err = new Error(message)
  err.name = 'SequelizeDatabaseError'
  err.parent = { code, message, ...(extra.constraint ? { constraint: extra.constraint } : {}) }
  err.original = { code, message, ...(extra.constraint ? { constraint: extra.constraint } : {}) }
  if (extra.fields) err.fields = extra.fields
  return err
}

/**
 * 让某个方法固定抛出错误。
 * @returns {import('vitest').MockInstance} 便于之后 restore
 */
export function injectFault (model, method, error) {
  return vi.spyOn(model, method).mockImplementation(() => {
    throw error
  })
}

/**
 * 让某个方法**第一次失败、之后正常**（模拟可重试的错误）。
 * @param {object} model
 * @param {string} method
 * @param {Error} error 第一次要抛的
 * @param {Function} [successImpl] 之后要执行的（不传就调用原实现）
 */
export function failOnce (model, method, error, successImpl) {
  let failed = false
  const original = model[method]
  // 注意用 function 而不是箭头函数：箭头函数的 this 是词法作用域的，
  // 会把实例方法（Order.prototype.update）绑到**原型**上而不是实例 ——
  // 结果是"第二次调用"跑在一个没有 this.dataValues 的假 this 上，行为完全不对。
  return vi.spyOn(model, method).mockImplementation(async function (...args) {
    if (!failed) {
      failed = true
      throw error
    }
    if (successImpl) return successImpl.apply(this, args)
    return original.apply(this, args)
  })
}

/**
 * 让某个方法失败 N 次后成功。
 */
export function failTimes (model, method, error, times = 1, successImpl) {
  let count = 0
  const original = model[method]
  return vi.spyOn(model, method).mockImplementation(async function (...args) {
    if (count < times) {
      count++
      throw error
    }
    if (successImpl) return successImpl.apply(this, args)
    return original.apply(this, args)
  })
}

/**
 * 恢复所有被 spy 的方法。
 */
export function restoreFaults () {
  vi.restoreAllMocks()
}
