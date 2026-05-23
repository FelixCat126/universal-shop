/**
 * 业务测试基线 fixtures：
 *   - 默认 SystemConfig（汇率、币种、合作方 MOQ）
 *   - 默认商品分类（食品/饮料）
 *   - 精简行政区（1 省 → 2 区 → 4 子区）
 *
 * 用法：在业务测试 beforeEach 里在 clearAllData() 之后调用
 *   await seedTestBaseline()
 *
 * 不需要全部 baseline 时可调用 seedSystemConfigBaseline / seedCategoriesBaseline 单独使用。
 */

import { TestDatabase } from './test-database.js'

/**
 * 默认 SystemConfig：
 *  - exchange_rates: 多币种汇率（json）
 *  - exchange_rate:  兼容字段，与 USD 同步（text）
 *  - currency_unit:  默认币种 THB（text）
 *  - partner_order_moq_unit:        50（text）
 *  - partner_order_moq_multiplier:  1（text）
 */
export async function seedSystemConfigBaseline (overrides = {}) {
  const sequelize = TestDatabase.getSequelize()
  const { SystemConfig } = sequelize.models

  const rates = {
    USD: '0.03',
    CNY: '0.20',
    MYR: '0.13',
    ...(overrides.exchange_rates || {})
  }

  await SystemConfig.setConfig('exchange_rates', rates, 'json', '多币种汇率')
  await SystemConfig.setConfig('exchange_rate', rates.USD, 'text', '兼容字段')
  await SystemConfig.setConfig(
    'currency_unit',
    overrides.currency_unit || 'THB',
    'text',
    '默认币种'
  )
  await SystemConfig.setConfig(
    'partner_order_moq_unit',
    String(overrides.partner_order_moq_unit ?? 50),
    'text',
    '合作方 MOQ 起订量'
  )
  await SystemConfig.setConfig(
    'partner_order_moq_multiplier',
    String(overrides.partner_order_moq_multiplier ?? 1),
    'text',
    '合作方 MOQ 步进'
  )

  return { rates }
}

/**
 * 默认商品分类：食品(sort=1)、饮料(sort=2)。
 * 返回 { food, drink } 两个 ProductCategory 实例。
 */
export async function seedCategoriesBaseline () {
  const sequelize = TestDatabase.getSequelize()
  const { ProductCategory } = sequelize.models

  const food = await ProductCategory.create({ name: '食品', sort_order: 1 })
  const drink = await ProductCategory.create({ name: '饮料', sort_order: 2 })
  return { food, drink }
}

/**
 * 精简行政区：1 省 (TH-Bangkok) → 2 区 (Pathum Wan, Bang Rak) → 各 2 子区
 * 返回扁平的 region map，便于按 alias 取 id。
 */
export async function seedRegionsBaseline () {
  const sequelize = TestDatabase.getSequelize()
  const { AdministrativeRegion } = sequelize.models

  const province = await AdministrativeRegion.create({
    country_code: 'TH',
    parent_id: null,
    level: 1,
    name_local: 'กรุงเทพมหานคร',
    name_alias: 'Bangkok',
    postal_code: null,
    sort_order: 1,
    is_active: 1
  })

  const districts = []
  for (const [alias, local, sort] of [
    ['Pathum Wan', 'ปทุมวัน', 1],
    ['Bang Rak', 'บางรัก', 2]
  ]) {
    districts.push(
      await AdministrativeRegion.create({
        country_code: 'TH',
        parent_id: province.id,
        level: 2,
        name_local: local,
        name_alias: alias,
        postal_code: null,
        sort_order: sort,
        is_active: 1
      })
    )
  }

  const subDistricts = []
  for (const district of districts) {
    for (let i = 1; i <= 2; i++) {
      subDistricts.push(
        await AdministrativeRegion.create({
          country_code: 'TH',
          parent_id: district.id,
          level: 3,
          name_local: `${district.name_local}-${i}`,
          name_alias: `${district.name_alias}-${i}`,
          postal_code: `1033${i}`,
          sort_order: i,
          is_active: 1
        })
      )
    }
  }

  return {
    province,
    districts,
    subDistricts,
    byAlias: Object.fromEntries(
      [province, ...districts, ...subDistricts].map((r) => [r.name_alias, r])
    )
  }
}

/**
 * 一键播种全部 baseline。
 * 接收 overrides 透传到 seedSystemConfigBaseline。
 */
export async function seedTestBaseline (overrides = {}) {
  const sysOut = await seedSystemConfigBaseline(overrides)
  const cats = await seedCategoriesBaseline()
  const regions = await seedRegionsBaseline()
  return { ...sysOut, categories: cats, regions }
}
