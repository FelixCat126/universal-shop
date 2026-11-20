/**
 * 头像更新 与 地址类型口径（第 45 轮）
 * ==================================
 *
 * ## 头像（AV）
 *
 * 上传接口返回的是**站内相对路径**（`/uploads/avatars/<file>`），
 * 客户端原样回传给 `PUT /api/users/profile`。
 * 而路由层的 Joi 校验却要求"必须是 http/https 绝对 URI" →
 * **换头像与移除头像每一次都 400**（控制器那层其实接受相对路径，矛盾在校验层）。
 *
 * 修法：校验层不再重复要求绝对 URI（真正的白名单在控制器里：
 * 只允许 `/uploads/avatars/` 前缀 + 纯文件名 + 图片扩展名）。
 *
 * ## 地址类型（AT）
 *
 * 模型注释与管理端展示都用 `office`，**客户端表单提交的是 `company`**：
 *   - update 路径白名单只认 office → **编辑地址必 400**
 *   - create 路径**完全不校验** → `company` 能建进去 → 于是"能建不能改"
 *
 * 修法：统一到规范值 `home/office/other`，`company` 作为别名归一化后落库；
 * create 与 update 用同一套校验。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const models = () => TestDatabase.getSequelize().models

let user
let token

beforeEach(async () => {
  await TestDatabase.clearAllData()
  user = await models().User.create(await TestDataFactory.createUser({
    country_code: '+86', phone: '13900005555'
  }))
  token = TestHelpers.generateToken(user)
})

describe('头像更新（AV）', () => {
  it('AV-1 用站内相对路径更新头像 → 成功（修复前必 400）', async () => {
    const res = await request(app).put('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar_url: '/uploads/avatars/test-avatar.jpg' })
    expect(res.status, `相对路径头像应当被接受：${JSON.stringify(res.body)}`).toBe(200)

    const row = await models().User.findByPk(user.id, { raw: true })
    expect(row.avatar_url).toBe('/uploads/avatars/test-avatar.jpg')
  })

  it('AV-2 移除头像（avatar_url: null）→ 成功（修复前必 400）', async () => {
    await models().User.update({ avatar_url: '/uploads/avatars/old.jpg' }, { where: { id: user.id } })
    const res = await request(app).put('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar_url: null })
    expect(res.status, `移除头像应当成功：${JSON.stringify(res.body)}`).toBe(200)

    const row = await models().User.findByPk(user.id, { raw: true })
    expect(row.avatar_url).toBeNull()
  })

  it('AV-2b 只改头像不应把邮箱清空（部分更新 = 只改给的那一项）', async () => {
    await models().User.update(
      { email: 'keepme@example.com', nickname: '原昵称' },
      { where: { id: user.id } }
    )
    const res = await request(app).put('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar_url: '/uploads/avatars/only-avatar.jpg' })
    expect(res.status).toBe(200)

    const row = await models().User.findByPk(user.id, { raw: true })
    expect(row.avatar_url).toBe('/uploads/avatars/only-avatar.jpg')
    expect(row.email, '没传 email 就不该动邮箱（否则邮箱登录的账号直接登不上）').toBe('keepme@example.com')
    expect(row.nickname, '没传 nickname 就不该动昵称').toBe('原昵称')
  })

  it('AV-3 越权路径仍然被拒（校验没被放松成"什么都能传"）', async () => {
    const res = await request(app).put('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar_url: 'https://evil.example.com/x.jpg' })
    expect(res.status).toBe(400)

    const res2 = await request(app).put('/api/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar_url: '/uploads/avatars/../../etc/passwd' })
    expect(res2.status).toBe(400)
  })
})

describe('地址类型口径（AT）', () => {
  async function createAddress (extra = {}) {
    return request(app).post('/api/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        contact_name: '测试',
        contact_phone: '13800138000',
        detail_address: '某路 1 号',
        ...extra
      })
  }

  it('AT-1 新建地址用历史别名 company → 成功且落库为规范值 office', async () => {
    const res = await createAddress({ address_type: 'company' })
    expect(res.status, `company 应当被接受：${JSON.stringify(res.body)}`).toBe(201)

    const row = await models().Address.findByPk(res.body.data.id, { raw: true })
    expect(row.address_type, '库里只应存规范值').toBe('office')
  })

  it('AT-2 编辑地址用 company → 成功（修复前必 400）', async () => {
    const created = await createAddress({ address_type: 'home' })
    expect(created.status).toBe(201)

    const res = await request(app).put(`/api/addresses/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        contact_name: '测试',
        contact_phone: '13800138000',
        detail_address: '某路 2 号',
        address_type: 'company'
      })
    expect(res.status, `编辑地址用 company 应当成功：${JSON.stringify(res.body)}`).toBe(200)

    const row = await models().Address.findByPk(created.body.data.id, { raw: true })
    expect(row.address_type).toBe('office')
  })

  it('AT-3 非法地址类型仍然被拒（两条路径都拦）', async () => {
    const res = await createAddress({ address_type: 'garbage' })
    expect(res.status).toBe(400)

    const created = await createAddress({ address_type: 'home' })
    const upd = await request(app).put(`/api/addresses/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        contact_name: '测试',
        contact_phone: '13800138000',
        detail_address: '某路 3 号',
        address_type: 'garbage'
      })
    expect(upd.status).toBe(400)
  })

  it('AT-4 不传地址类型时用默认值 home', async () => {
    const res = await createAddress({})
    expect(res.status).toBe(201)
    const row = await models().Address.findByPk(res.body.data.id, { raw: true })
    expect(row.address_type).toBe('home')
  })
})
