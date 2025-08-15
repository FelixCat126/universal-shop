import jwt from 'jsonwebtoken'
import Administrator from '../models/Administrator.js'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here'

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
export const logOperation = (action, resource) => {
  return async (req, res, next) => {
    // 保存原始的 res.json 方法
    const originalJson = res.json

    // 重写 res.json 方法来拦截响应
    res.json = function(data) {
      // 如果操作成功，记录日志
      if (data.success) {
        // 异步记录日志，不阻塞响应
        setImmediate(async () => {
          try {
            const OperationLog = (await import('../models/OperationLog.js')).default
            
            let description = `${action}: ${resource}`
            let resourceId = null
            let newData = null
            let oldData = null
            
            // 尝试从响应数据中提取信息
            if (data.data) {
              if (data.data.id) {
                resourceId = data.data.id
              }
              newData = data.data
            }
            
            // 尝试从请求参数中提取资源ID
            if (!resourceId && req.params.id) {
              resourceId = req.params.id
            }
            
            await OperationLog.logOperation({
              adminId: req.admin.id,
              adminUsername: req.admin.username,
              action,
              resource,
              resourceId,
              description,
              oldData,
              newData,
              ipAddress: req.ip,
              userAgent: req.get('User-Agent')
            })
          } catch (error) {
            console.error('记录操作日志失败:', error)
          }
        })
      }
      
      // 调用原始的 res.json 方法
      return originalJson.call(this, data)
    }
    
    next()
  }
}

// 默认导出主要的认证中间件
export default authenticateAdmin
