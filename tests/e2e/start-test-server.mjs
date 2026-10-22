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
  stock: 50,
  points: 0,
  status: 'active'
}))

const { startServer } = await import('../../src/server/app.js')
await startServer()
