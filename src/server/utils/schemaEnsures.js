/**
 * 生产 schema 准备（幂等）
 *
 * 抽离自 app.js 的启动链，供两处共用：
 *   - app.js 启动链：服务起来前准备 schema
 *   - scripts/production-deploy-setup.mjs：部署时在跑 seeder 之前准备 schema
 *
 * 之所以需要独立模块：seeder（DataSeeder.runProductionUpdate）会查询
 * token_version 等新增列，而这些列由本模块创建。若 setup 脚本先于 app.js
 * 执行，列还不存在 → seeder 报 column does not exist → 部署中断且服务停机。
 *
 * 全部操作幂等：列已存在则跳过，不会重复 ALTER，也不会改动既有数据。
 */
import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import SystemConfig from '../models/SystemConfig.js'
import { normalizeExchangeRates } from './exchangeRates.js'
import { ensureProductCategoriesMigrate } from './ensureProductCategoriesMigrate.js'

export async function ensureTokenVersionColumns () {
  const qi = sequelize.getQueryInterface()
  for (const table of ['users', 'administrators', 'partners']) {
    const desc = await qi.describeTable(table).catch(() => null)
    if (!desc || desc.token_version) continue
    await qi.addColumn(table, 'token_version', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    })
    console.log(`✅ 已为 ${table} 添加 token_version 字段（旧 JWT 失效机制）`)
  }
}

export async function ensureUserAvatarUrlColumn () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('users')
  if (!desc.avatar_url) {
    await qi.addColumn('users', 'avatar_url', {
      type: DataTypes.STRING(512),
      allowNull: true
    })
    console.log('✅ 已为 users 表添加 avatar_url 字段')
  }
  if (!desc.must_reset_password) {
    await qi.addColumn('users', 'must_reset_password', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    })
    console.log('✅ 已为 users 表添加 must_reset_password 字段')
  }
}

export async function ensureProductPointsColumn () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('products')
  if (!desc.points) {
    await qi.addColumn('products', 'points', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    })
    console.log('✅ 已为 products 表添加 points 字段')
  }
  if (!desc.name_th) {
    await qi.addColumn('products', 'name_th', {
      type: DataTypes.STRING(200),
      allowNull: true
    })
    console.log('✅ 已为 products 表添加 name_th 字段')
  }
}

export async function ensureOrderBillingColumns () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('orders')
  if (!desc.currency_code) {
    await qi.addColumn('orders', 'currency_code', {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'THB'
    })
    await sequelize.query(`UPDATE orders SET currency_code = 'THB' WHERE currency_code IS NULL OR currency_code = ''`)
    console.log('✅ 已为 orders 表添加 currency_code 字段')
  }
  if (!desc.total_amount_thb) {
    await qi.addColumn('orders', 'total_amount_thb', {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    })
    await sequelize.query(`UPDATE orders SET total_amount_thb = total_amount WHERE total_amount_thb IS NULL`)
    console.log('✅ 已为 orders 表添加 total_amount_thb（并由原 total_amount 回填泰铢）')
  }
}

export async function ensureOrderPointsRedeemedColumn () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('orders')
  if (!desc.points_redeemed) {
    await qi.addColumn('orders', 'points_redeemed', {
      type: DataTypes.INTEGER,
      allowNull: true
    })
    console.log('✅ 已为 orders 表添加 points_redeemed 字段')
  }
}

export async function ensureOrderItemPointsLineCostColumn () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('order_items')
  if (!desc.points_line_cost) {
    await qi.addColumn('order_items', 'points_line_cost', {
      type: DataTypes.INTEGER,
      allowNull: true
    })
    console.log('✅ 已为 order_items 表添加 points_line_cost 字段')
  }
}

/** 订单促销补列：discount_amount（订单级减免合计）/ order_items.discount_allocated（行分摊优惠），IF NOT EXISTS 幂等 */
export async function ensurePromotionColumns () {
  await sequelize.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0')
  await sequelize.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount_allocated DECIMAL(10,2) NOT NULL DEFAULT 0')
}

/** P3 买多赠一补列：order_items.is_gift（赠品行标识），IF NOT EXISTS 幂等 */
export async function ensureOrderItemIsGiftColumn () {
  await sequelize.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS is_gift BOOLEAN NOT NULL DEFAULT false')
}

