/**
 * 临时密码生成
 *
 * 三个地方要用它，规则必须**完全一致**（不然一处生成的密码另一处校验不过）：
 *   - 合作方 CSV 批量导入（新建账号）
 *   - 用户 CSV 批量导入（邀请流程）
 *   - 管理端辅助重置客户密码
 *
 * 规则：
 *   - 12 位，大小写 + 数字 + 特殊字符各至少一个（满足门户密码复杂度）
 *   - **去掉易混字符** 0/O/1/l/I —— 这些密码要**口头/线下**告知，
 *     运营照着敲很容易敲错（"0敲成O"这种，客服要重新走一遍流程）
 *   - 用 crypto.randomInt 取随机（不是 Math.random —— 后者熵太低、可被枚举）
 *   - Fisher-Yates 洗牌，避免"首位必是大写"这种可猜模式
 */
import crypto from 'node:crypto'

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const DIGITS = '23456789'
const SPECIAL = '!@#$%&*'
const ALL = UPPER + LOWER + DIGITS + SPECIAL

/** 随机临时密码（12 位） */
export function generateTemporaryPassword () {
  const pick = set => set[crypto.randomInt(set.length)]
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)]
  while (chars.length < 12) chars.push(pick(ALL))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
