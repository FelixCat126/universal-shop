/**
 * 002_order_pricing_snapshot —— 订单加「计价口径快照」两列
 *
 * 背景：计价口径改过之后，历史订单的金额解释不清 ——
 * 老订单的行存原价、总额存折后价，新订单反过来，
 * 光看数据分不出是哪套规则算出来的（生产就有一单因此说不清差 30%）。
 *
 * 加两列让订单自解释：
 *   pricing_version  ：下单时用的计价规则版本
 *   discount_snapshot：本单命中的促销/券/各行折后价（JSONB）
 *
 * 两列都可空：老订单没有快照是正常的（历史事实改不了），
 * 新订单必填 —— 由下单代码写入。
 *
 * 幂等：IF NOT EXISTS，重复执行安全。
 */
export default {
  name: '002_order_pricing_snapshot',
  async up (queryInterface, sequelize) {
    await sequelize.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS pricing_version VARCHAR(32)`
    )
    await sequelize.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_snapshot JSONB`
    )
    console.log('✅ orders 已加 pricing_version / discount_snapshot')
  },
  async down (queryInterface, sequelize) {
    await sequelize.query('ALTER TABLE orders DROP COLUMN IF EXISTS discount_snapshot')
    await sequelize.query('ALTER TABLE orders DROP COLUMN IF EXISTS pricing_version')
  }
}
