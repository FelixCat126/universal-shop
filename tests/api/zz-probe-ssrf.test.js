import { describe, it, expect } from 'vitest'
import { resolveSafeUrl, isPublicIP, isPrivateIPv4 } from '@server/utils/remoteImageFetcher.js'

describe('probe SSRF bypass', () => {
  it('各种 IP 表示法', async () => {
    const urls = [
      'http://127.0.0.1/x.png',
      'http://2130706433/x.png',      // 十进制 = 127.0.0.1
      'http://0x7f000001/x.png',       // 十六进制 = 127.0.0.1
      'http://0177.0.0.1/x.png',       // 八进制 = 127.0.0.1
      'http://127.1/x.png',            // 短形式 = 127.0.0.1
      'http://[::1]/x.png',
      'http://[::ffff:127.0.0.1]/x.png',
      'http://[::ffff:7f00:1]/x.png',
      'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0/x.png',
      'http://[::]/x.png',
      'http://10.0.0.1/x.png',
      'http://172.16.0.1/x.png',
      'http://100.64.0.1/x.png',
      'http://192.168.1.1/x.png',
      'http://198.18.0.1/x.png',
      'http://255.255.255.255/x.png',
      'http://[fe80::1]/x.png',
      'http://[fc00::1]/x.png',
      'file:///etc/passwd',
      'gopher://127.0.0.1:6379/_SET%20k%20v',
      'http://user:pass@127.0.0.1/x.png',
      'http://metadata.google.internal/x.png'
    ]
    for (const u of urls) {
      let verdict
      try {
        const r = await resolveSafeUrl(u)
        verdict = '✅ 放行 → ip=' + r.ip
      } catch (e) {
        verdict = '⛔ 拒绝: ' + e.message
      }
      console.log('  ' + u.padEnd(52) + ' → ' + verdict)
    }
    expect(true).toBe(true)
  })

  it('isPublicIP 对畸形输入', () => {
    for (const ip of ['', 'abc', '1.2.3', '1.2.3.4.5', '999.1.1.1', '0x7f000001', '2130706433', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
      console.log('  ' + JSON.stringify(ip).padEnd(24) + ' isPublicIP=' + isPublicIP(ip))
    }
    expect(true).toBe(true)
  })
})
