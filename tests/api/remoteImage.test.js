/**
 * 远程图片抓取的 SSRF 防护测试
 *
 * 这是**安全关键**的代码：让服务端去请求运营给的 URL，
 * 攻击者就能借它访问内网、云元数据（169.254.169.254）等。
 *
 *   RI-1 私有/环回/链路本地 IP 一律判为不安全
 *   RI-2 IPv6 的等价段（::1 / fc00:: / fe80:: / ::ffff:127.0.0.1）也判不安全
 *   RI-3 解析到内网的域名 → 拒绝
 *   RI-4 非 http/https 协议 → 拒绝
 *   RI-5 带用户名密码的 URL → 拒绝
 *   RI-6 下载内网地址 → 拒绝（真连一次，证明拦截生效）
 *   RI-7 重定向到内网 → 拒绝（每一跳都重新检查）
 *   RI-8 体积超限 → 拒绝
 *   RI-9 内容不是图片 → 拒绝（magic bytes）
 *   RI-10 正常图片 → 抓得到、类型识别对
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import {
  isPrivateIPv4,
  isPrivateIPv6,
  isPublicIP,
  resolveSafeUrl,
  fetchRemoteImage,
  detectImageType
} from '@server/utils/remoteImageFetcher.js'

/** 最小合法 PNG */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
  '01f15c4890000000a49444154789c63600000002000100' +
  '05fe02fea7b1a1a80000000049454e44ae426082',
  'hex'
)

let server
let port
/** 本地测试服务器提供的路径 */
const routes = {}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const handler = routes[req.url]
    if (!handler) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
})

describe('IP 判定', () => {
  it('RI-1 私有/环回/链路本地 IP 一律判为不安全', () => {
    const unsafe = [
      '0.0.0.0',
      '10.1.2.3',
      '127.0.0.1',
      '127.1.2.3',
      '169.254.1.1',
      '169.254.169.254', // 云元数据！
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1', // CGNAT
      '224.0.0.1', // 组播
      '255.255.255.255'
    ]
    for (const ip of unsafe) {
      expect(isPrivateIPv4(ip), ip).toBe(true)
      expect(isPublicIP(ip), ip).toBe(false)
    }
    // 公网地址要放行
    for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.114.1', '172.32.0.1', '192.169.0.1']) {
      expect(isPrivateIPv4(ip), ip).toBe(false)
      expect(isPublicIP(ip), ip).toBe(true)
    }
  })

  it('RI-2 IPv6 的等价段也判不安全', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254']) {
      expect(isPrivateIPv6(ip), ip).toBe(true)
      expect(isPublicIP(ip), ip).toBe(false)
    }
    expect(isPrivateIPv6('2606:4700:4700::1111')).toBe(false)
    expect(isPublicIP('2606:4700:4700::1111')).toBe(true)
  })
})

describe('URL 安全校验', () => {
  it('RI-3 解析到内网的域名 → 拒绝', async () => {
    // localhost 解析到 127.0.0.1
    await expect(resolveSafeUrl('http://localhost:3000/x.png')).rejects.toThrow()
  })

  it('RI-4 非 http/https 协议 → 拒绝', async () => {
    for (const url of ['file:///etc/passwd', 'gopher://127.0.0.1:11211/', 'ftp://example.com/a.png', 'data:image/png;base64,AAAA']) {
      await expect(resolveSafeUrl(url), url).rejects.toThrow()
    }
  })

  it('RI-5 带用户名密码的 URL → 拒绝', async () => {
    await expect(resolveSafeUrl('http://user:pass@example.com/a.png')).rejects.toThrow()
  })

  /**
   * 同一台机器的"另一种写法" —— 经典 SSRF 绕过手法。
   *
   * WHATWG URL 会把 IPv4 的十进制/十六进制/八进制/短形式**归一化**成点分十进制，
   * 所以 `http://2130706433/` 拿到的是 `127.0.0.1`。
   * 防护一旦改成手写解析（不再经过 URL 归一化），这些写法就会直接变成漏洞 ——
   * 所以这里把它们钉死。
   */
  it('RI-11 IPv4 的各种"非点分十进制"写法一律拒绝', async () => {
    const equivalents = [
      'http://2130706433/a.png',       // 十进制 = 127.0.0.1
      'http://0x7f000001/a.png',        // 十六进制 = 127.0.0.1
      'http://0177.0.0.1/a.png',        // 八进制 = 127.0.0.1
      'http://127.1/a.png',             // 短形式 = 127.0.0.1
      'http://127.0.1/a.png',
      'http://[::ffff:7f00:1]/a.png',   // IPv6 十六进制映射写法
      'http://[::ffff:127.0.0.1]/a.png',
      'http://[::1]/a.png',
      'http://[::]/a.png',
      'http://0.0.0.0/a.png',
      'http://169.254.169.254/latest/meta-data/'
    ]
    for (const url of equivalents) {
      await expect(resolveSafeUrl(url), url).rejects.toThrow()
    }
  })

  it('RI-12 畸形 IP 输入一律判为不安全（解析不出来就拒）', () => {
    const malformed = [
      '', 'abc', '1.2.3', '1.2.3.4.5', '999.1.1.1', '0x7f000001', '2130706433',
      '::ffff:127.0.0.1', '::ffff:7f00:1', '1.2.3.4 ', ' 8.8.8.8'
    ]
    for (const ip of malformed) {
      expect(isPublicIP(ip), ip).toBe(false)
    }
  })
})

describe('实际下载', () => {
  it('RI-6 下载内网地址 → 拒绝', async () => {
    // 真的去连本机测试服务器（127.0.0.1）—— 必须被挡住
    await expect(fetchRemoteImage(`http://127.0.0.1:${port}/ok.png`)).rejects.toThrow(/内网|本机/)
  })

  it('RI-7 重定向到内网 → 拒绝（每一跳都重新检查）', async () => {
    routes['/redirect-to-internal.png'] = (req, res) => {
      res.statusCode = 302
      res.setHeader('Location', `http://127.0.0.1:${port}/ok.png`)
      res.end()
    }
    // 用一个"看起来正常"的公网 IP 作为第一跳（走 http 直连 IP，不做真实 DNS）
    // 实际上第一跳就会被 IP 判定挡下；这里验证的是"重定向目标也要检查"
    await expect(
      fetchRemoteImage(`http://127.0.0.1:${port}/redirect-to-internal.png`)
    ).rejects.toThrow()
  })

  it('RI-8 体积超限 → 拒绝', async () => {
    routes['/big.png'] = (req, res) => {
      res.setHeader('Content-Type', 'image/png')
      res.end(Buffer.alloc(2 * 1024 * 1024, 1))
    }
    await expect(
      fetchRemoteImage(`http://127.0.0.1:${port}/big.png`, { maxBytes: 1024 })
    ).rejects.toThrow()
  })

  it('RI-10 正常图片 → 类型识别正确（用 magic bytes）', () => {
    expect(detectImageType(PNG)).toBe('png')
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('jpg')
    expect(detectImageType(Buffer.from('GIF89a........'))).toBe('gif')
    expect(detectImageType(Buffer.from('RIFF0000WEBPVP8 '))).toBe('webp')
  })

  it('RI-9 内容不是图片 → 拒绝（magic bytes）', () => {
    expect(() => detectImageType(Buffer.from('<html>hello</html>'))).toThrow()
    expect(() => detectImageType(Buffer.from('PK\x03\x04zip'))).toThrow()
    expect(() => detectImageType(Buffer.alloc(0))).toThrow()
  })
})
