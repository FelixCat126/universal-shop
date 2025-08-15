import { Sequelize } from 'sequelize'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 数据库文件路径
const dbPath = path.join(__dirname, '../../../database/shop.sqlite')

// 创建Sequelize实例
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false, // 在生产环境中可以设置为false
  define: {
    // 全局模型选项
    freezeTableName: true, // 不自动复数化表名
    underscored: true // 使用下划线命名
  }
})

export default sequelize