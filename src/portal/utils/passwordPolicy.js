/**
 * 门户密码策略 —— 转发到共享层，保持既有 import 路径不变。
 *
 * 规则本体在 `src/utils/passwordPolicy.js`（与后端逐条对齐），
 * 这里只做转发，避免同一套规则出现第二份副本。
 */
export {
  PASSWORD_MIN_LEN,
  describePasswordPolicyFailure,
  meetsPasswordPolicy
} from '../../utils/passwordPolicy.js'
