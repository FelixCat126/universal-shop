/**
 * 集中式日志封装：Winston + 按天滚动（生产）+ 控制台（开发/测试）
 * 用法：
 *   import { logger } from '../utils/logger.js'
 *   logger.error('支付确认失败', { orderId, err: err.message })
 *
 * 日志文件位置：logs/{combined,error}-YYYY-MM-DD.log（生产）
 * 注意：旧 console.error/console.log 暂保留以防外部观察工具依赖；
 *       推荐新代码用 logger.* 替代。
 */
import path from 'path'
import fs from 'fs'
import winston from 'winston'

const isTest = process.env.NODE_ENV === 'test'
const isProd = process.env.NODE_ENV === 'production'

const logDir = process.env.LOG_DIR || path.resolve(process.cwd(), 'logs')
if (!isTest) {
  try { fs.mkdirSync(logDir, { recursive: true }) } catch {}
}

const baseFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  isProd ? winston.format.json() : winston.format.simple()
)

const transports = []
if (!isTest) {
  transports.push(new winston.transports.Console({ level: isProd ? 'info' : 'debug' }))
}
if (isProd) {
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 14
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 7
    })
  )
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  format: baseFormat,
  transports,
  silent: isTest && process.env.LOG_VERBOSE !== '1'
})

/** Express 请求审计辅助：仅记录方法/路径/状态/耗时；不打 body 防 PII 泄漏 */
export function requestLogger () {
  return (req, res, next) => {
    const t0 = Date.now()
    res.on('finish', () => {
      const dur = Date.now() - t0
      logger.info('http', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: dur,
        ip: req.ip
      })
    })
    next()
  }
}
