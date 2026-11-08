/**
 * 003_order_fulfillment_fields —— 订单补履约字段
 *
 * 运营标记"已发货"之后，之前**无处记录快递单号和发货时间**：
 * 订单只有状态，没有运单信息 —— 客服查不到快递，仓库也没有交接凭据。
 *
 * 新增三列（都可空，老订单不受影响）：
 *   tracking_number  物流单号（前台可见）
 *   shipped_at       发货时间（标记发货时自动写入）
 *   admin_note       运营内部备注（用户不可见）
 *
 * 幂等：IF NOT EXISTS。
 */
export default {
  name: '003_order_fulfillment_fields',
  async up (queryInterface, sequelize) {
    await sequelize.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(64)`
    )
    await sequelize.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP`
    )
    await sequelize.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_note TEXT`
    )
    console.log('✅ orders 已加 tracking_number / shipped_at / admin_note')
  },
  async down (queryInterface, sequelize) {
    await sequelize.query('ALTER TABLE orders DROP COLUMN IF EXISTS admin_note')
    await sequelize.query('ALTER TABLE orders DROP COLUMN IF EXISTS shipped_at')
    await sequelize.query('ALTER TABLE orders DROP COLUMN IF EXISTS tracking_number')
  }
}
