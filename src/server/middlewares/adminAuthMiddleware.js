import jwt from 'jsonwebtoken'
import Administrator from '../models/Administrator.js'
import { JWT_SECRET } from '../config/jwtSecret.js'

/**
 * 可选：请求中带合法管理员 Bearer 时设置 req.admin，否则 req.admin 为 null（不返回 401）
 * 用于 /api/products 等同一路由需区分前台与管理后台行为的场景。
 */
export const optionalAuthenticateAdmin = async (req, res, next) => {
  req.admin = null
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]
    if (!token) {
      return next()
    }

    const decoded = jwt.verify(token, JWT_SECRET)
    if (decoded.type !== 'admin') {
      return next()
    }

    const admin = await Administrator.findOne({
      where: {
        id: decoded.adminId,
        is_active: true
      }
    })
    if (!admin) {
      return next()
    }

    req.admin = {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      email: admin.email
    }
  } catch (_) {
    // 无效或过期的 token：按未登录管理员处理
  }
  next()
}

// 验证管理员JWT token
export const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: '访问被拒绝，缺少认证令牌'
      })
    }

    const decoded = jwt.verify(token, JWT_SECRET)
    
    // 验证是否为管理员token
    if (decoded.type !== 'admin') {
      return res.status(401).json({
        success: false,
        message: '无效的管理员令牌'
      })
    }
    
    // 验证管理员是否存在且启用
    const admin = await Administrator.findOne({
      where: {
        id: decoded.adminId,
        is_active: true
      }
    })
    
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: '管理员账户不存在或已被禁用'
      })
    }

    // 将管理员信息附加到请求对象
    req.admin = {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      email: admin.email
    }
    
    next()
  } catch (error) {
    console.error('管理员Token验证失败:', error)
    return res.status(403).json({
      success: false,
      message: '无效的认证令牌'
    })
  }
}

// 验证管理员权限
export const requirePermission = (resource) => {
  return async (req, res, next) => {
    try {
      const admin = await Administrator.findByPk(req.admin.id)
      
      if (!admin || !admin.hasPermission(resource)) {
        return res.status(403).json({
          success: false,
          message: '权限不足'
        })
      }
      
      next()
    } catch (error) {
      console.error('权限验证失败:', error)
      return res.status(500).json({
        success: false,
        message: '权限验证失败'
      })
    }
  }
}

// 验证超级管理员权限
export const requireSuperAdmin = async (req, res, next) => {
  try {
    if (req.admin.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: '需要超级管理员权限'
      })
    }
    
    next()
  } catch (error) {
    console.error('超级管理员权限验证失败:', error)
    return res.status(500).json({
      success: false,
      message: '权限验证失败'
    })
  }
}

// 操作日志中间件
// 同时拦截 res.json 与 res.send：
//   - JSON 响应（CRUD/状态变更）通过 data.success 判断
//   - Buffer 响应（xlsx 等导出）通过 res.statusCode<400 判断
// 用 logged 标志位防止两种路径同时触发（res.json 内部也会调 res.send）
export const logOperation = (action, resource) => {
  return async (req, res, next) => {
    let logged = false

    const writeLog = async (extractedId, newData) => {
      if (logged) return
      logged = true
      try {
        const OperationLog = (await import('../models/OperationLog.js')).default
        const description = `${action}: ${resource}`
        const resourceId = extractedId ?? (req.params?.id ?? null)
        await OperationLog.logOperation({
          adminId: req.admin?.id,
          adminUsername: req.admin?.username,
          action,
          resource,
          resourceId,
          description,
          oldData: null,
          newData,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        })
      } catch (error) {
        console.error('记录操作日志失败:', error)
      }
    }

    const originalJson = res.json
    res.json = function (data) {
      if (data && data.success) {
        const id = data.data?.id ?? null
        setImmediate(() => { writeLog(id, data.data ?? null) })
      }
      return originalJson.call(this, data)
    }

    const originalSend = res.send
    res.send = function (body) {
      // 仅对成功响应记录；对 Buffer/text 也覆盖（如 xlsx 导出）
      // res.json 内部也会调 res.send，由 logged 标志防止重复
      if (!logged && res.statusCode < 400) {
        setImmediate(() => { writeLog(null, null) })
      }
      return originalSend.call(this, body)
    }

    next()
  }
}

// 默认导出主要的认证中间件
export default authenticateAdmin
