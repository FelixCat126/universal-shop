/**
 * 路由 → 请求/响应 schema 登记表。
 *
 * OpenAPI 文档之前只有"路径骨架"，没有请求/响应体 —— 前后端协作时
 * 真正会吵起来的是"这个接口到底要传什么、返回什么字段"。
 *
 * 这里把常用接口的请求体与响应体登记进来；schema 本体从 Sequelize 模型
 * 自动推导（见 modelSchema.js），所以改模型 → 文档自动跟着变。
 *
 * 登记表是**白名单**：没登记的路由仍然出现在文档里，但标注 x-schema: unknown
 * （明确"不知道"比"假装有"好）。
 *
 * 形状说明（列表接口的 data 形状各不相同，这里按**实际代码**登记，不统一）：
 *   { products: [], total, page, pageSize, totalPages }  —— 商品
 *   { orders: [], total, page, totalPages, stats }       —— 订单
 *   { list: [], total, page, pageSize, totalPages }      —— 促销/组合包/券模板
 *   []                                                     —— 地址/购物车/合作方
 */
import Product from '../models/Product.js'
import ProductCategory from '../models/ProductCategory.js'
import Order from '../models/Order.js'
import OrderItem from '../models/OrderItem.js'
import User from '../models/User.js'
import Address from '../models/Address.js'
import Cart from '../models/Cart.js'
import CouponTemplate from '../models/CouponTemplate.js'
import Promotion from '../models/Promotion.js'
import Bundle from '../models/Bundle.js'
import Partner from '../models/Partner.js'
import PartnerOrder from '../models/PartnerOrder.js'
import ExportJob from '../models/ExportJob.js'
import SystemConfig from '../models/SystemConfig.js'
import Administrator from '../models/Administrator.js'
import AfterSale from '../models/AfterSale.js'
import OperationLog from '../models/OperationLog.js'
import PartnerAddress from '../models/PartnerAddress.js'
import PartnerOrderItem from '../models/PartnerOrderItem.js'
import PointTransaction from '../models/PointTransaction.js'
import UserCoupon from '../models/UserCoupon.js'
import UserPointBalance from '../models/UserPointBalance.js'
import AdministrativeRegion from '../models/AdministrativeRegion.js'

import {
  modelToSchema,
  envelopeSchema,
  enumSchema
} from './modelSchema.js'

/* ------------------------------------------------------------------ */
/* 组件 schema（components.schemas）                                    */
/* ------------------------------------------------------------------ */

/** $ref 包装 */
const ref = name => ({ $ref: `#/components/schemas/${name}` })
/** 数组包装 */
const arrayOf = name => ({ type: 'array', items: ref(name) })

