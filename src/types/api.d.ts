/**
 * 自动生成的 API 类型声明 —— 请勿手改。
 *
 * 来源：docs/openapi.json（由 scripts/generate-openapi.mjs 从 Express 路由表
 * + Sequelize 模型生成）。重新生成：npm run gen:openapi && npm run gen:types
 *
 * 本项目是 JS，用 JSDoc 引用即可获得字段补全：
 *   在 .js 文件里写 @type {import('@/types/api').Product} 标注变量
 */

/**
 * 商品
 */
export interface Product {
  id?: number
  name: string
  name_th?: string | null
  alias?: string | null
  description?: string | null
  category_id?: number | null
  price: number
  points: number
  discount?: number | null
  stock: number
  image?: string | null
  status?: "active" | "inactive"
  created_at: string
  updated_at: string
  deleted_at?: string
}

/**
 * 商品分类
 */
export interface ProductCategory {
  id?: number
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

/**
 * 订单
 */
export interface Order {
  id?: number
  order_no: string
  user_id: number
  total_amount: number
  total_amount_thb?: number | null
  discount_amount: number
  currency_code: string
  payment_method: string
  points_redeemed?: number | null
  pricing_version?: string | null
  discount_snapshot?: Record<string, unknown> | null
  status: string
  contact_name?: string | null
  contact_phone?: string | null
  delivery_address?: string | null
  province?: string | null
  city?: string | null
  district?: string | null
  postal_code?: string | null
  tracking_number?: string | null
  shipped_at?: string | null
  admin_note?: string | null
  notes?: string | null
  exchange_rate: number
  online_paid_at?: string | null
  client_order_key?: string | null
  created_at: string
  updated_at: string
}

/**
 * 订单行
 */
export interface OrderItem {
  id?: number
  order_id: number
  product_id: number
  quantity: number
  price: number
  original_price?: number | null
  discount?: number | null
  product_name_zh?: string | null
  product_name_th?: string | null
  points_line_cost?: number | null
  discount_allocated: number
  is_gift: boolean
  bundle_id?: number | null
  created_at: string
  updated_at: string
}

/**
 * 订单详情（含订单行与关联用户）
 */
export interface OrderDetail extends Order {
  items?: OrderItem[]
  user?: User
}

/**
 * 用户
 */
export interface User {
  id?: number
  username?: string | null
  email?: string | null
  nickname: string
  avatar_url?: string | null
  country_code: string
  phone: string
  password: string
  referral_code?: string | null
  referred_by_code?: string | null
  created_at: string
  updated_at: string
  is_active: boolean
  last_login_at?: string | null
  must_reset_password: boolean
  token_version: number
}

/**
 * 收货地址
 */
export interface Address {
  id?: number
  user_id: number
  contact_name: string
  contact_country_code: string
  contact_phone: string
  province?: string | null
  city?: string | null
  district?: string | null
  detail_address: string
  full_address: string
  postal_code?: string | null
  is_default: boolean
  address_type?: string | null
  created_at: string
  updated_at: string
}

/**
 * 购物车条目
 */
export interface Cart {
  id?: number
  user_id?: number | null
  session_id?: string | null
  product_id?: number | null
  bundle_id?: number | null
  quantity: number
  price: number
  created_at: string
  updated_at: string
}

/**
 * 抵扣券模板
 */
export interface CouponTemplate {
  id?: number
  name: string
  amount: number
  min_spend: number
  total?: number | null
  per_user: number
  valid_from?: string | null
  valid_to?: string | null
  scope: Record<string, unknown>
  register_gift: boolean
  status: string
  createdAt: string
  updatedAt: string
}

/**
 * 促销活动
 */
export interface Promotion {
  id?: number
  type: string
  name: string
  rules: Record<string, unknown>
  scope: Record<string, unknown>
  start_at?: string | null
  end_at?: string | null
  priority: number
  status: string
  createdAt: string
  updatedAt: string
}

/**
 * 组合套餐
 */
export interface Bundle {
  id?: number
  name: string
  name_th?: string | null
  description?: string | null
  price: number
  image?: string | null
  status: string
  createdAt: string
  updatedAt: string
}

/**
 * 合作方账号
 */
export interface Partner {
  id?: number
  login: string
  password: string
  display_name?: string | null
  account_kind: string
  discount_percent: number
  tier_discount_json?: string | null
  is_active: boolean
  last_login_at?: string | null
  token_version: number
  created_at: string
  updated_at: string
}

/**
 * 合作方（批发）订单
 */
export interface PartnerOrder {
  id?: number
  partner_id: number
  order_no: string
  currency_code: string
  total_amount_thb: number
  status: string
  notes?: string | null
  contact_name?: string | null
  contact_phone?: string | null
  delivery_address?: string | null
  partner_address_id?: number | null
  online_paid_at?: string | null
  client_order_key?: string | null
  created_at: string
  updated_at: string
}

/**
 * 异步导出任务
 */
export interface ExportJob {
  id?: number
  admin_id: number
  admin_username: string
  type: string
  status: string
  params?: Record<string, unknown> | null
  row_count?: number | null
  file_name?: string | null
  file_path?: string | null
  file_size?: number | null
  error_message?: string | null
  started_at?: string | null
  completed_at?: string | null
  created_at: string
  updated_at: string
}

/**
 * 系统配置项
 */
export interface SystemConfig {
  id?: number
  config_key: string
  config_value?: string | null
  config_type: "text" | "image" | "json" | "boolean"
  description?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * 新建/编辑商品的请求体
 */
export interface ProductCreateRequest {
  name: string
  name_th?: string
  description?: string
  category_id?: number
  price: number
  points?: number
  discount?: number
  stock?: number
  image?: string
  status?: "active" | "inactive"
}

/**
 * 批量操作商品的请求体
 */
export interface ProductBulkRequest {
  ids: number[]
  action: "activate" | "deactivate" | "delete"
}

/**
 * 改订单状态的请求体
 */
export interface OrderStatusRequest {
  status: "pending" | "paid" | "shipping" | "shipped" | "delivered" | "completed" | "cancelled"
  tracking_number?: string
  admin_note?: string
}

/**
 * 批量改订单状态的请求体
 */
export interface OrderBulkStatusRequest {
  ids: number[]
  status: "pending" | "paid" | "shipping" | "shipped" | "delivered" | "completed" | "cancelled"
  tracking_number?: string
  admin_note?: string
}

/**
 * 加入购物车的请求体
 */
export interface CartAddRequest {
  product_id: number
  quantity: number
}

/**
 * 统一响应信封（所有接口都返回这个形状）
 * @template T 数据类型
 */
export interface ApiEnvelope<T = unknown> {
  success: boolean
  message: string
  code?: string
  data?: T
}