/**
 * P4 组合包补列与索引（全部幂等）：
 * - carts.bundle_id（组合包行）、carts.product_id 放开 NOT NULL（组合包行 product_id 为 NULL；
 *   DROP NOT NULL 在 PG 下天然幂等，重复执行无副作用）；
 * - order_items.bundle_id（组合包展开组件行的来源标记）；
 * - carts 两个 bundle 部分唯一索引（与模型 indexes 同名，sync 已建则 IF NOT EXISTS 跳过）
 */
export async function ensureBundleColumns () {
  await sequelize.query('ALTER TABLE carts ADD COLUMN IF NOT EXISTS bundle_id INTEGER NULL')
  await sequelize.query('ALTER TABLE carts ALTER COLUMN product_id DROP NOT NULL')
  await sequelize.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS bundle_id INTEGER NULL')
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS unique_user_bundle ON carts (user_id, bundle_id) WHERE bundle_id IS NOT NULL')
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS unique_session_bundle_guest ON carts (session_id, bundle_id) WHERE user_id IS NULL AND bundle_id IS NOT NULL')
}

/**
 * P2 抵扣券补列：order_promotions.user_coupon_id（券快照行）；
 * promotion_id 放开 NOT NULL（券快照行 promotion_id 为 NULL；
 * DROP NOT NULL 在 PG 下天然幂等，重复执行无副作用）
 */
export async function ensureCouponColumns () {
  await sequelize.query('ALTER TABLE order_promotions ADD COLUMN IF NOT EXISTS user_coupon_id INTEGER NULL')
  await sequelize.query('ALTER TABLE order_promotions ALTER COLUMN promotion_id DROP NOT NULL')
}

/**
 * user_coupons.used_by_order_id 索引（与模型 indexes 同名，sync 已建则 IF NOT EXISTS 跳过）：
 * 订单取消/删除/超时清扫时 restoreOrderResources 按 used_by_order_id 条件 UPDATE 释放券，无索引会全表扫
 */
export async function ensureUserCouponUsedByOrderIndex () {
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_user_coupons_used_by_order ON user_coupons (used_by_order_id)')
}

/** 旧库仅执行过 029 时缺列会导致合作方订单查询报错，启动时对齐模型字段 */
export async function ensurePartnerOrderSchemaColumns () {
  const qi = sequelize.getQueryInterface()
  const orderDesc = await qi.describeTable('partner_orders').catch(() => null)
  if (!orderDesc) return

  if (!orderDesc.partner_address_id) {
    await qi.addColumn('partner_orders', 'partner_address_id', {
      type: DataTypes.INTEGER,
      allowNull: true
    })
    console.log('✅ 已为 partner_orders 添加 partner_address_id')
  }

  if (!orderDesc.online_paid_at) {
    await qi.addColumn('partner_orders', 'online_paid_at', {
      type: DataTypes.DATE,
      allowNull: true
    })
    console.log('✅ 已为 partner_orders 添加 online_paid_at（支付幂等）')
  }

  const itemDesc = await qi.describeTable('partner_order_items').catch(() => null)
  if (!itemDesc) return

  if (!itemDesc.product_image_snapshot) {
    await qi.addColumn('partner_order_items', 'product_image_snapshot', {
      type: DataTypes.STRING(512),
      allowNull: true
    })
    console.log('✅ 已为 partner_order_items 添加 product_image_snapshot')
  }
}

/** Order 表补列：online_paid_at（用于支付确认幂等） */
export async function ensureOrderOnlinePaidAtColumn () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('orders').catch(() => null)
  if (!desc) return
  if (!desc.online_paid_at) {
    await qi.addColumn('orders', 'online_paid_at', {
      type: DataTypes.DATE,
      allowNull: true
    })
    console.log('✅ 已为 orders 表添加 online_paid_at（支付幂等）')
  }
}

