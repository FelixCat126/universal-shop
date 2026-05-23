import { Sequelize } from 'sequelize'

/**
 * 数据库统一为 PostgreSQL（已彻底移除 SQLite）。
 *
 * 必备环境变量：
 *   DATABASE_URL          完整连接串，例如 postgres://shop:shop@localhost:5432/shop_dev
 *   DATABASE_URL_TEST     测试环境覆盖；NODE_ENV=test 时优先用它
 *
 * 可选调优变量：
 *   PG_POOL_MAX           连接池上限（默认 10；生产建议 20-50 视并发量）
 *   PG_POOL_MIN           连接池下限（默认 0）
 *   PG_POOL_ACQUIRE_MS    取连接超时（默认 30000）
 *   PG_POOL_IDLE_MS       空闲回收（默认 10000）
 *   PG_SSL                'true' 启用 SSL（云数据库一般需要）
 *
 * 本地开发：可执行 `docker compose up -d postgres` 启动随仓库附带的 PG 实例，
 * 见 docker-compose.yml。.env.example 已附默认连接串。
 */

const DEFAULT_LOCAL_URL = 'postgres://shop:shop@127.0.0.1:5432/shop_dev'
const DEFAULT_LOCAL_TEST_URL = 'postgres://shop:shop@127.0.0.1:5432/shop_test'

const isTest = process.env.NODE_ENV === 'test'

const url =
  (isTest ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL) ||
  process.env.DATABASE_URL ||
  (isTest ? DEFAULT_LOCAL_TEST_URL : DEFAULT_LOCAL_URL)

if (!url) {
  throw new Error('DATABASE_URL 未设置；请在 .env 中填入 PostgreSQL 连接串')
}

const useSsl = String(process.env.PG_SSL || '').toLowerCase() === 'true'

const sequelize = new Sequelize(url, {
  dialect: 'postgres',
  logging: false,
  pool: {
    max: parseInt(process.env.PG_POOL_MAX || '10', 10),
    min: parseInt(process.env.PG_POOL_MIN || '0', 10),
    acquire: parseInt(process.env.PG_POOL_ACQUIRE_MS || '30000', 10),
    idle: parseInt(process.env.PG_POOL_IDLE_MS || '10000', 10)
  },
  define: {
    freezeTableName: true,
    underscored: true
  },
  dialectOptions: useSsl
    ? { ssl: { require: true, rejectUnauthorized: false } }
    : {}
})

export default sequelize
