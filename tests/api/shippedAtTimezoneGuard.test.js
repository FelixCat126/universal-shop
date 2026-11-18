/**
 * orders.shipped_at 的时区语义护栏
 *
 * ## 背景
 *
 * `orders.shipped_at` 曾是本项目**唯一**一处"生产结构 ≠ 模型定义"的漂移：
 *   生产：timestamp without time zone（naive）
 *   测试：timestamp with time zone（按模型 DataTypes.DATE 建）
 *
 * naive 列在 Node 写入时存的是**本地墙上时间**（实测：写 15:43:25Z → 存 23:43:25，
 * 本机 +08），而 PG 侧 now() 存 UTC —— 同表两种时间来源差 8 小时，
 * 泰国用户看到的后台发货时间会**晚 8 小时**。
 *
 * ## 用例
 *   SA-1 测试库（按模型建）里 shipped_at 必须是 timestamptz
 *   SA-2 迁移 014 必须存在，且把 naive 列转成 timestamptz
 *   SA-3 迁移幂等：已是 timestamptz 时再跑一次，值不能被平移
 *   SA-4 naive → timestamptz 的转换要按 Node 进程本地时区解释历史值
 *   SA-5 全库不允许再有别的 naive 业务列（迁移表自身的除外）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TestDatabase } from '../setup/test-database.js'

const MIGRATION = 'src/server/migrations/014_orders_shipped_at_timestamptz.js'

async function columnType (table, column) {
  const res = await TestDatabase.getSequelize().query(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = :t AND column_name = :c`,
    { replacements: { t: table, c: column } }
  )
  const list = Array.isArray(res?.[0]) ? res[0] : (res || [])
  const first = list[0]
  return (first && typeof first === 'object' && !Array.isArray(first))
    ? (first.data_type ?? first[0])
    : first
}

describe('orders.shipped_at 的时区语义', () => {
  it('SA-1 测试库里 shipped_at 是 timestamptz（与模型一致）', async () => {
    expect(await columnType('orders', 'shipped_at')).toBe('timestamp with time zone')
  })

  it('SA-2 迁移 014 存在，且把 naive 列转成 timestamptz', async () => {
    expect(fs.existsSync(path.resolve(MIGRATION)), '迁移 014 不能被删').toBe(true)
    const text = fs.readFileSync(path.resolve(MIGRATION), 'utf8')
    expect(text, '迁移必须改列类型').toContain('ALTER COLUMN shipped_at TYPE TIMESTAMP WITH TIME ZONE')
    // 必须有幂等守卫：已是 timestamptz 就跳过（重复转换会平移值）
    expect(text, '迁移必须有幂等守卫').toMatch(/timestamp with time zone[\s\S]{0,400}skip|已是 timestamptz/)
  })

  it('SA-3 迁移真的能把 naive 列转成 timestamptz：值按本地时区解释 + 重复执行不漂移', async () => {
    const { default: migration } = await import(path.resolve(MIGRATION))
    const seq = TestDatabase.getSequelize()

    // orders.user_id 是 NOT NULL → 先造一个用户
    const { User } = seq.models
    const u = await User.create({
      username: 'sa_guard_user', nickname: 'SA', country_code: '+86',
      phone: '13900008888', password: 'Abcd1234', is_active: true
    })

    // ① 把测试库的列改回 naive —— 复现生产的结构（否则只会走到"已转换"的跳过分支，
    //    测不到真正的转换逻辑，那种"永远绿"的护栏最危险）
    await seq.query('ALTER TABLE orders ALTER COLUMN shipped_at TYPE TIMESTAMP')
    expect(await columnType('orders', 'shipped_at'), '前置：列应已是 naive').toBe('timestamp without time zone')

    // ② 造一行 naive 值（Node 写 naive 列时存的就是这种"本地墙上时间"）
    await seq.query('DELETE FROM orders WHERE id = -991')
    await seq.query(
      `INSERT INTO orders (id, order_no, user_id, total_amount, total_amount_thb, currency_code,
                           payment_method, status, contact_name, contact_phone,
                           delivery_address, exchange_rate, shipped_at, created_at, updated_at)
       VALUES (-991, 'SA991', :uid, 1, 1, 'THB', 'cod', 'pending', 'SA', '13800138000', 'A', 1,
               '2026-01-02 03:04:05', now(), now())`,
      { replacements: { uid: u.id } }
    )

    // ③ 跑迁移
    await migration.up({}, seq)
    expect(await columnType('orders', 'shipped_at'), '迁移后列类型必须是 timestamptz').toBe('timestamp with time zone')

    // ④ 值必须被解释为**本地时区**的墙上时间：
    //    '2026-01-02 03:04:05'（上海）→ 存回 instants 应等于 JS 按本地时区解析的同一刻
    const after = await seq.query('SELECT shipped_at::text AS t FROM orders WHERE id = -991')
    const a = Array.isArray(after?.[0]) ? after[0][0] : after[0]
    const afterText = (a && typeof a === 'object') ? (a.t ?? a[0]) : a
    const expectedInstant = new Date('2026-01-02T03:04:05')  // 无 Z → 按本地时区解析
    expect(
      new Date(afterText).getTime(),
      '历史值必须按 Node 进程本地时区解释（用错基准会整体偏一个时区偏移）'
    ).toBe(expectedInstant.getTime())

    // ⑤ 再跑一次必须是幂等无操作（重复转换会把值平移一个偏移）
    await migration.up({}, seq)
    const again = await seq.query('SELECT shipped_at::text AS t FROM orders WHERE id = -991')
    const g = Array.isArray(again?.[0]) ? again[0][0] : again[0]
    const againText = (g && typeof g === 'object') ? (g.t ?? g[0]) : g
    expect(againText, '重复执行迁移不能把时间平移').toBe(afterText)

    await seq.query('DELETE FROM orders WHERE id = -991')
  })

  it('SA-4 转换按 Node 进程本地时区解释历史值（不是 PG 会话时区）', async () => {
    const text = fs.readFileSync(path.resolve(MIGRATION), 'utf8')
    // 必须用 Node 本地时区：写入 naive 列时存的就是"本地墙上时间"
    expect(text, '必须用 Node 进程本地时区解释历史值').toContain('resolvedOptions().timeZone')
    expect(text, '转换语句必须用 AT TIME ZONE 显式指定时区').toMatch(/AT TIME ZONE/)
  })

  it('SA-5 全库不允许再有 naive 业务列（迁移表自身的除外）', async () => {
    const res = await TestDatabase.getSequelize().query(
      `SELECT table_name || '.' || column_name AS c
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND data_type = 'timestamp without time zone'
          AND table_name <> 'schema_migrations'`
    )
    const list = Array.isArray(res?.[0]) ? res[0] : (res || [])
    const offenders = list.map(r => (r && typeof r === 'object' && !Array.isArray(r)) ? (r.c ?? r[0]) : r)
    expect(
      offenders,
      '这些列是无时区的裸时间 —— Node 写进去存的是本地墙上时间，与 PG 侧 now() 差一个时区偏移：\n' + offenders.join('\n')
    ).toEqual([])
  })
})
