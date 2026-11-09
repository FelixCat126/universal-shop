/**
 * 远程图片抓取（带 SSRF 防护）
 *
 * 场景：CSV 批量导入商品时，运营在 image 列填远程图片 URL，
 * 系统把它下载下来、压缩、生成变体、存到本地 —— 否则 18 个商品要传 18 次图。
 *
 * ⚠️ 这是**典型的 SSRF 入口**：让服务端去请求运营给的 URL，
 * 攻击者就能让服务器去访问：
 *   - 169.254.169.254（云厂商元数据服务 → 能拿到云凭据！）
 *   - 127.0.0.1 / 内网地址（数据库、Redis、管理后台）
 *   - file:// / gopher:// 之类的协议
 *
 * 所以这里的防护是**多层**的，缺一层就等于没做：
 *
 * 1. 协议只允许 http/https
 * 2. 主机名**解析出 IP 后逐个检查**：只要有一个是内网/环回/链路本地/保留地址就拒绝
 *    （只检查"看起来像域名"是不够的 —— 域名可以解析到 127.0.0.1）
 * 3. **连接用解析出来的 IP**（不是域名），并自己带 Host 头 ——
 *    这样"检查时解析到公网 IP、连接时解析到内网 IP"的 DNS 重绑定也挡得住
 * 4. 重定向**手动跟随**，每一跳都重新做 1~3 的检查
 *    （对方返回 302 到 169.254.169.254 是最常见的绕过手法）
 * 5. 超时 + 响应体大小上限（防止把内存/磁盘撑爆）
 * 6. 抓下来后校验**确实是图片**（magic bytes）—— 顺带挡住"返回 HTML/JS"的探测
 */
import dns from 'node:dns/promises'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'

/** 单张图片体积上限（默认 5MB） */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** 单次请求超时 */
const DEFAULT_TIMEOUT_MS = 10_000
/** 最多跟几跳重定向 */
const MAX_REDIRECTS = 3

/**
 * 判断一个 IPv4 是否是"不该去访问"的地址。
 * @param {string} ip 点分十进制
 */
export function isPrivateIPv4 (ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) {
    // 解析不出来 → 当成不安全（宁可拒）
    return true
  }
  const [a, b, c] = parts
  if (a === 0) return true // 0.0.0.0/8 本网络
  if (a === 10) return true // 10/8 私有
  if (a === 127) return true // 127/8 环回
  if (a === 169 && b === 254) return true // 169.254/16 链路本地（含 169.254.169.254 元数据）
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12 私有
  if (a === 192 && b === 168) return true // 192.168/16 私有
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  // ⚠️ 下面几个"文档用/协议分配"段必须精确到 /24 —— 只比前两段会**误杀真实公网 IP**
  // （比如把整个 203.0.0.0/16 都拦掉，会连 203.0.114.1 这种正常地址一起挡了）
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24 IETF 协议分配
  if (a === 192 && b === 0 && c === 2) return true // 192.0.2.0/24 文档用
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15 基准测试
  if (a === 198 && b === 51 && c === 100) return true // 198.51.100/24 文档用
  if (a === 203 && b === 0 && c === 113) return true // 203.0.113/24 文档用
  if (a >= 224) return true // 224/4 组播 + 240/4 保留 + 广播
  return false
}

/**
 * 判断一个 IPv6 是否是"不该去访问"的地址。
 * @param {string} ip
 */
export function isPrivateIPv6 (ip) {
  const addr = ip.toLowerCase().split('%')[0] // 去掉 zone id
  if (addr === '::' || addr === '::1') return true // 未指定 / 环回
  if (addr.startsWith('fe80')) return true // fe80::/10 链路本地
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true // fc00::/7 唯一本地
  if (addr.startsWith('ff')) return true // ff00::/8 组播
  // IPv4 映射（::ffff:127.0.0.1）—— 按内嵌的 IPv4 判断
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  // NAT64（64:ff9b::/96）—— 同样按内嵌 IPv4 判断
  const nat64 = addr.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/)
  if (nat64) return isPrivateIPv4(nat64[1])
  // 其它保留段（100::/64 丢弃段等）—— 保守起见只放行全球单播 2000::/3
  if (!addr.startsWith('2') && !addr.startsWith('3')) return true
  return false
}

/**
 * 判断一个 IP 是否可以安全访问。
 * @param {string} ip
 */
export function isPublicIP (ip) {
  const version = net.isIP(ip)
  if (version === 4) return !isPrivateIPv4(ip)
  if (version === 6) return !isPrivateIPv6(ip)
  return false // 不是合法 IP → 拒绝
}

