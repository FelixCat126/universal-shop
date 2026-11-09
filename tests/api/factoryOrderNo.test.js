/**
 * 工厂的 order_no 唯一性测试
 *
 * 这个坑真实出现过：测试偶发失败（跑一次过一次、跑一次挂一次），
 * 根因是订单工厂用 `TEST${Date.now()}` 生成单号 —— 同一毫秒内建两单
 * 就会撞 orders_order_no_key 唯一索引。
 *
 *   FN-1 连续创建多个订单 → 单号互不相同
 *   FN-2 单号格式仍然可读（TEST 前缀 + 数字）
 *   FN-3 真的落库：同一批里不会有唯一索引冲突
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'

beforeEach(async () => {
  await TestDatabase.clearAllData()
})

describe('订单工厂的单号唯一性', () => {
  it('FN-1 连续创建多个订单 → 单号互不相同', () => {
    const nos = []
    for (let i = 0; i < 500; i++) {
      nos.push(TestDataFactory.createOrder(1).order_no)
    }
    expect(new Set(nos).size).toBe(nos.length)
  })

  it('FN-2 单号格式仍然可读（TEST 前缀 + 数字）', () => {
    const no = TestDataFactory.createOrder(1).order_no
    expect(no).toMatch(/^TEST\d+$/)
  })

  it('FN-3 真的落库：同一批里不会有唯一索引冲突', async () => {
    const { Order, User } = TestDatabase.getSequelize().models
    const user = await User.create(await TestDataFactory.createUser({
      nickname: '工厂单号测试用户',
      country_code: '+86',
      phone: '13900001234'
    }))

    // 一次建 200 单（同一毫秒内最极端的情况）
    const rows = Array.from({ length: 200 }, () => TestDataFactory.createOrder(user.id))
    await expect(Order.bulkCreate(rows)).resolves.toBeTruthy()
    expect(await Order.count()).toBe(200)
  })
})
