import { TestDatabase } from '../setup/test-database.js'
import { seedTestBaseline } from '../setup/test-baseline.js'
import { TestDataFactory } from '../factories/index.js'

process.env.NODE_ENV = 'test'
process.env.PORT = process.env.PORT || '3000'
process.env.DATABASE_URL_TEST = process.env.DATABASE_URL_TEST || 'postgres://shop:shop@127.0.0.1:5432/shop_test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-jwt-secret-key-for-testing-only-32-chars'
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET || 'e2e-admin-secret-key-for-testing-only'
process.env.JWT_PARTNER_SECRET = process.env.JWT_PARTNER_SECRET || 'e2e-partner-secret-key-for-testing-only'
process.env.CAPTCHA_SECRET = process.env.CAPTCHA_SECRET || 'e2e-captcha-secret-key-for-testing-only'
process.env.RATE_LIMIT_DISABLED = '1'
// E2E 要验真实链路：导出任务必须由后台 worker 真的跑起来
// （单元测试里默认关闭，worker 会和用例抢任务）
process.env.EXPORT_WORKER_ENABLED = '1'

await TestDatabase.initialize()
await TestDatabase.syncModels()
await TestDatabase.clearAllData()
const baseline = await seedTestBaseline({ points_earn_rate: '0.01' })

const { Product } = TestDatabase.getSequelize().models
await Product.create(TestDataFactory.createProduct({
  name: 'E2E 测试商品',
  name_th: 'E2E Test Product',
  description: '真实浏览器端到端测试商品',
  category_id: baseline.categories.food.id,
  price: 100,
  // 库存给足：多个 E2E spec 共用这一个商品（合作方 MOQ 一次就要 50 件），
  // 库存不够时后跑的 spec 会因"库存不足"失败 —— 那是测试之间互相干扰，不是被测逻辑
  stock: 5000,
  points: 0,
  status: 'active'
}))

/**
 * 管理端 / 合作方的登录账号（仅测试库，与生产无关）。
 *
 * 管理端：验证「登录 → 提交导出任务 → 轮询 → 下载」这条链路。
 * 合作方：验证「登录 → 选品 → 下单」这条链路。
 */
{
  const { Administrator, Partner, PartnerAddress } = TestDatabase.getSequelize().models
  await Administrator.create({
    username: 'e2e_admin',
    password: 'E2eAdmin#2026',
    role: 'super_admin',
    is_active: true
  })
  const partner = await Partner.create({
    login: 'e2e_partner',
    password: 'E2ePartner#2026',
    display_name: 'E2E 合作方',
    is_active: true
  })
  // 合作方下单必须选收货地址，这里直接备好一个默认地址
  await PartnerAddress.create({
    partner_id: partner.id,
    recipient_name: 'E2E 收货人',
    phone: '0900000000',
    phone_country_code: '+66',
    detail: 'E2E Test Road 123, Bangkok',
    is_default: true
  })
}

/**
 * Portal 端的登录用户（供「登录用户下单」E2E 用）。
 */
{
  const { User, Address } = TestDatabase.getSequelize().models
  const user = await User.create({
    username: 'e2e_user',
    email: 'e2e_user@example.com',
    password: 'Portal#2026',
    nickname: 'E2E 用户',
    country_code: '+66',
    phone: '812345678',
    is_active: true
  })
  // 登录用户结算走的是「地址簿」（不是游客的内联表单），
  // 没选地址时「提交订单」是禁用的 —— 这里预置一个默认地址
  await Address.create({
    user_id: user.id,
    province: 'Bangkok',
    city: 'Bangkok',
    district: 'Pathum Wan',
    detail_address: 'E2E Test Road 456',
    postal_code: '10400',
    full_address: 'Bangkok Bangkok Pathum Wan E2E Test Road 456',
    contact_name: 'E2E 登录用户',
    contact_phone: '812345678',
    is_default: true
  })
}

const { startServer } = await import('../../src/server/app.js')
await startServer()
