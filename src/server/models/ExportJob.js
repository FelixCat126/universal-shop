import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'

/**
 * 导出任务（异步导出）
 *
 * 为什么需要：同步导出在请求线程里完成全部查询 + Excel 生成 + 文件传输，
 * 大数据量时会长时间占用连接与内存（实测 5 万行峰值堆 400MB+），
 * 并且受 HTTP 超时与反向代理限制。异步导出把重活挪到后台：
 *   1. 前端提交导出请求 → 立即拿到 jobId
 *   2. 后台 worker 扫描 pending 任务 → 分批流式写入文件
 *   3. 管理员在列表里看到进度，完成后点下载
 *
 * 任务表本身也会增长，由 retentionService 定期清理已完成的老任务。
 */
const ExportJob = sequelize.define('ExportJob', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  admin_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '发起导出的管理员 ID'
  },
  admin_username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '发起导出的管理员用户名（冗余存储，防止删号后丢失记录）'
  },
  type: {
    type: DataTypes.STRING(32),
    allowNull: false,
    comment: "导出类型：'users' | 'orders' | 'partner_orders'",
  },
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'pending',
    comment: 'pending | running | done | failed'
  },
  params: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '导出筛选参数（JSON）'
  },
  row_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '实际导出行数'
  },
  file_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '生成的文件名'
  },
  file_path: {
    type: DataTypes.STRING(512),
    allowNull: true,
    comment: '生成文件在磁盘上的绝对路径'
  },
  file_size: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '文件字节数'
  },
  error_message: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '失败原因'
  },
  started_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '开始执行时间'
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '完成时间'
  }
}, {
  tableName: 'export_jobs',
  underscored: true,
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['admin_id', 'status'], name: 'idx_export_job_admin_status' },
    { fields: ['created_at'], name: 'idx_export_job_created_at' }
  ]
})

export default ExportJob
