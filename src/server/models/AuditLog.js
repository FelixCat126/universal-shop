import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import { logger } from '../utils/logger.js'

/**
 * 审计日志：用于记录"普通用户 / 合作方 / 系统/匿名"产生的关键业务事件。
 * 与 OperationLog（管理员后台操作）分离，避免列形状冲突，便于按主体过滤。
 *
 * actor_type 取值：
 *   - 'user'      普通用户
 *   - 'partner'   合作方
 *   - 'system'    系统自动行为（如游客自动注册）
 *   - 'anonymous' 未登录请求
 */
const AuditLog = sequelize.define(
  'AuditLog',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    actor_type: {
      type: DataTypes.STRING(16),
      allowNull: false,
      comment: '事件主体类型：user/partner/system/anonymous'
    },
    actor_id: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: '事件主体 ID（用户/合作方主键），匿名/系统可空'
    },
    actor_label: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '冗余存储用户名/手机号脱敏，便于日志检索'
    },
    event: {
      type: DataTypes.STRING(80),
      allowNull: false,
      comment: '事件名，如 user.login.success, order.create, partner.payment.confirm'
    },
    resource: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: '关联资源类型，如 order, address, partner_order'
    },
    resource_id: {
      type: DataTypes.STRING(80),
      allowNull: true,
      comment: '关联资源 ID'
    },
    success: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: '事件是否成功'
    },
    detail: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '附加上下文（少量字段，避免存敏感数据）'
    },
    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    user_agent: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: 'audit_logs',
    timestamps: false,
    indexes: [
      { fields: ['actor_type', 'actor_id'] },
      { fields: ['event'] },
      { fields: ['resource', 'resource_id'] },
      { fields: ['created_at'] }
    ]
  }
)

const sanitizeIp = (req) => {
  if (!req) return null
  return req.ip || req.connection?.remoteAddress || null
}

const sanitizeUserAgent = (req) => {
  if (!req) return null
  const ua = req.get?.('user-agent') || req.headers?.['user-agent'] || null
  if (!ua) return null
  return ua.length > 500 ? ua.slice(0, 500) : ua
}

const phoneMask = (phone) => {
  if (!phone) return null
  const s = String(phone)
  if (s.length <= 4) return s
  return s.slice(0, 3) + '****' + s.slice(-4)
}

/**
 * 通用记录方法（异步、最佳努力，绝不抛错影响主流程）。
 * @param {Object} params
 * @param {'user'|'partner'|'system'|'anonymous'} params.actorType
 * @param {string|number|null} params.actorId
 * @param {string|null} params.actorLabel - 用户名/手机号（建议外部脱敏）
 * @param {string} params.event
 * @param {string|null} params.resource
 * @param {string|number|null} params.resourceId
 * @param {boolean} params.success
 * @param {Object|null} params.detail
 * @param {Express.Request|null} params.req - 用于自动取 IP/UA
 */
AuditLog.record = async function record(params) {
  const {
    actorType,
    actorId = null,
    actorLabel = null,
    event,
    resource = null,
    resourceId = null,
    success = true,
    detail = null,
    req = null
  } = params || {}

  try {
    await this.create({
      actor_type: actorType,
      actor_id: actorId == null ? null : String(actorId),
      actor_label: actorLabel,
      event,
      resource,
      resource_id: resourceId == null ? null : String(resourceId),
      success,
      detail,
      ip_address: sanitizeIp(req),
      user_agent: sanitizeUserAgent(req)
    })
  } catch (err) {
    logger.error('AuditLog.record 失败', {
      event,
      actor_type: actorType,
      err: err.message
    })
  }
}

AuditLog.logUser = function logUser({
  user,
  event,
  resource,
  resourceId,
  success = true,
  detail,
  req
}) {
  return AuditLog.record({
    actorType: user ? 'user' : 'anonymous',
    actorId: user?.id ?? null,
    actorLabel: user ? user.username || phoneMask(user.phone) : null,
    event,
    resource,
    resourceId,
    success,
    detail,
    req
  })
}

AuditLog.logPartner = function logPartner({
  partner,
  event,
  resource,
  resourceId,
  success = true,
  detail,
  req
}) {
  return AuditLog.record({
    actorType: 'partner',
    actorId: partner?.id ?? null,
    actorLabel: partner?.code || partner?.name || phoneMask(partner?.phone),
    event,
    resource,
    resourceId,
    success,
    detail,
    req
  })
}

AuditLog.logAdmin = function logAdmin({
  admin,
  event,
  resource,
  resourceId,
  success = true,
  detail,
  req
}) {
  return AuditLog.record({
    actorType: 'admin',
    actorId: admin?.id ?? null,
    actorLabel: admin?.username || null,
    event,
    resource,
    resourceId,
    success,
    detail,
    req
  })
}

AuditLog.logSystem = function logSystem({
  event,
  resource,
  resourceId,
  success = true,
  detail
}) {
  return AuditLog.record({
    actorType: 'system',
    event,
    resource,
    resourceId,
    success,
    detail
  })
}

export default AuditLog
