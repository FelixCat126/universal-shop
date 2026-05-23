/**
 * 统一错误处理中间件
 * 标准化API响应格式，安全地处理各种错误类型
 */

import { ValidationError, UniqueConstraintError, ForeignKeyConstraintError } from 'sequelize'
import { logger } from '../utils/logger.js'

class ApiError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

// 统一错误响应格式
const sendErrorResponse = (res, statusCode, message, code = null, details = null) => {
  const response = {
    success: false,
    message,
    timestamp: new Date().toISOString()
  }

  if (code) {
    response.code = code
  }

  /**
   * 永远不向客户端返回原始 details（含 stack/SQL 等）。
   * 详情只写日志；客户端仅看到稳定 message + code。
   * details 留作日志变量，不进 response。
   */
  void details

  res.status(statusCode).json(response)
}

// 主要错误处理中间件
export const errorHandler = (err, req, res, next) => {
  // 记录错误日志（落盘 + 控制台；生产携带 stack 但不返给前端）
  logger.error('error', {
    name: err.name,
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip
  })

  // 处理不同类型的错误
  if (err instanceof ApiError) {
    // 自定义API错误
    return sendErrorResponse(res, err.statusCode, err.message, err.code)
  }

  if (err instanceof ValidationError) {
    // Sequelize验证错误
    const message = err.errors?.map(e => e.message).join('; ') || '数据验证失败'
    return sendErrorResponse(res, 400, message, 'VALIDATION_ERROR', err.errors)
  }

  if (err instanceof UniqueConstraintError) {
    // 唯一性约束错误
    const field = err.errors?.[0]?.path || '字段'
    return sendErrorResponse(res, 409, `${field}已存在`, 'UNIQUE_CONSTRAINT_ERROR')
  }

  if (err instanceof ForeignKeyConstraintError) {
    // 外键约束错误
    return sendErrorResponse(res, 400, '关联数据不存在', 'FOREIGN_KEY_ERROR')
  }

  // JWT错误
  if (err.name === 'JsonWebTokenError') {
    return sendErrorResponse(res, 401, '无效的认证令牌', 'INVALID_TOKEN')
  }

  if (err.name === 'TokenExpiredError') {
    return sendErrorResponse(res, 401, '认证令牌已过期', 'TOKEN_EXPIRED')
  }

  // Multer文件上传错误
  if (err.code === 'LIMIT_FILE_SIZE') {
    return sendErrorResponse(res, 400, '文件大小超出限制', 'FILE_TOO_LARGE')
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    return sendErrorResponse(res, 400, '文件数量超出限制', 'TOO_MANY_FILES')
  }

  // 语法错误（通常是请求体解析错误）
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return sendErrorResponse(res, 400, '请求数据格式错误', 'INVALID_JSON')
  }

  // 默认服务器错误：客户端永远只看到通用提示
  const message = process.env.NODE_ENV === 'production'
    ? '服务器内部错误'
    : err.message || '未知错误'

  sendErrorResponse(res, 500, message, 'INTERNAL_SERVER_ERROR')
}

// 404错误处理中间件：浏览器跳网站风格 404 页，API/curl 仍返 JSON
export const notFoundHandler = (req, res) => {
  const url = req.originalUrl || ''
  const isApi = url.startsWith('/api/')
  const isAsset = /\.(js|css|png|jpe?g|gif|ico|svg|woff2?|ttf|eot|map|webp|avif)(\?|$)/i.test(url)
  const wantsHtml = !isApi && !isAsset && req.accepts(['html', 'json']) === 'html'

  if (wantsHtml) {
    // 跳 portal SPA 的通配 NotFound 路由（含返回首页按钮、品牌风格）
    return res.redirect(302, '/portal/404')
  }

  sendErrorResponse(res, 404, `路径 ${req.originalUrl} 不存在`, 'NOT_FOUND')
}

// 异步错误包装器
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

// 导出自定义错误类
export { ApiError }
