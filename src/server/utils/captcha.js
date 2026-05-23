import crypto from 'crypto'

/**
 * 自包含数字运算验证码（无需 Redis）
 *
 * 设计：服务端不存 state，验证码 token 是 HMAC 签名的：
 *   token = base64url( ts | ans | nonce | hmac(secret, ts|ans|nonce) )
 * - 客户端只看到 question（如 "3 + 5"），不知道 answer
 * - 提交时携带 token + answer：服务端用同一个 secret 验签 + 校验 answer 与 ts 未过期
 * - HMAC 防伪造，nonce 让相同 (ts, answer) 也产生不同 token，避免 token 复用
 *
 * 为防"已用 token 重放"，可选地配合 LRU 内存做一次性消费（消费过的 nonce 拒收）。
 */

const SECRET =
  process.env.CAPTCHA_SECRET ||
  process.env.JWT_SECRET ||
  'dev-captcha-secret-please-set-CAPTCHA_SECRET'

const TTL_MS = 5 * 60 * 1000

const usedNonces = new Map() // nonce -> exp

const sweepUsed = () => {
  const now = Date.now()
  for (const [n, exp] of usedNonces) {
    if (exp <= now) usedNonces.delete(n)
  }
}

const sign = (payload) =>
  crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')

const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url')
const b64uDec = (s) => Buffer.from(s, 'base64url').toString('utf8')

/**
 * 生成验证码：返回 { question, token }
 */
export function issueCaptcha () {
  const a = crypto.randomInt(1, 10)
  const b = crypto.randomInt(1, 10)
  const ops = ['+', '-']
  const op = ops[crypto.randomInt(0, ops.length)]
  let answer
  if (op === '+') answer = a + b
  else answer = a - b
  const ts = Date.now()
  const nonce = crypto.randomBytes(8).toString('hex')
  const payload = `${ts}|${answer}|${nonce}`
  const sig = sign(payload)
  const token = b64u(`${payload}|${sig}`)
  return {
    token,
    question: `${a} ${op} ${b} = ?`,
    expires_in_ms: TTL_MS
  }
}

/**
 * 校验验证码：true / false
 * @param {string} token
 * @param {string|number} userAnswer
 */
export function verifyCaptcha (token, userAnswer) {
  if (!token || userAnswer === undefined || userAnswer === null) return false
  let raw
  try {
    raw = b64uDec(String(token))
  } catch {
    return false
  }
  const parts = raw.split('|')
  if (parts.length !== 4) return false
  const [tsStr, ansStr, nonce, sig] = parts
  const ts = parseInt(tsStr, 10)
  if (!Number.isFinite(ts)) return false
  if (Date.now() - ts > TTL_MS) return false

  const expectedSig = sign(`${ts}|${ansStr}|${nonce}`)
  if (
    Buffer.byteLength(expectedSig) !== Buffer.byteLength(sig) ||
    !crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(sig))
  ) {
    return false
  }

  if (Number(ansStr) !== Number(userAnswer)) return false

  sweepUsed()
  if (usedNonces.has(nonce)) return false
  usedNonces.set(nonce, ts + TTL_MS)

  return true
}