/**
 * 解析并校验 URL：返回可安全连接的 { hostname, port, path, ip }
 * @throws {Error} 消息里带上原因
 */
export async function resolveSafeUrl (rawUrl) {
  let url
  try {
    url = new URL(String(rawUrl))
  } catch {
    throw new Error('图片地址不是合法的 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`只允许 http/https 链接（当前是 ${url.protocol}）`)
  }
  if (url.username || url.password) {
    throw new Error('链接里不能带用户名密码')
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80)

  // IP 直连：直接判定
  if (net.isIP(hostname)) {
    if (!isPublicIP(hostname)) {
      throw new Error('不允许访问内网/本机地址')
    }
    return { url, hostname, port, ip: hostname }
  }

  // 域名：解析出所有 IP，**逐个**检查
  let addresses
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error(`域名解析失败：${hostname}`)
  }
  if (!addresses || addresses.length === 0) {
    throw new Error(`域名解析失败：${hostname}`)
  }
  for (const addr of addresses) {
    if (!isPublicIP(addr.address)) {
      throw new Error('目标域名解析到了内网/本机地址，已拒绝')
    }
  }
  // 用第一个地址连接（检查与连接用同一个 IP → 防 DNS 重绑定）
  return { url, hostname, port, ip: addresses[0].address }
}

/**
 * 下载远程图片。
 *
 * @param {string} rawUrl
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxBytes]
 * @param {number} [options.maxRedirects]
 * @returns {Promise<{buffer: Buffer, contentType: string, finalUrl: string}>}
 */
export async function fetchRemoteImage (rawUrl, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = MAX_IMAGE_BYTES,
    maxRedirects = MAX_REDIRECTS
  } = options

  let currentUrl = String(rawUrl)
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const safe = await resolveSafeUrl(currentUrl)

    const result = await new Promise((resolve, reject) => {
      const client = safe.url.protocol === 'https:' ? https : http
      const req = client.request(
        {
          // ⚠️ 连**解析出来的 IP**（而不是域名）：防止"检查时是公网 IP、
          // 连接时被 DNS 改成内网 IP"的重绑定攻击
          host: safe.ip,
          servername: safe.hostname, // TLS SNI 用域名
          port: safe.port,
          path: safe.url.pathname + safe.url.search,
          method: 'GET',
          headers: {
            // Host 必须带原域名（我们已经连到 IP 了）
            Host: safe.url.host,
            'User-Agent': 'UniversalShop-ImageFetcher/1.0',
            Accept: 'image/*',
            'Accept-Encoding': 'identity'
          },
          timeout: timeoutMs
        },
        (res) => {
          // 重定向：手动跟随，每一跳重新校验
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume() // 丢弃响应体
            resolve({ redirect: new URL(res.headers.location, currentUrl).toString() })
            return
          }
          if (res.statusCode !== 200) {
            res.resume()
            reject(new Error(`图片下载失败（HTTP ${res.statusCode}）`))
            return
          }
          const contentType = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
          const declared = Number(res.headers['content-length'] || 0)
          if (declared && declared > maxBytes) {
            res.resume()
            reject(new Error(`图片太大（${Math.round(declared / 1024 / 1024)}MB，上限 ${Math.round(maxBytes / 1024 / 1024)}MB）`))
            return
          }
          const chunks = []
          let size = 0
          res.on('data', (chunk) => {
            size += chunk.length
            if (size > maxBytes) {
              res.destroy()
              reject(new Error(`图片太大（上限 ${Math.round(maxBytes / 1024 / 1024)}MB）`))
              return
            }
            chunks.push(chunk)
          })
          res.on('end', () => {
            resolve({ buffer: Buffer.concat(chunks), contentType })
          })
          res.on('error', reject)
        }
      )
      req.on('timeout', () => {
        req.destroy(new Error('图片下载超时'))
      })
      req.on('error', reject)
      req.end()
    })

    if (result.redirect) {
      currentUrl = result.redirect
      continue
    }
    return { ...result, finalUrl: currentUrl }
  }
  throw new Error('重定向次数过多')
}

/**
 * 图片 magic bytes 校验（与上传接口用的是同一套规则）。
 * 只信 Content-Type 是不够的 —— 对方可以返回 image/png 但内容是 HTML。
 *
 * @param {Buffer} buffer
 * @returns {string} 识别出的类型
 */
export function detectImageType (buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    throw new Error('图片内容为空或过短')
  }
  const b = buffer
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return 'png'
  }
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'jpg'
  }
  // GIF: "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return 'gif'
  }
  // WEBP: "RIFF"...."WEBP"
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp'
  }
  throw new Error('内容不是受支持的图片（只支持 PNG/JPEG/GIF/WebP）')
}
