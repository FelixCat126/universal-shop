import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'

/**
 * 支付对账台账（第 51 轮）
 * =========================
 *
 * ## 这张表记什么
 *
 * **"超时未支付、被系统自动清理掉的订单"的完整单据副本。**
 *
 * 背景：客户/合作方扫码付款后如果没点「完成付款」，订单 10 分钟后被超时清扫
 * **物理删除**（订单行没了、库存回补了）。此时钱可能已到商户账上，
 * 但系统里**没有这单** —— 运营事后连"有没有过这单、买了什么"都查不到。
 *
 * 第 47 轮已在清扫时留了一条 `audit_logs` 审计（含单号/金额/时间），
 * 但**不含商品明细、地址、备注、下单人标识** —— 对账时能对金额，对不上货。
 *
 * 本表就是把那份快照补全，并且**可核对、可导出、可销账**。
 *
 * ## 为什么是独立表，而不是往 audit_logs.detail 里塞
 *
 * 1. `audit_logs.detail` 是 `json` 列（**不是 jsonb**），也没有索引 ——
 *    拿它当"待核对队列"查会全表扫
 * 2. 对账状态需要**筛选 + 分页 + 状态流转**，这些是结构化查询，
 *    不是"审计事件的附加信息"
 * 3. 审计是**只读的流水**，对账是**有状态的待办** —— 两者语义不同
 *
 * ## 快照的来源与边界
 *
 * 写入发生在**清扫事务内**（见 `services/orderTimeoutService.js`），
 * 删单之前抓 —— 订单是硬删（未开 paranoid），**事后无处回捞**。
 *
 * 与删单**同事务**是刻意的：对账记录写失败 → 事务回滚 → 订单**不被删**。
 * 这样"快照写不进去"永远不会退化成"单子消失、无处回捞"。
 *
 * ## 状态机
 *
 *   pending        待核对（刚被清扫，等运营去银行/收款码流水里对）
 *   received       确认已收款
 *   not_received   确认未收款（这笔钱没到，单子可以彻底关掉）
 *
 * 核对结论**只记录，不触发任何补偿** —— 不恢复订单、不退款、不动库存。
 * 补偿走线下，运营处理完回来销账。这是刻意的边界：
 * 恢复订单会与"库存已回补"冲突（货可能已卖光 → 超卖），
 * 而退款属于支付链路，不在本轮范围内。
 *
 * ## 扩展性
 *
 * 将来若接入支付网关，webhook 回调可以直接写这张表并把 `reconcile_status`
 * 置为 `received` —— 台账结构天然兼容，不需要改表。
 */
const PaymentReconciliationRecord = sequelize.define(
  'PaymentReconciliationRecord',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    order_type: {
      type: DataTypes.STRING(16),
      allowNull: false,
      comment: '订单类型：retail-零售 / partner-合作方'
    },
    order_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '原订单 id（订单已删除，仅作内部追溯）'
    },
    order_no: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: '原订单号（时间戳+随机生成，不会复用，可唯一定位）'
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      comment: '应收金额（原币）'
    },
    currency_code: {
      type: DataTypes.STRING(8),
      allowNull: true,
      defaultValue: 'THB',
      comment: '币种'
    },
    total_amount_thb: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      comment: '应收金额（泰铢，统一口径）'
    },
    items_snapshot: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: '商品明细快照：[{name, name_th?, quantity, unit_price, line_total}]'
    },
    contact_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '收货人姓名（快照）'
    },
    contact_phone: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: '联系电话（快照）'
    },
    delivery_address: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '送货地址（快照）'
    },
    notes: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '客户下单备注（快照）'
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '下单用户 id（零售单）'
    },
    user_label: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '下单人脱敏标识（手机号后 4 位 / 登录名），便于人工核对'
    },
    partner_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '下单合作方 id'
    },
    order_created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '原订单下单时间'
    },
    swept_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '被超时清扫的时间'
    },
    reconcile_status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      comment: '核对状态：pending-待核对 / received-已收款 / not_received-确认未收款'
    },
    received_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      comment: '核对后填写的实收金额'
    },
    bank_ref: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '收款凭证号 / 银行流水号（核对时填）'
    },
    note: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '核对备注'
    },
    reconciled_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '核对人（管理员 id）'
    },
    reconciled_by_label: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '核对人登录名（冗余，便于审计）'
    },
    reconciled_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '核对时间'
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: '台账记录创建时间'
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: '台账记录更新时间'
    }
  },
  {
    tableName: 'payment_reconciliation_records',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { unique: true, fields: ['order_no'], name: 'idx_reconciliation_order_no' },
      { fields: ['reconcile_status'], name: 'idx_reconciliation_status' },
      { fields: ['swept_at'], name: 'idx_reconciliation_swept_at' },
      { fields: ['order_type'], name: 'idx_reconciliation_order_type' }
    ]
  }
)

/** 合法的核对状态 */
export const RECONCILE_STATUSES = ['pending', 'received', 'not_received']

export default PaymentReconciliationRecord