/**
 * orders / partner_orders 补 client_order_key（客户端幂等键）列与部分唯一索引：
 * - 列可空，仅非 NULL 的行参与唯一约束，历史数据与未带 key 的下单不受影响；
 * - 部分唯一索引兜底并发双击：同用户/同合作方 + 同 key 只允许落一张订单；
 * - partner 侧写入由合作方下单控制器负责，此处只负责两侧 DDL；
 * - CREATE UNIQUE INDEX IF NOT EXISTS 保证重复启动幂等
 */
export async function ensureClientOrderKeyColumns () {
  const qi = sequelize.getQueryInterface()

  const orderDesc = await qi.describeTable('orders').catch(() => null)
  if (orderDesc && !orderDesc.client_order_key) {
    await qi.addColumn('orders', 'client_order_key', {
      type: DataTypes.STRING(64),
      allowNull: true
    })
    console.log('✅ 已为 orders 表添加 client_order_key 字段（客户端幂等键）')
  }

  const partnerOrderDesc = await qi.describeTable('partner_orders').catch(() => null)
  if (partnerOrderDesc && !partnerOrderDesc.client_order_key) {
    await qi.addColumn('partner_orders', 'client_order_key', {
      type: DataTypes.STRING(64),
      allowNull: true
    })
    console.log('✅ 已为 partner_orders 表添加 client_order_key 字段（客户端幂等键）')
  }

  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_user_client_key ON orders (user_id, client_order_key) WHERE client_order_key IS NOT NULL')
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS uniq_partner_orders_partner_client_key ON partner_orders (partner_id, client_order_key) WHERE client_order_key IS NOT NULL')
}

export async function ensurePartnerAddressSchemaColumns () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('partner_addresses').catch(() => null)
  if (!desc) return
  if (!desc.city) {
    await qi.addColumn('partner_addresses', 'city', {
      type: DataTypes.STRING(100),
      allowNull: true
    })
    console.log('✅ 已为 partner_addresses 添加 city')
  }
  if (!desc.postal_code) {
    await qi.addColumn('partner_addresses', 'postal_code', {
      type: DataTypes.STRING(10),
      allowNull: true
    })
    console.log('✅ 已为 partner_addresses 添加 postal_code')
  }
  if (!desc.phone_country_code) {
    await qi.addColumn('partner_addresses', 'phone_country_code', {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: '+66'
    })
    console.log('✅ 已为 partner_addresses 添加 phone_country_code')
  }
}

/** 旧库仅有 exchange_rate：补全 exchange_rates（JSON），不覆盖已有 exchange_rates */
export async function ensureExchangeRatesConfig () {
  const existing = await SystemConfig.findOne({ where: { config_key: 'exchange_rates' } })
  if (existing) return
  const legacy = await SystemConfig.findOne({ where: { config_key: 'exchange_rate' } })
  let usd = 0
  if (legacy?.config_value != null && String(legacy.config_value).trim() !== '') {
    const n = parseFloat(legacy.config_value)
    if (Number.isFinite(n) && n >= 0) usd = Math.round(n * 100) / 100
  }
  const obj = normalizeExchangeRates({ USD: usd.toFixed(2), CNY: '0.00', MYR: '0.00' })
  await SystemConfig.setConfig('exchange_rates', obj, 'json', '多币种汇算（相对泰铢标价：金额×比例）')
  console.log('✅ 已补全 exchange_rates 配置（由旧 exchange_rate 迁移）')
}

/**
 * 按依赖顺序执行全部 schema 准备（幂等）
 * 顺序很重要：先补列 → 再补索引 → 最后补配置
 */
export async function prepareSchema () {
  await ensureTokenVersionColumns()
  await ensureUserAvatarUrlColumn()
  await ensureProductPointsColumn()
  await ensureOrderBillingColumns()
  await ensureOrderPointsRedeemedColumn()
  await ensureOrderItemPointsLineCostColumn()
  await ensurePromotionColumns()
  await ensureCouponColumns()
  await ensureUserCouponUsedByOrderIndex()
  await ensureOrderItemIsGiftColumn()
  await ensureBundleColumns()
  await ensureOrderOnlinePaidAtColumn()
  await ensureClientOrderKeyColumns()
  await ensurePartnerOrderSchemaColumns()
  await ensurePartnerAddressSchemaColumns()
  await ensureExchangeRatesConfig()
  await ensureProductCategoriesMigrate()
}
