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
// worker 轮询间隔调小（第 54 轮）
//
// 原来用默认的 15000ms，而 AE-2 只等 60s 下载 —— 余量只有 4 个轮询周期。
// 全量并发跑时（多个测试文件抢 PG 连接与 CPU）worker 处理更慢，
// 就可能超过 60s → **既有 flake**（与本轮改动无关，第一次全量跑时就出现过）。
//
// 调成 2s 后，任务几秒内就被处理完，用例不再依赖"worker 恰好在第 N 个周期醒"的时序。
process.env.EXPORT_WORKER_INTERVAL_MS = '2000'

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
 * 第二个商品：专供「商品详情页点相关推荐会换内容」这条 E2E 用。
 *
 * 相关推荐是**同分类的其它在售商品** —— 只有一个商品时这个区域是空的，
 * 测不到"点了推荐但页面没换"这个坑（Vue Router 复用组件实例）。
 * 分类与上面那个 E2E 测试商品相同。
 */
await Product.create(TestDataFactory.createProduct({
  name: 'E2E 推荐商品',
  name_th: 'E2E Related Product',
  description: '用于验证商品详情页切换',
  category_id: baseline.categories.food.id,
  price: 200,
  stock: 500,
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

  /**
   * 强制改密的合作方账号（CSV 批量导入 / 管理端重置密码后的状态）。
   *
   * 单独建一个账号，不动 e2e_partner —— 否则会影响到别的合作方 E2E。
   */
  await Partner.create({
    login: 'e2e_partner_temp',
    password: 'E2eTemp#2026',
    display_name: 'E2E 初始密码合作方',
    is_active: true,
    must_reset_password: true
  })

  /**
   * 另一个普通合作方账号：给"自助改密" E2E 用。
   *
   * 改密 E2E 会**真的改掉密码**，所以必须用独立的账号 ——
   * 改 e2e_partner 会让后面的合作方 E2E 全部登不上（它们的密码是固定的）。
   */
  await Partner.create({
    login: 'e2e_partner_pwd',
    password: 'E2ePwd#2026',
    display_name: 'E2E 改密合作方',
    is_active: true
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

/**
 * ���张待发货订单：管理端「改状态 + 填物流单号」的 E2E 用它。
 * 建**两张**（不是一张）：批量改状态至少要能勾选多行才有意义。
 */
{
  const { User, Order, OrderItem } = TestDatabase.getSequelize().models
  const user = await User.create({
    username: 'e2e_fulfill_customer',
    email: 'e2e_fulfill@example.com',
    password: 'E2eCustomer#2026',
    nickname: '履约测试客户',
    country_code: '+66',
    phone: '8090000001',
    is_active: true
  })
  const product = await Product.findOne({ where: { name: 'E2E 测试商品' } })
  for (let i = 1; i <= 2; i++) {
    const order = await Order.create({
      user_id: user.id,
      order_no: 'E2E-FULFILL-' + Date.now() + '-' + i,
      contact_name: '履约测试客户',
      contact_phone: '8090000001',
      delivery_address: 'Bangkok',
      province: 'Bangkok',
      city: 'Bangkok',
      district: 'Pathum Wan',
      status: 'shipping',
      total_amount: product ? Number(product.price) * 2 : 200,
      total_amount_thb: product ? Number(product.price) * 2 : 200,
      currency_code: 'THB',
      payment_method: 'cod'
    })
    if (product) {
      await OrderItem.create({
        order_id: order.id,
        product_id: product.id,
        quantity: 2,
        price: product.price,
        original_price: product.price,
        product_name_zh: product.name
      })
    }
  }
}

/**
 * 管理端辅助重置客户密码的 E2E 用的账号。
 *
 * 故意带 must_reset_password=true（客户忘记密码、运营帮忙重置的场景）。
 */
{
  const { User } = TestDatabase.getSequelize().models
  for (const [i, phone] of [1, '812349998', 2, '812349997'].reduce((a, c, i, arr) => i % 2 ? a : [...a, [arr[i], arr[i+1]]], [])) {
    await User.create({
      username: `e2e_reset_customer_${i}`,
      email: `e2e_reset_${i}@example.com`,
      password: 'E2eReset#2026',
      nickname: `待重置客户${i}`,
      country_code: '+66',
      phone,
      is_active: true,
      must_reset_password: true
    })
  }
}

const { startServer } = await import('../../src/server/app.js')
await startServer()
