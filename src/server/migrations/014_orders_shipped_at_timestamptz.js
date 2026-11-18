/**
 * 014_orders_shipped_at_timestamptz —— orders.shipped_at 改成带时区
 *
 * ## 背景：这是本项目**唯一**一处"生产结构 ≠ 模型定义"的漂移
 *
 * 全库列类型对比（生产库 vs 测试库）：
 *   生产 311 列 / 测试库 310 列，差异只有 3 处：
 *     - orders.shipped_at：生产 `timestamp without time zone`，测试库 `with time zone` ← 本迁移要修的
 *     - schema_migrations.*：生产有迁移表，测试基建不建 → 正常
 *     - HookProbes.*：测试基建的探针表 → 正常
 *
 * 根因：迁移 003 用手工 DDL 加的列是 `TIMESTAMP`（无时区），
 * 而模型里 `shipped_at: DataTypes.DATE` 在 PG 里映射成 `timestamptz`。
 * 测试基建用 `sequelize.sync()` 按**模型**建表 → 测试库是正确的 timestamptz，
 * 生产库是 naive → **两边行为不同，测试永远测不出生产的问题**。
 *
 * ## 为什么这是真问题（实测，不是推断）
 *
 * naive 列在两种写入方式下语义完全不同（本地实测）：
 *   1) Node 写（模型 `new Date()` → node-postgres 序列化成带时区的 ISO）：
 *      写入 2026-11-18T15:43:25Z → 库里存 **2026-11-18 23:43:25**
 *      （PG 插入 naive 列时丢掉时区标记，存的是**本地墙上时间**，本机 +08）
 *   2) PG 侧 `now()`：存 **UTC**（会话时区是 +00）
 *
 *   同一张表里两种时间来源差 8 小时。
 *
 * 后果：泰国用户（UTC+7）看到的后台"发货时间"会比真实时间**晚 8 小时**。
 * 站点面向泰国（货币 THB、业务时区 Asia/Bangkok），这是**用户可见的错误**。
 *
 * ## 转换基准为什么用 Node 进程本地时区
 *
 * 历史值是 Node 写进去的"本地墙上时间"（见上面第 1 条），
 * 所以要按**当时 Node 进程的本地时区**解释，才还原成同一个瞬间。
 * 迁移本身就跑在 Node 里 → `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * 拿到的正是那个时区（生产服务器是 Asia/Shanghai）。
 *
 * 注意：**不是** PG 会话的 TimeZone（生产是 UTC）—— 用错基准会再偏 8 小时。
 *
 * ## 幂等
 *
 * 列已是 timestamptz 就直接跳过；迁移被执行多次也不会重复转换
 * （重复转换会把值平移一个时区偏移 —— 那是最糟的一种"重复执行"）。
 */
export default {
  name: '014_orders_shipped_at_timestamptz',
  async up (queryInterface, sequelize) {
    // 1) 列不存在 → 不用管（迁移 003 没跑过的环境）
    const rows = await sequelize.query(
      `SELECT data_type
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'orders'
          AND column_name = 'shipped_at'`
    )
    const list = Array.isArray(rows?.[0]) ? rows[0] : (rows || [])
    const first = list[0]
    const dataType = (first && typeof first === 'object' && !Array.isArray(first))
      ? (first.data_type ?? first[0])
      : first

    if (!dataType) {
      console.log('ℹ️  orders.shipped_at 不存在，跳过')
      return
    }
    if (dataType === 'timestamp with time zone') {
      console.log('ℹ️  orders.shipped_at 已是 timestamptz，跳过')
      return
    }

    // 2) naive → timestamptz；历史值按 Node 进程本地时区解释
    const nodeTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
    await sequelize.query(
      `ALTER TABLE orders
         ALTER COLUMN shipped_at TYPE TIMESTAMP WITH TIME ZONE
         USING shipped_at AT TIME ZONE ${quoteLiteral(nodeTz)}`
    )
    console.log(`✅ orders.shipped_at 已改为 timestamptz（历史值按 ${nodeTz} 解释）`)
  },
  async down (queryInterface, sequelize) {
    // 回退方向不做类型还原：naive 是"错"的语义，回退等于把 bug 装回去。
    console.log('ℹ️  不回退 shipped_at 的类型（naive 语义本身就是缺陷）')
  }
}

/** SQL 字符串字面量转义（时区名来自 Intl，安全但仍转义一次） */
function quoteLiteral (value) {
  return "'" + String(value).replace(/'/g, "''") + "'"
}
