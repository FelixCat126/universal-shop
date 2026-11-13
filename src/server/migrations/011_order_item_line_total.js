/**
 * 011_order_item_line_total —— 订单明细行补上权威行小计
 *
 * 问题：组合包（bundle）订单的明细行是"按权重把组合价分摊到组件行"的，
 * 行权威金额是 `line_total`（分摊结果），但 order_items 表**只有 price（单价）**，
 * 落库时写的是 `round2(line_total / 行数量)` —— 除不尽的尾差就丢了。
 *
 * 实测：组合价 199.00（A 配比 3、B 配比 1），买 1000 套
 *   → A 行记 134190、B 行记 64800，明细合计 198990
 *   → 而订单实收 total_amount_thb = 199000，**差 10 THB**
 *
 * 后果：
 *   1. 订单详情逐行"单价 × 数量"合计与实收对不上（用户看得见）
 *   2. 自家不变量 `recent_order_total_matches_items`（容差 0.01）必然报红
 *
 * 修法：加一列 `line_total` 存权威行小计；老数据用 `price * quantity` 回填
 * （对普通单品行两者相等，对组合包行只能填近似值 —— 历史订单本就没有权威值）。
 *
 * 幂等：IF NOT EXISTS + 回填带 WHERE 条件（只回填还没填的）。
 */
export default {
  name: '011_order_item_line_total',
  async up (queryInterface, sequelize) {
    await sequelize.query(
      `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS line_total DECIMAL(16,2)`
    )

    // 回填：普通单品行 price × quantity 就是权威值；
    // 组合包行（line_total 为 NULL）留空 —— 那几行本来就没有权威值，
    // 硬填 price × quantity 反而会把误差固化下来。
    await sequelize.query(
      `UPDATE order_items
          SET line_total = ROUND(price * quantity, 2)
        WHERE line_total IS NULL`
    )

    console.log('✅ order_items 已加 line_total（权威行小计）')
  },
  async down (queryInterface, sequelize) {
    await sequelize.query('ALTER TABLE order_items DROP COLUMN IF EXISTS line_total')
  }
}
