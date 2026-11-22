/**
 * 合作方商品页「默认分类」护栏（第 50 轮）
 * ======================================
 *
 * ## 这个 bug 是怎么被发现的
 *
 * 第 50 轮写「后台业务流」E2E（AJ-2 货物管理）时建了一个新分类和一个新商品，
 * 随后发现**合作方端（/partner/shop）的商品列表空了** ——
 * 页面上只有一句「暂无商品，请换个关键词试试」，而接口明明返回了 3 个商品。
 *
 * 根因：合作方商品页在 `loadCategories()` 里**自动选中第一个分类**并按它筛选：
 *
 * ```js
 * selectedCategoryId.value = ids[0]     // ← 自动锁定第一个分类
 * ```
 *
 * 分类列表是按 id / sort_order 排的，**新建的分类排在最前** →
 * 合作方一进商品页就被锁死在那个新分类上 →
 * 那个分类下**一个商品都没有**（运营还没挂商品）→ **列表全空**。
 *
 * 后果：**运营建了个新分类、还没来得及挂商品，合作方就"看不到任何货"了** ——
 * 而他连"换一下分类"都未必想得到（第一个 tab 就是那个空分类）。
 *
 * 这跟零售门户首页是同一类问题（门户在第 43 轮修过：默认选中「全部」），
 * **合作方端漏了同一处**。
 *
 * ## 护栏
 *
 *   PG-1 前端**不得自动选中**第一个分类（默认必须是「全部」= 不筛选）
 *   PG-2 分类 tab 的第一个是「全部」
 *   PG-3 接口：不带 category_id 时返回**全部**在售商品
 *   PG-4 接口：带 category_id 时按该分类过滤
 */
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const models = () => TestDatabase.getSequelize().models

describe('合作方商品页「默认分类」护栏', () => {
  let partnerToken

  beforeEach(async () => {
    await TestDatabase.clearAllData()
    const { token } = await TestHelpers.createPartnerWithAddress()
    partnerToken = token
  })

  it('PG-1 前端不得自动选中第一个分类', () => {
    const src = read('src/partner/views/Shop.vue')
    /**
     * ⚠️ 只看**代码行**（去掉注释）——
     * 修复说明的注释里就写着 `selectedCategoryId.value = ids[0]`（解释为什么改掉），
     * 直接搜全文会**匹配到注释** → 护栏永远红 ✗
     */
    const codeOnly = src
      .split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
      .join('\n')
    // 自动选中的写法：selectedCategoryId.value = ids[0]
    expect(
      /selectedCategoryId\.value\s*=\s*ids\[0\]/.test(codeOnly),
      '合作方商品页又在自动选中第一个分类了 —— 那个分类下没商品时列表会是空的'
    ).toBe(false)
    // 默认值必须是 null（= 不筛选）
    expect(
      /const selectedCategoryId = ref\(null\)/.test(src),
      'selectedCategoryId 的默认值必须是 null（表示「全部」）'
    ).toBe(true)
  })

  it('PG-2 分类 tab 的第一个是「全部」', () => {
    const src = read('src/partner/views/Shop.vue')
    expect(src, '合作方商品页没有「全部」分类 tab').toContain('allCategories')
    expect(
      /categoryTabs[\s\S]{0,200}id:\s*null/.test(src),
      'categoryTabs 的第一个必须是 id=null 的「全部」'
    ).toBe(true)
    // 模板要用 categoryTabs（而不是 categories）
    expect(src, '分类 tab 仍然直接渲染 categories（没有「全部」）').toContain('v-for="c in categoryTabs"')
  })

  it('PG-3 不带 category_id 时返回全部在售商品', async () => {
    const { Product } = models()
    await Product.create(TestDataFactory.createProduct({ name: '护栏商品A', price: 50, stock: 100, status: 'active' }))
    await Product.create(TestDataFactory.createProduct({ name: '护栏商品B', price: 60, stock: 100, status: 'active' }))

    const res = await request(app)
      .get('/api/partner/products?page=1&pageSize=50')
      .set('Authorization', `Bearer ${partnerToken}`)

    expect(res.status).toBe(200)
    const names = (res.body.data.products || []).map(p => p.name)
    expect(names.length, '不指定分类时应该返回全部在售商品').toBeGreaterThanOrEqual(2)
  })

  it('PG-4 带 category_id 时按该分类过滤', async () => {
    const { Product, ProductCategory } = models()
    const catA = await ProductCategory.create({ name: '护栏分类A', sort_order: 1 })
    const catB = await ProductCategory.create({ name: '护栏分类B', sort_order: 2 })
    expect(catA.id).toBeTruthy()
    await Product.create(TestDataFactory.createProduct({ name: 'A类商品', price: 50, stock: 100, status: 'active', category_id: catA.id }))
    await Product.create(TestDataFactory.createProduct({ name: 'B类商品', price: 60, stock: 100, status: 'active', category_id: catB.id }))

    const res = await request(app)
      .get(`/api/partner/products?page=1&pageSize=50&category_id=${catA.id}`)
      .set('Authorization', `Bearer ${partnerToken}`)

    expect(res.status).toBe(200)
    const names = (res.body.data.products || []).map(p => p.name)
    expect(names).toContain('A类商品')
    expect(names, '不该返回别的分类的商品').not.toContain('B类商品')
  })
})
