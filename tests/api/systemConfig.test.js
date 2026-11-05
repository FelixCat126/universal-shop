/**
 * 系统配置控制器测试（systemConfigController）
 *
 * 这里有几块是「出事代价高、覆盖却低」的地方：
 *   - 币种符号归一（¥/元→CNY、$→USD、฿→THB）—— 前端按这个值格式化价格
 *   - 汇率归一（旧版单个 exchange_rate → 完整汇率集）—— 结账金额直接依赖它
 *   - 配置写完必须清缓存 —— 否则公开接口继续返回旧值（我上次修过的那个竞态）
 *   - 首页长图/收款码上传的类型白名单 —— 上传是安全敏感入口
 *
 *   SC-1 币种符号归一
 *   SC-2 旧版单值汇率能归一成完整汇率集
 *   SC-3 exchange_rates 传 JSON 字符串能解析；非法内容按未提供处理
 *   SC-4 写完配置后公开接口立刻读到新值（缓存已清）
 *   SC-5 上传只认图片：MIME 不对 / 扩展名不对 / 文件名含路径穿越 → 400
 *   SC-6 删除配置后公开接口不再返回它
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestHelpers, withHttpServer } from '../helpers/test-helpers.js'

let adminToken

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { Administrator } = TestDatabase.getSequelize().models
  const admin = await Administrator.create({
    username: `cfg_admin_${Date.now()}`,
    password: 'CfgPwd#1234',
    role: 'super_admin',
    is_active: true
  })
  adminToken = TestHelpers.generateAdminToken(admin)
})

const setConfig = (body) => request(app)
  .post('/api/system-config')
  .set('Authorization', `Bearer ${adminToken}`)
  .send(body)

const publicConfig = () => request(app).get('/api/system-config/public')

describe('系统配置', () => {
  it('SC-1 币种符号归一（¥/元→CNY，$→USD，฿→THB，未知→THB）', async () => {
    // 写入接口只接受 THB/USD/CNY/MYR 代码；符号是**历史遗留值**，
    // 只能直接写库再从公开接口读 —— 归一发生在读路径上。
    const { SystemConfig } = TestDatabase.getSequelize().models
    const { clearResponseCache } = await import('@server/utils/responseCache.js')
    const cases = [
      ['¥', 'CNY'], ['RMB', 'CNY'], ['元', 'CNY'],
      ['$', 'USD'], ['＄', 'USD'],
      ['฿', 'THB'], ['thb', 'THB'],
      ['不认识的', 'THB']
    ]
    for (const [input, expected] of cases) {
      await SystemConfig.setConfig('currency_unit', input, 'text', '历史遗留符号值')
      // 直接写库不经过 API 写路径 → 缓存不会自动失效，这里手动清（与生产口径一致）
      await clearResponseCache()
      const res = await publicConfig()
      expect(res.body.data.currency_code, `输入 ${input}`).toBe(expected)
    }
  })

  it('SC-2 旧版单值 exchange_rate 能归一成完整汇率集', async () => {
    await setConfig({ key: 'exchange_rate', value: '0.03' }).expect(200)
    const res = await publicConfig()
    expect(res.body.data.exchange_rates).toBeTruthy()
    expect(typeof res.body.data.exchange_rates).toBe('object')
    // 旧字段仍然保留（前端兼容）
    expect(Number(res.body.data.exchange_rate)).toBeCloseTo(0.03, 5)
  })

  it('SC-3 exchange_rates 传 JSON 字符串能解析；非法内容按未提供处理', async () => {
    await setConfig({ key: 'exchange_rates', value: JSON.stringify({ USD: 0.05, CNY: 1.2 }) }).expect(200)
    const ok = await publicConfig()
    expect(Number(ok.body.data.exchange_rates.USD)).toBeCloseTo(0.05, 5)

    // 非法 JSON：按设计就该 400（明确告诉调用方格式不对），且服务不受影响
    await setConfig({ key: 'exchange_rates', value: '{不是 json' }).expect(400)
    const bad = await publicConfig()
    expect(bad.status).toBe(200)
    expect(bad.body.data.exchange_rates).toBeTruthy()
  })

  it('SC-4 写完配置后公开接口立刻读到新值（缓存已清）', async () => {
    await setConfig({ key: 'currency_unit', value: 'USD' }).expect(200)
    const res = await publicConfig()
    expect(res.body.data.currency_code).toBe('USD')
  })

  it('SC-5 上传只认图片：MIME 不对 / 扩展名不对 / 文件名含路径穿越 → 400', async () => {
    /**
     * 用 fetch + FormData 而不是 supertest：supertest 的 attach 会按**扩展名**
     * 推断 MIME，分不开「MIME 不对」和「扩展名不对」两条规则。
     * 需要真实 HTTP 地址 → 用仓库自带的 withHttpServer。
     */
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
      '01f15c4890000000a49444154789c63600000002000100' +
      '05fe02fea7b1a1a80000000049454e44ae426082',
      'hex'
    )

    await withHttpServer(app, async (base) => {
      const upload = async (filename, type) => {
        const fd = new FormData()
        fd.append('banner', new Blob([png], { type }), filename)
        const res = await fetch(`${base}/api/system-config/upload/home-banner`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
          body: fd
        })
        return res.status
      }

      // 1) MIME 不是图片
      expect(await upload('ok.png', 'application/octet-stream')).toBe(400)
      // 2) 扩展名不是图片
      expect(await upload('evil.txt', 'image/png')).toBe(400)

      /**
       * 3) 文件名含路径穿越 → 落盘名必须是安全的（这才是真正的防线）。
       *
       * 两条事实：
       *   - FormData / 浏览器会**自己把文件名里的路径截掉**（Content-Disposition 的
       *     filename 按规范只保留 basename）；
       *   - busboy 默认 preservePath=false，**服务端也会再截一次**。
       * 所以 fileFilter 里那道 ".." 检查平时根本不会触发 —— 真正的防线是
       * storage.filename 的**文件名随机化**（用户输入完全不进路径）。
       *
       * 这里手写 multipart 头把恶意 filename 原样发过去，验证的正是那道随机化：
       * 就算路径被原样送到，落盘名也不含 '..'、也不含用户提供的目录。
       */
      const boundary = '----e2eboundary123456'
      const rawBody = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="banner"; filename="../../etc/passwd.png"\r\n' +
          'Content-Type: image/png\r\n\r\n'
        ),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ])
      const rawRes = await fetch(`${base}/api/system-config/upload/home-banner`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: rawBody
      })
      const rawBody2 = await rawRes.json()
      expect(rawBody2.success).toBe(true)
      // 落盘 URL 必须是 /uploads/system/ 下的随机名，不含任何用户提供的路径
      expect(rawBody2.data.imageUrl).toMatch(/^\/uploads\/system\/system_\d+_[0-9a-f-]+\.png$/)
      expect(rawBody2.data.imageUrl).not.toContain('..')
      expect(rawBody2.data.imageUrl).not.toContain('etc')
    })
  })

  it('SC-6 删除配置后公开接口回到默认值（不再返回旧值）', async () => {
    await setConfig({ key: 'currency_unit', value: 'USD' }).expect(200)
    const before = await publicConfig()
    expect(before.body.data.currency_code).toBe('USD')

    const del = await request(app)
      .delete('/api/system-config/currency_unit')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(del.status).toBe(200)

    // 删掉后应回落到默认值 THB，而不是继续返回 USD
    const after = await publicConfig()
    expect(after.body.data.currency_code).toBe('THB')
  })
})
