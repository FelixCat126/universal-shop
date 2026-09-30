import crypto from 'crypto'
import { logger } from './logger.js'

/**
 * 自包含滑块拼图验证码（纯 SVG 生成，无需 Redis / 图片处理依赖）
 *
 * 设计：服务端不存 state，验证码 token 是 HMAC 签名的：
 *   token = base64url( ts | targetX | nonce | hmac(secret, ts|targetX|nonce) )
 * - 客户端拿到 bg（带缺口的背景）与 piece（拼图块）两张 SVG，
 *   拖动滑块把拼图块对齐缺口后，提交滑块 x 坐标作为 answer
 * - 提交时携带 token + answer：服务端用同一个 secret 验签 + 校验 ts 未过期，
 *   answer 与 targetX 容差 ±6 像素内判通过
 * - HMAC 防伪造，nonce 让相同 (ts, targetX) 也产生不同 token，避免 token 复用
 * - SVG 渐变与装饰元素的颜色/位置由 nonce 派生伪随机种子，保证每次图案不同
 * - nonce 一次性消费：verify 时无论答案对错都先核销 nonce（内存 Map 记录），
 *   同一 token 在 TTL 内无法反复试错/重放
 */

const SECRET =
  process.env.CAPTCHA_SECRET ||
  process.env.JWT_SECRET ||
  'dev-captcha-secret-please-set-CAPTCHA_SECRET'

if (!process.env.CAPTCHA_SECRET) {
  // 保持回退行为不变（避免破坏现有部署），仅提示应独立配置
  logger.warn('未配置 CAPTCHA_SECRET，验证码签名回退使用 JWT_SECRET；建议独立配置 CAPTCHA_SECRET 以隔离密钥用途')
}

const TTL_MS = 5 * 60 * 1000

// 画布与拼图尺寸（与前端契约固定，勿随意改动）
const WIDTH = 300
const HEIGHT = 150
const PIECE_W = 44
const MAX_X = WIDTH - PIECE_W // 滑块可拖到的最大 x
const TARGET_X_MIN = 60 // 缺口 x 下限，避免拼图块初始位置与缺口重叠露出答案
const TARGET_X_MAX = 220
const Y_MIN = 20
const Y_MAX = HEIGHT - PIECE_W - 20
const TOLERANCE = 6 // 滑块 x 与缺口 targetX 的判定容差（像素）

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
 * 由 nonce 派生确定性伪随机数发生器（mulberry32）：
 * 同一张验证码的装饰元素可复现，不同验证码图案各异
 */
const rngFromNonce = (nonce) => {
  let seed = parseInt(nonce.slice(0, 8), 16) >>> 0
  return () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 拼图形状 path（44x44 本地坐标系）：圆角矩形主体 + 右侧凸出半圆榫头。
 * 背景缺口与拼图块共用此函数（仅靠 translate 平移），保证形状完全一致。
 */
const piecePath = () =>
  'M 7 1 H 27 Q 33 1 33 7 V 15 A 7 7 0 0 1 33 29 V 37 Q 33 43 27 43 H 7 Q 1 43 1 37 V 7 Q 1 1 7 1 Z'

const toDataUrl = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

/**
 * 生成背景 SVG：渐变底 + 若干伪随机圆形/色块装饰 + (targetX, y) 处拼图缺口
 */
const buildBackgroundSvg = (nonce, targetX, y) => {
  const rand = rngFromNonce(nonce)
  const hue = Math.floor(rand() * 360)
  const hue2 = (hue + 40 + Math.floor(rand() * 80)) % 360
  const deco = []
  for (let i = 0; i < 7; i++) {
    const cx = (rand() * WIDTH).toFixed(1)
    const cy = (rand() * HEIGHT).toFixed(1)
    const r = (6 + rand() * 16).toFixed(1)
    const h = Math.floor(rand() * 360)
    const o = (0.12 + rand() * 0.22).toFixed(2)
    deco.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${h}, 65%, 62%)" opacity="${o}"/>`)
  }
  for (let i = 0; i < 3; i++) {
    const w = (14 + rand() * 30).toFixed(1)
    const h = (10 + rand() * 22).toFixed(1)
    const x = (rand() * (WIDTH - 40)).toFixed(1)
    const dy = (rand() * (HEIGHT - 30)).toFixed(1)
    const hh = Math.floor(rand() * 360)
    const o = (0.1 + rand() * 0.18).toFixed(2)
    deco.push(`<rect x="${x}" y="${dy}" width="${w}" height="${h}" rx="4" fill="hsl(${hh}, 60%, 58%)" opacity="${o}"/>`)
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue}, 72%, 58%)"/>` +
    `<stop offset="1" stop-color="hsl(${hue2}, 72%, 46%)"/>` +
    '</linearGradient></defs>' +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#g)"/>` +
    deco.join('') +
    // 缺口：深色半透明填充 + 虚线描边
    `<g transform="translate(${targetX} ${y})">` +
    `<path d="${piecePath()}" fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-dasharray="5 3"/>` +
    '</g>' +
    '</svg>'
  return toDataUrl(svg)
}

/**
 * 生成拼图块 SVG：与缺口同一形状，渐变填充 + 实线描边，视觉上可嵌入缺口
 */
const buildPieceSvg = (nonce) => {
  const rand = rngFromNonce(nonce)
  // 与背景取互补色，保证拼图块在背景上清晰可见
  const hue = (Math.floor(rand() * 360) + 180) % 360
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PIECE_W}" height="${PIECE_W}" viewBox="0 0 ${PIECE_W} ${PIECE_W}">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue}, 80%, 62%)"/>` +
    `<stop offset="1" stop-color="hsl(${hue}, 80%, 46%)"/>` +
    '</linearGradient></defs>' +
    `<path d="${piecePath()}" fill="url(#p)" stroke="hsl(${hue}, 85%, 32%)" stroke-width="2" stroke-linejoin="round"/>` +
    '</svg>'
  return toDataUrl(svg)
}

/**
 * 生成滑块拼图验证码：返回 { token, bg, piece, y, width, height, pieceWidth, maxX, expires_in_ms }
 */
export function issueCaptcha () {
  const targetX = crypto.randomInt(TARGET_X_MIN, TARGET_X_MAX + 1)
  const y = crypto.randomInt(Y_MIN, Y_MAX + 1)
  const ts = Date.now()
  const nonce = crypto.randomBytes(8).toString('hex')
  const payload = `${ts}|${targetX}|${nonce}`
  const sig = sign(payload)
  const token = b64u(`${payload}|${sig}`)
  return {
    token,
    bg: buildBackgroundSvg(nonce, targetX, y),
    piece: buildPieceSvg(nonce),
    y,
    width: WIDTH,
    height: HEIGHT,
    pieceWidth: PIECE_W,
    maxX: MAX_X,
    expires_in_ms: TTL_MS
  }
}

/**
 * 校验验证码：true / false
 * @param {string} token
 * @param {string|number} userAnswer 客户端提交的滑块 x 坐标（像素）
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

  // 一次性消费：无论答案对错都先核销 nonce，防同一 token 在 TTL 内穷举答案
  sweepUsed()
  if (usedNonces.has(nonce)) return false
  usedNonces.set(nonce, ts + TTL_MS)

  const answerNum = Number(userAnswer)
  if (!Number.isFinite(answerNum)) return false
  // 滑块 x 与缺口 targetX 容差 ±6 像素内判通过
  if (Math.abs(answerNum - Number(ansStr)) > TOLERANCE) return false

  return true
}
