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
    response: {
      type: 'string',
      description: 'CSV 文件内容（含 BOM，Excel 打开中文不乱码）'
    }
  },
  'POST /api/products/import': {
    request: {
      type: 'object',
      description: 'multipart/form-data：file（CSV 文件）+ dry_run（1 = 只预览不落库）',
      properties: {
        file: { type: 'string', format: 'binary', description: 'CSV 文件（第一行是表头）' },
        dry_run: { type: 'string', enum: ['1', 'false'], description: '1 = 只校验预览，false = 真正导入' }
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
  'GET /api/partner/orders': { response: pagedList('PartnerOrder') },
  'GET /api/partner/orders/:id': { response: env('PartnerOrder') },
  'GET /api/admin/partners': { response: envArray('Partner') },

  /* ---------------- 系统 ---------------- */
  'GET /api/admin/export/jobs': { response: envArray('ExportJob') },
  'GET /api/system-config/public': { response: envelopeSchema({ type: 'object' }, '公开配置') },
  'GET /api/system-config': { response: envArray('SystemConfig') }
}

export default { COMPONENT_SCHEMAS, ROUTE_SCHEMAS }