export const COMPONENT_SCHEMAS = {
  Product: modelToSchema(Product, {
    name: 'Product',
    extra: { description: '商品' }
  }),
  ProductCategory: modelToSchema(ProductCategory, {
    name: 'ProductCategory',
    extra: { description: '商品分类' }
  }),
  Order: modelToSchema(Order, {
    name: 'Order',
    extra: { description: '订单' }
  }),
  OrderItem: modelToSchema(OrderItem, {
    name: 'OrderItem',
    extra: { description: '订单行' }
  }),
  // 订单详情 = 订单本体 + 订单行 + 关联用户（详情接口实际返回的就是这个形状）
  OrderDetail: {
    allOf: [
      ref('Order'),
      {
        type: 'object',
        properties: {
          items: arrayOf('OrderItem'),
          user: ref('User')
        }
      }
    ],
    description: '订单详情（含订单行与关联用户）'
  },
  User: modelToSchema(User, {
    name: 'User',
    extra: { description: '用户' }
  }),
  Address: modelToSchema(Address, {
    name: 'Address',
    extra: { description: '收货地址' }
  }),
  Cart: modelToSchema(Cart, {
    name: 'Cart',
    extra: { description: '购物车条目' }
  }),
  CouponTemplate: modelToSchema(CouponTemplate, {
    name: 'CouponTemplate',
    extra: { description: '抵扣券模板' }
  }),
  Promotion: modelToSchema(Promotion, {
    name: 'Promotion',
    extra: { description: '促销活动' }
  }),
  Bundle: modelToSchema(Bundle, {
    name: 'Bundle',
    extra: { description: '组合套餐' }
  }),
  Partner: modelToSchema(Partner, {
    name: 'Partner',
    extra: { description: '合作方账号' }
  }),
  PartnerOrder: modelToSchema(PartnerOrder, {
    name: 'PartnerOrder',
    extra: { description: '合作方（批发）订单' }
  }),
  ExportJob: modelToSchema(ExportJob, {
    name: 'ExportJob',
    extra: { description: '异步导出任务' }
  }),
  SystemConfig: modelToSchema(SystemConfig, {
    name: 'SystemConfig',
    extra: { description: '系统配置项' }
  }),

  Administrator: modelToSchema(Administrator, {
    name: 'Administrator',
    // 绝不能把密码哈希写进契约文档
    exclude: ['password'],
    extra: { description: '管理员账号' }
  }),
  AfterSale: modelToSchema(AfterSale, {
    name: 'AfterSale',
    extra: { description: '售后申请' }
  }),
  OperationLog: modelToSchema(OperationLog, {
    name: 'OperationLog',
    extra: { description: '管理员操作日志' }
  }),
  PartnerAddress: modelToSchema(PartnerAddress, {
    name: 'PartnerAddress',
    extra: { description: '合作方收货地址' }
  }),
  PartnerOrderItem: modelToSchema(PartnerOrderItem, {
    name: 'PartnerOrderItem',
    extra: { description: '合作方订单行' }
  }),
  // 合作方订单（详情/列表都带订单行）
  PartnerOrderWithItems: {
    allOf: [
      ref('PartnerOrder'),
      {
        type: 'object',
        properties: { items: arrayOf('PartnerOrderItem') }
      }
    ],
    description: '合作方订单（含订单行）'
  },
  PointTransaction: modelToSchema(PointTransaction, {
    name: 'PointTransaction',
    extra: { description: '积分流水' }
  }),
  UserCoupon: modelToSchema(UserCoupon, {
    name: 'UserCoupon',
    extra: { description: '用户持有的抵扣券' }
  }),
  UserPointBalance: modelToSchema(UserPointBalance, {
    name: 'UserPointBalance',
    extra: { description: '用户积分余额' }
  }),
  AdministrativeRegion: modelToSchema(AdministrativeRegion, {
    name: 'AdministrativeRegion',
    extra: { description: '行政区划' }
  }),

  // 用户认证相关的请求体与响应（/api/users 与 /api/auth 共用）
  UserRegisterRequest: {
    type: 'object',
    description: '用户注册请求体',
    properties: {
      nickname: { type: 'string', maxLength: 50 },
      country_code: { type: 'string', enum: ['+86', '+66', '+60'] },
      phone: { type: 'string' },
      email: { type: 'string', maxLength: 100 },
      password: { type: 'string', minLength: 6, maxLength: 128 },
      referral_code: { type: 'string', description: '推荐码（选填）' }
    },
    required: ['nickname', 'phone', 'password']
  },
  UserLoginRequest: {
    type: 'object',
    description: '登录请求体（phone 需与 country_code 配对；也可只给 email）',
    properties: {
      country_code: { type: 'string', enum: ['+86', '+66', '+60'] },
      phone: { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' }
    },
    required: ['password']
  },
  UserProfileRequest: {
    type: 'object',
    description: '修改个人资料请求体',
    properties: {
      nickname: { type: 'string', maxLength: 50 },
      email: { type: 'string', maxLength: 100 },
      avatar_url: { type: 'string', maxLength: 512 }
    }
  },
  ChangePasswordRequest: {
    type: 'object',
    description: '修改密码请求体',
    properties: {
      old_password: { type: 'string', description: '当前密码' },
      new_password: { type: 'string', description: '新密码（至少 8 位，含字母与数字）' }
    },
    required: ['old_password', 'new_password']
  },
  DeleteAccountRequest: {
    type: 'object',
    description: '注销账号请求体（需校验密码）',
    properties: { password: { type: 'string' } },
    required: ['password']
  },
  ForgotPasswordRequest: {
    type: 'object',
    description: '发起密码重置',
    properties: {
      email: { type: 'string' },
      phone: { type: 'string' },
      country_code: { type: 'string', enum: ['+86', '+66', '+60'] }
    }
  },
  ResetPasswordRequest: {
    type: 'object',
    description: '用重置令牌设置新密码',
    properties: {
      token: { type: 'string', description: '重置令牌' },
      password: { type: 'string', description: '新密码' }
    },
    required: ['token', 'password']
  },
  AuthTokenEnvelope: envelopeSchema({
    type: 'object',
    properties: {
      token: { type: 'string', description: 'JWT 令牌' },
      user: ref('User')
    }
  }, '登录成功'),
  ProfileMetricsEnvelope: envelopeSchema({
    type: 'object',
    description: '个人中心概览指标',
    properties: {
      orderCount: { type: 'integer' },
      totalSpent: { type: 'string' },
      couponCount: { type: 'integer' },
      points: { type: 'integer' }
    }
  }, '个人中心指标'),
  ReferralInfoEnvelope: envelopeSchema({
    type: 'object',
    properties: {
      username: { type: 'string' },
      referral_code: { type: 'string' }
    }
  }, '推荐码信息'),
  PhoneExistsEnvelope: envelopeSchema({
    type: 'object',
    properties: {
      exists: { type: 'boolean', description: '该手机号是否已注册' }
    }
  }, '手机号是否存在'),

  // 统一响应信封（所有接口都返回这个形状）
  SuccessEnvelope: envelopeSchema({ type: 'object' }, '成功（无业务数据）'),
  ErrorEnvelope: {
    type: 'object',
    description: '失败响应',
    properties: {
      success: { type: 'boolean', enum: [false] },
      message: { type: 'string', description: '错误说明' },
      code: { type: 'string', description: '错误码' }
    },
    required: ['success', 'message']
  },

  // 请求体
  ProductCreateRequest: {
    type: 'object',
    description: '新建/编辑商品的请求体',
    properties: {
      name: { type: 'string', description: '商品名称' },
      name_th: { type: 'string', description: '泰文名称' },
      description: { type: 'string' },
      category_id: { type: 'integer', description: '分类 id' },
      price: { type: 'number', description: '售价（THB）' },
      points: { type: 'integer', description: '可抵扣积分' },
      discount: { type: 'number', description: '折扣比例' },
      stock: { type: 'integer', description: '库存' },
      image: { type: 'string', description: '图片 URL' },
      status: enumSchema(['active', 'inactive'])
    },
    required: ['name', 'price']
  },
  ProductBulkRequest: {
    type: 'object',
    description: '批量操作商品的请求体',
    properties: {
      ids: { type: 'array', items: { type: 'integer' }, description: '商品 id 列表（最多 200 个）' },
      action: enumSchema(['activate', 'deactivate', 'delete'])
    },
    required: ['ids', 'action']
  },
  OrderStatusRequest: {
    type: 'object',
    description: '改订单状态的请求体',
    properties: {
      status: enumSchema(['pending', 'paid', 'shipping', 'shipped', 'delivered', 'completed', 'cancelled']),
      tracking_number: { type: 'string', maxLength: 64, description: '物流单号' },
      admin_note: { type: 'string', maxLength: 2000, description: '内部备注（用户不可见）' }
    },
    required: ['status']
  },
  OrderBulkStatusRequest: {
    type: 'object',
    description: '批量改订单状态的请求体',
    properties: {
      ids: { type: 'array', items: { type: 'integer' }, description: '订单 id 列表（最多 200 个）' },
      status: enumSchema(['pending', 'paid', 'shipping', 'shipped', 'delivered', 'completed', 'cancelled']),
      tracking_number: { type: 'string', maxLength: 64 },
      admin_note: { type: 'string', maxLength: 2000 }
    },
    required: ['ids', 'status']
  },
  CartAddRequest: {
    type: 'object',
    description: '加入购物车的请求体',
    properties: {
      product_id: { type: 'integer' },
      quantity: { type: 'integer', minimum: 1 }
    },
    required: ['product_id', 'quantity']
  }
}

/* ------------------------------------------------------------------ */
/* 路由登记：'METHOD /path' → { request?, response? }                  */
/* ------------------------------------------------------------------ */

const env = name => envelopeSchema(ref(name))
/** 数组信封 */
const envArray = name => envelopeSchema(arrayOf(name))

/**
 * 分页信封（list 形状）
 * @param {string} name 元素 schema 名
 */
function pagedList (name) {
  return envelopeSchema({
    type: 'object',
    properties: {
      list: arrayOf(name),
      total: { type: 'integer', description: '总条数' },
      page: { type: 'integer', description: '当前页码' },
      pageSize: { type: 'integer', description: '每页条数' },
      totalPages: { type: 'integer', description: '总页数' }
    }
  }, '分页列表')
}

/**
 * 自定义 key 的分页信封（products / orders 用的是自己的 key）
 */
function pagedAs (name, key, extraProps = {}) {
  return envelopeSchema({
    type: 'object',
    properties: {
      [key]: arrayOf(name),
      total: { type: 'integer', description: '总条数' },
      page: { type: 'integer', description: '当前页码' },
      ...(key === 'products' ? { pageSize: { type: 'integer' } } : {}),
      totalPages: { type: 'integer', description: '总页数' },
      ...extraProps
    }
  }, '分页列表')
}

export const ROUTE_SCHEMAS = {
  /* ---------------- 商品 ---------------- */
  'GET /api/products': { response: pagedAs('Product', 'products') },
  'GET /api/products/:id': { response: env('Product') },
  'POST /api/products': { request: ref('ProductCreateRequest'), response: env('Product') },
  'PUT /api/products/:id': { request: ref('ProductCreateRequest'), response: env('Product') },
  'DELETE /api/products/:id': { response: ref('SuccessEnvelope') },
  'POST /api/products/bulk': {
    request: ref('ProductBulkRequest'),
    response: envelopeSchema({
      type: 'object',
      properties: {
        changed: { type: 'array', items: { type: 'integer' } },
        skipped: { type: 'array', items: { type: 'object' } }
      }
    }, '批量操作结果')
  },
  'GET /api/product-categories': { response: envArray('ProductCategory') },
  'GET /api/admin/product-categories': { response: envArray('ProductCategory') },
  'GET /api/products/export.csv': {
    query: [
      {
        name: 'format',
        schema: { type: 'string', enum: ['csv', 'xlsx'] },
        description: '导出格式（默认 csv）'
      }
    ],
    produces: 'text/csv',
    responseDescription: 'CSV 文件内容（含 BOM，Excel 打开中文不乱码）',
    response: { type: 'string', description: 'CSV 文件内容' }
  },
  'POST /api/products/import': {
    request: {
      type: 'object',
      description: 'multipart/form-data：file（CSV 文件）+ dry_run（1 = 只预览不落库）',
      properties: {
        file: { type: 'string', format: 'binary', description: 'CSV 文件（第一行是表头）' },
        dry_run: { type: 'string', enum: ['1', 'false'], description: '1 = 只校验预览，false = 真正导入' },
        mode: {
          type: 'string',
          enum: ['strict', 'skip'],
          description: 'strict = 有问题整批不落库（默认）；skip = 跳过有问题的行并逐条回报'
        }
      },
      required: ['file']
    },
    response: envelopeSchema({
      type: 'object',
      properties: {
        totalRows: { type: 'integer', description: 'CSV 数据行数' },
        validCount: { type: 'integer', description: '可导入的行数' },
        invalidCount: { type: 'integer', description: '有问题的行数' },
        createCount: { type: 'integer', description: '将新建的行数' },
        updateCount: { type: 'integer', description: '将更新的行数' },
        invalid: {
          type: 'array',
          description: '有问题的行（逐行给出原因）',
          items: {
            type: 'object',
            properties: {
              rowNumber: { type: 'integer', description: 'CSV 里的行号（含表头，从 2 开始）' },
              name: { type: 'string' },
              errors: { type: 'array', items: { type: 'string' }, description: '问题原因' }
            }
          }
        },
        valid: {
          type: 'array',
          description: '可导入的行',
          items: {
            type: 'object',
            properties: {
              rowNumber: { type: 'integer' },
              action: { type: 'string', enum: ['create', 'update'] },
              name: { type: 'string' },
              price: { type: 'number' },
              stock: { type: 'integer' }
            }
          }
        }
      }
    }, '导入预览 / 导入结果')
  },

  /* ---------------- 订单 ---------------- */
  'GET /api/orders': {
    response: pagedAs('Order', 'orders', {
      spent_thb_sum: { type: 'number', description: '累计消费（THB）' }
    })
  },
  'GET /api/orders/:id': { response: env('OrderDetail') },
  'POST /api/orders': { response: env('Order') },
  'POST /api/orders/quote': { response: envelopeSchema({ type: 'object' }, '下单试算结果') },
  'GET /api/admin/orders': {
    response: pagedAs('Order', 'orders', {
      stats: { type: 'object', description: '全量聚合统计' }
    })
  },
  'GET /api/admin/orders/:id': { response: env('OrderDetail') },
  'PUT /api/admin/orders/:id/status': {
    request: ref('OrderStatusRequest'),
    response: env('Order')
  },
  'POST /api/admin/orders/bulk/status': {
    request: ref('OrderBulkStatusRequest'),
    response: envelopeSchema({
      type: 'object',
      properties: {
        changed: { type: 'array', items: { type: 'integer' }, description: '已改动的订单 id' },
        skipped: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              status: { type: 'string' },
              reason: { type: 'string', description: '跳过原因' }
            }
          },
          description: '被跳过的订单及原因'
        }
      }
    }, '批量改状态结果')
  },
  'DELETE /api/admin/orders/:id': { response: ref('SuccessEnvelope') },
  'GET /api/admin/partner-orders': { response: pagedList('PartnerOrder') },

  /* ---------------- 用户与地址 ---------------- */
  'GET /api/users/profile': { response: env('User') },
  'PUT /api/users/profile': { response: env('User') },
  'GET /api/admin/users': { response: pagedList('User') },
  'GET /api/admin/users/:userId/addresses': { response: envArray('Address') },
  'GET /api/addresses': { response: envArray('Address') },
  'POST /api/addresses': { response: env('Address') },
  'PUT /api/addresses/:id': { response: env('Address') },
  'DELETE /api/addresses/:id': { response: ref('SuccessEnvelope') },

  /* ---------------- 购物车 ---------------- */
  'GET /api/cart': { response: envArray('Cart') },
  'POST /api/cart': { request: ref('CartAddRequest'), response: env('Cart') },
  'PUT /api/cart/:id': { request: ref('CartAddRequest'), response: env('Cart') },
  'DELETE /api/cart/:id': { response: ref('SuccessEnvelope') },

  /* ---------------- 营销 ---------------- */
  'GET /api/admin/coupon-templates': { response: pagedList('CouponTemplate') },
  'GET /api/admin/promotions': { response: pagedList('Promotion') },
  'GET /api/admin/bundles': { response: pagedList('Bundle') },

  /* ---------------- 合作方 ---------------- */
  'GET /api/partner/orders': { response: pagedList('PartnerOrderWithItems') },
  'GET /api/partner/orders/:id': { response: env('PartnerOrderWithItems') },
  'GET /api/admin/partners': { response: envArray('Partner') },

  /* ---------------- 管理员账号 ---------------- */
  'GET /api/admin/administrators': { response: pagedList('Administrator') },
  'POST /api/admin/administrators': {
    request: {
      type: 'object',
      properties: {
        username: { type: 'string', description: '登录名' },
        password: { type: 'string', description: '初始密码' },
        email: { type: 'string' },
        role: { type: 'string', enum: ['super_admin', 'admin', 'operator'] },
        real_name: { type: 'string' },
        phone: { type: 'string' }
      },
      required: ['username', 'password']
    },
    response: env('Administrator')
  },
  'PUT /api/admin/administrators/:id': {
    request: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        role: { type: 'string', enum: ['super_admin', 'admin', 'operator'] },
        real_name: { type: 'string' },
        phone: { type: 'string' },
        is_active: { type: 'boolean' }
      }
    },
    response: env('Administrator')
  },
  'DELETE /api/admin/administrators/:id': { response: ref('SuccessEnvelope') },
  'PUT /api/admin/administrators/:id/reset-password': {
    request: {
      type: 'object',
      properties: { newPassword: { type: 'string', description: '新密码' } },
      required: ['newPassword']
    },
    response: ref('SuccessEnvelope')
  },
  'POST /api/admin/login': {
    request: {
      type: 'object',
      properties: {
        username: { type: 'string', description: '登录名' },
        password: { type: 'string' }
      },
      required: ['username', 'password']
    },
    response: envelopeSchema({
      type: 'object',
      properties: {
        token: { type: 'string', description: 'JWT 令牌' },
        admin: ref('Administrator')
      }
    }, '登录成功')
  },
  'GET /api/admin/validate-token': {
    response: envelopeSchema({
      type: 'object',
      properties: { admin: ref('Administrator') }
    }, '当前管理员')
  },

  /* ---------------- 售后 ---------------- */
  'GET /api/admin/after-sales': { response: pagedList('AfterSale') },
  'PUT /api/admin/after-sales/:id/status': {
    request: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'completed'] },
        admin_note: { type: 'string', description: '内部处理备注' }
      },
      required: ['status']
    },
    response: env('AfterSale')
  },

  /* ---------------- 营销：券模板 / 促销 / 组合包 ---------------- */
  'POST /api/admin/coupon-templates': {
    request: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        amount: { type: 'number', description: '抵扣金额' },
        min_spend: { type: 'number', description: '最低消费' },
        total: { type: 'integer', description: '发放总量（null = 不限）' },
        per_user: { type: 'integer', description: '每人限领' },
        scope: { type: 'string', description: '适用范围' },
        valid_from: { type: 'string', format: 'date-time' },
        valid_to: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['active', 'inactive'] }
      },
      required: ['name', 'amount']
    },
    response: env('CouponTemplate')
  },
  'PUT /api/admin/coupon-templates/:id': {
    request: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        amount: { type: 'number' },
        min_spend: { type: 'number' },
        total: { type: 'integer' },
        per_user: { type: 'integer' },
        scope: { type: 'string' },
        status: { type: 'string', enum: ['active', 'inactive'] }
      }
    },
    response: env('CouponTemplate')
  },
  'DELETE /api/admin/coupon-templates/:id': { response: ref('SuccessEnvelope') },
  'PUT /api/admin/coupon-templates/:id/status': {
    request: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['active', 'inactive'] } },
      required: ['status']
    },
    response: env('CouponTemplate')
  },
  'GET /api/admin/coupon-templates/:id/instances': {
    response: pagedList('UserCoupon')
  },
  'POST /api/admin/promotions': {
    request: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', description: '促销类型（threshold = 满减）' },
        threshold_amount: { type: 'number', description: '满减门槛' },
        discount_amount: { type: 'number', description: '减免金额' },
        start_date: { type: 'string', format: 'date-time' },
        end_date: { type: 'string', format: 'date-time' },
        status: { type: 'string' }
      },
      required: ['name']
    },
    response: env('Promotion')
  },
  'PUT /api/admin/promotions/:id': {
    request: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        threshold_amount: { type: 'number' },
        discount_amount: { type: 'number' },
        status: { type: 'string' }
      }
    },
    response: env('Promotion')
  },
  'DELETE /api/admin/promotions/:id': { response: ref('SuccessEnvelope') },
  'PUT /api/admin/promotions/:id/status': {
    request: {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status']
    },
    response: env('Promotion')
  },
  'POST /api/admin/bundles': {
    request: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        image: { type: 'string' },
        items: {
          type: 'array',
          description: '组件商品及配比数量',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'integer' },
              quantity: { type: 'integer', minimum: 1 }
            },
            required: ['product_id', 'quantity']
          }
        },
        status: { type: 'string', enum: ['active', 'inactive'] }
      },
      required: ['name', 'items']
    },
    response: env('Bundle')
  },
  'PUT /api/admin/bundles/:id': {
    request: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        image: { type: 'string' },
        items: { type: 'array', items: { type: 'object' } },
        status: { type: 'string', enum: ['active', 'inactive'] }
      }
    },
    response: env('Bundle')
  },
  'DELETE /api/admin/bundles/:id': { response: ref('SuccessEnvelope') },
  'PUT /api/admin/bundles/:id/status': {
    request: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['active', 'inactive'] } },
      required: ['status']
    },
    response: env('Bundle')
  },

  /* ---------------- 商品分类 ---------------- */
  'POST /api/admin/product-categories': {
    request: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        sort_order: { type: 'integer' }
      },
      required: ['name']
    },
    response: env('ProductCategory')
  },
  'PUT /api/admin/product-categories/:id': {
    request: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        sort_order: { type: 'integer' }
      }
    },
    response: env('ProductCategory')
  },
  'DELETE /api/admin/product-categories/:id': { response: ref('SuccessEnvelope') },

  /* ---------------- 合作方 CSV 批量导入/导出 ---------------- */
  'GET /api/admin/partners/export.csv': {
    produces: 'text/csv',
    responseDescription: '合作方名单 CSV（含 BOM）',
    response: { type: 'string', description: '合作方名单 CSV' }
  },
  'POST /api/admin/partners/import': {
    request: {
      type: 'object',
      description: 'multipart/form-data：file（CSV 文件）+ dry_run（1 = 只预览不落库）',
      properties: {
        file: { type: 'string', format: 'binary', description: 'CSV 文件（第一行是表头）' },
        dry_run: { type: 'string', enum: ['1', 'false'], description: '1 = 只校验预览，false = 真正导入' },
        mode: {
          type: 'string',
          enum: ['strict', 'skip'],
          description: 'strict = 有问题整批不落库（默认）；skip = 跳过有问题的行并逐条回报'
        }
      },
      required: ['file']
    },
    response: envelopeSchema({
      type: 'object',
      properties: {
        totalRows: { type: 'integer', description: 'CSV 数据行数' },
        validCount: { type: 'integer', description: '可导入的行数' },
        invalidCount: { type: 'integer', description: '有问题的行数' },
        createCount: { type: 'integer', description: '将新建的行数' },
        updateCount: { type: 'integer', description: '将更新的行数' },
        invalid: {
          type: 'array',
          description: '有问题的行（逐行给出原因）',
          items: {
            type: 'object',
            properties: {
              rowNumber: { type: 'integer', description: 'CSV 里的行号（含表头，从 2 开始）' },
              login: { type: 'string' },
              errors: { type: 'array', items: { type: 'string' }, description: '问题原因' }
            }
          }
        },
        valid: {
          type: 'array',
          description: '可导入的行',
          items: {
            type: 'object',
            properties: {
              rowNumber: { type: 'integer' },
              action: { type: 'string', enum: ['create', 'update'] },
              login: { type: 'string' },
              display_name: { type: 'string' },
              account_kind: { type: 'string', enum: ['dealer', 'agent'] },
              discount_percent: { type: 'number' }
            }
          }
        }
      }
    }, '导入预览 / 导入结果')
  },

  /* ---------------- 合作方管理 ---------------- */
  'POST /api/admin/partners': {
    request: {
      type: 'object',
      properties: {
        login: { type: 'string', description: '登录名' },
        password: { type: 'string' },
        display_name: { type: 'string' },
        discount_percent: { type: 'number', description: '合作方折扣（百分比）' },
        account_kind: { type: 'string', description: '账号类型' },
        is_active: { type: 'boolean' }
      },
      required: ['login', 'password']
    },
    response: env('Partner')
  },
  'PUT /api/admin/partners/:id': {
    request: {
      type: 'object',
      properties: {
        display_name: { type: 'string' },
        discount_percent: { type: 'number' },
        account_kind: { type: 'string' },
        is_active: { type: 'boolean' }
      }
    },
    response: env('Partner')
  },
  'DELETE /api/admin/partners/:id': { response: ref('SuccessEnvelope') },
  'PUT /api/admin/partners/:id/password': {
    request: {
      type: 'object',
      properties: { newPassword: { type: 'string' } },
      required: ['newPassword']
    },
    response: ref('SuccessEnvelope')
  },
  'PUT /api/admin/partner-orders/:id/status': {
    request: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['submitted', 'pending_payment', 'completed', 'cancelled'],
          description: '合作方订单状态流转'
        }
      },
      required: ['status']
    },
    response: env('PartnerOrder')
  },

  /* ---------------- 用户 CSV 批量导入/导出 ---------------- */
  'GET /api/admin/users/export.csv': {
    produces: 'text/csv',
    responseDescription: '用户名单 CSV（含 BOM）',
    response: { type: 'string', description: '用户名单 CSV' }
  },
  'POST /api/admin/users/import': {
    request: {
      type: 'object',
      description: 'multipart/form-data：file（CSV 文件）+ dry_run（1 = 只预览不落库）',
      properties: {
        file: { type: 'string', format: 'binary', description: 'CSV 文件（第一行是表头；**不要写密码**）' },
        dry_run: { type: 'string', enum: ['1', 'false'], description: '1 = 只校验预览，false = 真正导入' },
        mode: {
          type: 'string',
          enum: ['strict', 'skip'],
          description: 'strict = 有问题整批不落库（默认）；skip = 跳过有问题的行并逐条回报'
        }
      },
      required: ['file']
    },
    response: envelopeSchema({
      type: 'object',
      properties: {
        totalRows: { type: 'integer' },
        validCount: { type: 'integer' },
        invalidCount: { type: 'integer' },
        createCount: { type: 'integer' },
        updateCount: { type: 'integer' },
        invalid: {
          type: 'array',
          description: '有问题的行（逐行给出原因）',
          items: {
            type: 'object',
            properties: {
              rowNumber: { type: 'integer' },
              nickname: { type: 'string' },
              errors: { type: 'array', items: { type: 'string' } }
            }
          }
        },
        valid: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              rowNumber: { type: 'integer' },
              action: { type: 'string', enum: ['create', 'update'] },
              nickname: { type: 'string' },
              phone: { type: 'string' },
              email: { type: 'string' }
            }
          }
        }
      }
    }, '导入预览 / 导入结果')
  },

  /* ---------------- 用户管理 ---------------- */
  'PUT /api/admin/users/:id/status': {
    request: {
      type: 'object',
      properties: { status: { type: 'string', description: 'active / inactive' } },
      required: ['status']
    },
    response: env('User')
  },

  /* ---------------- 导出任务 ---------------- */
  'POST /api/admin/export/jobs': {
    request: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['users', 'orders', 'partner_orders', 'products', 'partners', 'categories'],
          description: '导出类型'
        },
        params: { type: 'object', description: '导出筛选条件' },
        format: { type: 'string', enum: ['xlsx', 'csv'], description: '导出格式（默认 xlsx）' }
      },
      required: ['type']
    },
    response: env('ExportJob')
  },
  'DELETE /api/admin/export/jobs/:id': { response: ref('SuccessEnvelope') },
  'GET /api/admin/export/jobs/:id/download': {
    response: { type: 'string', description: '导出文件（xlsx 二进制）' }
  },
  'GET /api/admin/orders/export': {
    response: { type: 'string', description: '订单导出文件' }
  },
  'GET /api/admin/partner-orders/export': {
    response: { type: 'string', description: '合作方订单导出文件' }
  },
  'GET /api/admin/export/users': {
    query: [
      {
        name: 'format',
        schema: { type: 'string', enum: ['csv', 'xlsx'] },
        description: '导出格式：csv 给财务对账/ERP 导入，xlsx 给人看'
      }
    ],
    produces: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    responseDescription: '用户导出文件',
    response: { type: 'string', description: '用户导出文件（xlsx 或 csv）' }
  },

  /* ---------------- 日志与监控 ---------------- */
  'GET /api/admin/operation-logs': { response: pagedList('OperationLog') },
  'GET /api/admin/metrics': {
    response: envelopeSchema({
      type: 'object',
      description: '运行时指标（内存/耗时/请求数等）',
      properties: {
        uptime: { type: 'number' },
        memory: { type: 'object' },
        requests: { type: 'object' }
      }
    }, '运行时指标')
  },

  /* ---------------- 统计 ---------------- */
  'GET /api/admin/statistics/overview': {
    response: envelopeSchema({
      type: 'object',
      properties: {
        totalOrders: { type: 'integer', description: '总订单数' },
        totalAmount: { type: 'string', description: '总营收（THB）' },
        totalUsers: { type: 'integer', description: '总用户数' },
        activeUsers: { type: 'integer', description: '近七天活跃用户数' }
      }
    }, '统计总览')
  },
  'GET /api/admin/statistics/order-trend': {
    response: envelopeSchema({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          dateLabel: { type: 'string' },
          count: { type: 'integer' },
          amount: { type: 'string' }
        }
      }
    }, '近七天订单趋势')
  },
  'GET /api/admin/statistics/user-trend': {
    response: envelopeSchema({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          dateLabel: { type: 'string' },
          count: { type: 'integer' }
        }
      }
    }, '近七天用户注册趋势')
  },
  'GET /api/admin/statistics/comprehensive': {
    response: envelopeSchema({
      type: 'object',
      properties: {
        overview: { type: 'object', description: '统计总览' },
        orderTrend: { type: 'array', items: { type: 'object' } },
        userTrend: { type: 'array', items: { type: 'object' } }
      }
    }, '综合统计')
  },

  /* ---------------- 行政区划 ---------------- */
  'GET /api/administrative-regions/provinces': {
    response: envelopeSchema(arrayOf('AdministrativeRegion'), '省份列表')
  },
  'GET /api/administrative-regions/all': {
    response: envelopeSchema(arrayOf('AdministrativeRegion'), '全部行政区划')
  },
  'GET /api/administrative-regions/provinces/:id/districts': {
    response: envelopeSchema(arrayOf('AdministrativeRegion'), '区县列表')
  },
  'GET /api/administrative-regions/districts/:id/sub-districts': {
    response: envelopeSchema(arrayOf('AdministrativeRegion'), '子区县列表')
  },
  'GET /api/administrative-regions/postal-code/:code': {
    response: envelopeSchema(ref('AdministrativeRegion'), '按邮编查行政区划')
  },

  /* ---------------- 用户认证 ---------------- */
  'POST /api/users/register': { request: ref('UserRegisterRequest'), response: env('User') },
  'POST /api/users/login': { request: ref('UserLoginRequest'), response: ref('AuthTokenEnvelope') },
  'POST /api/users/logout': { response: ref('SuccessEnvelope') },
  'GET /api/users/profile': { response: env('User') },
  'PUT /api/users/profile': { request: ref('UserProfileRequest'), response: env('User') },
  'GET /api/users/profile/metrics': { response: ref('ProfileMetricsEnvelope') },
  'PUT /api/users/profile/password': { request: ref('ChangePasswordRequest'), response: ref('SuccessEnvelope') },
  'POST /api/users/me/delete': { request: ref('DeleteAccountRequest'), response: ref('SuccessEnvelope') },
  'GET /api/users/verify': {
    response: envelopeSchema({ type: 'object' }, '令牌校验结果')
  },
  'GET /api/users/verify-referral/:code': { response: ref('ReferralInfoEnvelope') },
  'GET /api/users/check-phone/:phone': { response: ref('PhoneExistsEnvelope') },
  'POST /api/users/forgot-password': { request: ref('ForgotPasswordRequest'), response: ref('SuccessEnvelope') },
  'POST /api/users/reset-password': { request: ref('ResetPasswordRequest'), response: ref('SuccessEnvelope') },
  'GET /api/users/points/balance': {
    response: envelopeSchema(ref('UserPointBalance'), '积分余额')
  },
  'GET /api/users/points/transactions': {
    response: pagedList('PointTransaction')
  },

  /* ---------------- 地址 ---------------- */
  'GET /api/addresses/:id': { response: env('Address') },
  'PUT /api/addresses/:id/default': { response: env('Address') },

  /* ---------------- 组合包（前台） ---------------- */
  'GET /api/bundles': { response: envArray('Bundle') },
  'GET /api/bundles/:id': { response: env('Bundle') },

  /* ---------------- 购物车 ---------------- */
  'DELETE /api/cart': { response: ref('SuccessEnvelope') },

  /* ---------------- 抵扣券（前台） ---------------- */
  'GET /api/coupons/available': { response: envArray('CouponTemplate') },
  'GET /api/coupons/mine': { response: envArray('UserCoupon') },
  'POST /api/coupons/claim': {
    request: {
      type: 'object',
      properties: { template_id: { type: 'integer', description: '券模板 id' } },
      required: ['template_id']
    },
    response: env('UserCoupon')
  },

  /* ---------------- 售后（前台） ---------------- */
  'GET /api/orders/after-sales/mine': { response: pagedList('AfterSale') },
  'POST /api/orders/:id/after-sales': {
    request: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '售后类型' },
        reason: { type: 'string', description: '申请理由' }
      },
      required: ['type', 'reason']
    },
    response: env('AfterSale')
  },
  'POST /api/orders/:id/confirm-online-payment': {
    request: {
      type: 'object',
      properties: {
        client_order_key: { type: 'string', description: '幂等键' }
      }
    },
    response: env('Order')
  },

  /* ---------------- 合作方门户 ---------------- */
  'GET /api/partner/addresses': { response: envArray('PartnerAddress') },
  'POST /api/partner/addresses': {
    request: {
      type: 'object',
      properties: {
        recipient_name: { type: 'string' },
        phone: { type: 'string' },
        phone_country_code: { type: 'string', enum: ['+86', '+66', '+60'] },
        province: { type: 'string' },
        city: { type: 'string' },
        district: { type: 'string' },
        postal_code: { type: 'string' },
        detail: { type: 'string' },
        label: { type: 'string' },
        is_default: { type: 'boolean' }
      },
      required: ['recipient_name', 'phone', 'detail']
    },
    response: env('PartnerAddress')
  },
  'PUT /api/partner/addresses/:id': {
    request: {
      type: 'object',
      properties: {
        recipient_name: { type: 'string' },
        phone: { type: 'string' },
        phone_country_code: { type: 'string', enum: ['+86', '+66', '+60'] },
        province: { type: 'string' },
        city: { type: 'string' },
        district: { type: 'string' },
        postal_code: { type: 'string' },
        detail: { type: 'string' },
        label: { type: 'string' },
        is_default: { type: 'boolean' }
      }
    },
    response: env('PartnerAddress')
  },
  'DELETE /api/partner/addresses/:id': { response: ref('SuccessEnvelope') },

  /* ---------------- /api/auth（/api/users 的别名挂载） ---------------- */
  'POST /api/auth/register': { request: ref('UserRegisterRequest'), response: env('User') },
  'POST /api/auth/login': { request: ref('UserLoginRequest'), response: ref('AuthTokenEnvelope') },
  'POST /api/auth/logout': { response: ref('SuccessEnvelope') },
  'GET /api/auth/profile': { response: env('User') },
  'PUT /api/auth/profile': { request: ref('UserProfileRequest'), response: env('User') },
  'GET /api/auth/profile/metrics': { response: ref('ProfileMetricsEnvelope') },
  'PUT /api/auth/profile/password': { request: ref('ChangePasswordRequest'), response: ref('SuccessEnvelope') },
  'POST /api/auth/me/delete': { request: ref('DeleteAccountRequest'), response: ref('SuccessEnvelope') },
  'GET /api/auth/verify': { response: ref('SuccessEnvelope') },
  'GET /api/auth/verify-referral/:code': { response: ref('ReferralInfoEnvelope') },
  'GET /api/auth/check-phone/:phone': { response: ref('PhoneExistsEnvelope') },
  'POST /api/auth/forgot-password': { request: ref('ForgotPasswordRequest'), response: ref('SuccessEnvelope') },
  'POST /api/auth/reset-password': { request: ref('ResetPasswordRequest'), response: ref('SuccessEnvelope') },
  'GET /api/auth/points/balance': { response: env('UserPointBalance') },
  'GET /api/auth/points/transactions': { response: pagedList('PointTransaction') },

  /* ---------------- 合作方门户 ---------------- */
  'POST /api/partner/login': {
    request: {
      type: 'object',
      properties: {
        login: { type: 'string', description: '合作方登录名' },
        password: { type: 'string' }
      },
      required: ['login', 'password']
    },
    response: envelopeSchema({
      type: 'object',
      properties: {
        token: { type: 'string', description: 'JWT 令牌' },
        partner: ref('Partner')
      }
    }, '登录成功')
  },
  'GET /api/partner/me': { response: env('Partner') },
  'GET /api/partner/products': {
    response: envelopeSchema({
      type: 'object',
      properties: {
        products: arrayOf('Product'),
        total: { type: 'integer' },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        totalPages: { type: 'integer' }
      }
    }, '合作方可订商品列表')
  },
  'POST /api/partner/orders': {
    request: {
      type: 'object',
      properties: {
        partner_address_id: { type: 'integer', description: '收货地址 id' },
        client_order_key: { type: 'string', description: '幂等键（同一 key 只成一单）' },
        items: {
          type: 'array',
          description: '订货明细',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'integer' },
              quantity: { type: 'integer', minimum: 1, description: '数量（受 MOQ 约束）' }
            },
            required: ['product_id', 'quantity']
          }
        }
      },
      required: ['partner_address_id', 'items']
    },
    response: env('PartnerOrderWithItems')
  },
  'POST /api/partner/orders/:id/confirm-payment': {
    request: { type: 'object' },
    response: env('PartnerOrderWithItems')
  },
  'PUT /api/partner/addresses/:id/default': { response: env('PartnerAddress') },

  /* ---------------- 商品：库存与上架 ---------------- */
  'POST /api/products/check-stock': {
    request: {
      type: 'object',
      properties: {
        productIds: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 1,
          maxItems: 200,
          description: '要查库存的商品 id（1-200 个）'
        }
      },
      required: ['productIds']
    },
    response: envelopeSchema({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          stock: { type: 'integer' }
        }
      }
    }, '各商品库存')
  },
  'POST /api/products/:id/stock': {
    request: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['set', 'add', 'subtract'], description: '调整方式' },
        quantity: { type: 'integer', minimum: 0, maximum: 1000000 }
      },
      required: ['type', 'quantity']
    },
    response: env('Product')
  },
  'POST /api/products/:id/restore': { response: env('Product') },

  /* ---------------- 系统配置 ---------------- */
  'POST /api/system-config': {
    request: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '配置项 key' },
        value: { type: 'string', description: '配置项值' },
        type: { type: 'string', description: '值类型' },
        description: { type: 'string' }
      },
      required: ['key', 'value']
    },
    response: env('SystemConfig')
  },
  'GET /api/system-config/:key': { response: env('SystemConfig') },
  'DELETE /api/system-config/:key': { response: ref('SuccessEnvelope') },
  'DELETE /api/system-config/home-banner': { response: ref('SuccessEnvelope') },
  'DELETE /api/system-config/payment-qr': { response: ref('SuccessEnvelope') },
  'POST /api/system-config/upload/home-banner': {
    request: {
      type: 'object',
      description: 'multipart/form-data：banner（图片文件）',
      properties: { banner: { type: 'string', format: 'binary' } },
      required: ['banner']
    },
    response: envelopeSchema({
      type: 'object',
      properties: { imageUrl: { type: 'string' } }
    }, '上传成功')
  },
  'POST /api/system-config/upload/payment-qr': {
    request: {
      type: 'object',
      description: 'multipart/form-data：qrcode（图片文件）',
      properties: { qrcode: { type: 'string', format: 'binary' } },
      required: ['qrcode']
    },
    response: envelopeSchema({
      type: 'object',
      properties: { imageUrl: { type: 'string' } }
    }, '上传成功')
  },

  /* ---------------- 上传 ---------------- */
  'POST /api/upload/avatar': {
    request: {
      type: 'object',
      description: 'multipart/form-data：avatar（图片文件）',
      properties: { avatar: { type: 'string', format: 'binary' } },
      required: ['avatar']
    },
    response: envelopeSchema({
      type: 'object',
      properties: { url: { type: 'string', description: '头像地址' } }
    }, '上传成功')
  },
  'POST /api/upload/product-image': {
    request: {
      type: 'object',
      description: 'multipart/form-data：image（图片文件）',
      properties: { image: { type: 'string', format: 'binary' } },
      required: ['image']
    },
    response: envelopeSchema({
      type: 'object',
      properties: {
        url: { type: 'string', description: '图片地址' },
        variants: { type: 'object', description: '派生尺寸（thumb / mid）' }
      }
    }, '上传成功')
  },
  'DELETE /api/upload/product-image/:filename': { response: ref('SuccessEnvelope') },

  /* ---------------- 杂项 ---------------- */
  'GET /api/health': {
    response: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        ready: { type: 'boolean', description: '数据库是否就绪' },
        message: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
        port: { type: 'string' }
      }
    }
  },
  'GET /api/portal-build': {
    response: {
      type: 'object',
      description: '前端构建信息（排查"部署的还是旧包"用）',
      properties: {
        portalIndexModified: { type: 'string' },
        adminIndexModified: { type: 'string' },
        partnerIndexModified: { type: 'string' }
      }
    }
  },
  'GET /api/security/captcha': {
    response: envelopeSchema({
      type: 'object',
      properties: {
        captcha_id: { type: 'string' },
        image: { type: 'string', description: 'base64 图片' }
      }
    }, '验证码')
  },
  'POST /api/admin/init': {
    request: {
      type: 'object',
      description: '初始化超级管理员（需 INIT_SECRET）',
      properties: {
        username: { type: 'string' },
        password: { type: 'string' },
        initSecret: { type: 'string' }
      },
      required: ['username', 'password']
    },
    response: env('Administrator')
  },
  'GET /api/admin/export/orders': {
    query: [
      {
        name: 'format',
        schema: { type: 'string', enum: ['csv', 'xlsx'] },
        description: '导出格式：csv 给财务对账/ERP 导入，xlsx 给人看'
      }
    ],
    produces: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    responseDescription: '订单导出文件',
    response: { type: 'string', description: '订单导出文件（xlsx 或 csv）' }
  },

  /* ---------------- 系统 ---------------- */
  'GET /api/admin/export/jobs': { response: envArray('ExportJob') },
  'GET /api/system-config/public': { response: envelopeSchema({ type: 'object' }, '公开配置') },
  'GET /api/system-config': { response: envArray('SystemConfig') }
}

export default { COMPONENT_SCHEMAS, ROUTE_SCHEMAS }
