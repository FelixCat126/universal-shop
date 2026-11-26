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
  line_total?: number | null
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
  terms_accepted_at?: string | null
  age_confirmed_at?: string | null
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
  must_reset_password: boolean
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
 * 管理员账号
 */
export interface Administrator {
  id?: number
  username: string
  email?: string | null
  role: "super_admin" | "admin" | "operator"
  real_name?: string | null
  phone?: string | null
  is_active: boolean
  last_login_at?: string | null
  token_version: number
  must_reset_password: boolean
  created_by?: number | null
  created_at: string
  updated_at: string
}

/**
 * 售后申请
 */
export interface AfterSale {
  id?: number
  order_id: number
  user_id: number
  type: "refund" | "return"
  reason: string
  status: "pending" | "approved" | "rejected" | "received"
  admin_note?: string | null
  created_at: string
  updated_at: string
}

/**
 * 管理员操作日志
 */
export interface OperationLog {
  id?: number
  admin_id: number
  admin_username: string
  action: string
  resource: string
  resource_id?: string | null
  description: string
  old_data?: Record<string, unknown> | null
  new_data?: Record<string, unknown> | null
  ip_address?: string | null
  user_agent?: string | null
  created_at: string
}

/**
 * 合作方收货地址
 */
export interface PartnerAddress {
  id?: number
  partner_id: number
  recipient_name: string
  phone: string
  phone_country_code: string
  province?: string | null
  city?: string | null
  district?: string | null
  postal_code?: string | null
  detail: string
  label?: string | null
  is_default: boolean
  created_at: string
  updated_at: string
}

/**
 * 合作方订单行
 */
export interface PartnerOrderItem {
  id?: number
  partner_order_id: number
  product_id: number
  quantity: number
  base_unit_thb: number
  unit_price_thb: number
  line_total_thb: number
  partner_discount_percent_snapshot: number
  product_name_snapshot?: string | null
  product_image_snapshot?: string | null
  created_at: string
  updated_at: string
}

/**
 * 合作方订单（含订单行）
 */
export interface PartnerOrderWithItems extends PartnerOrder {
  items?: PartnerOrderItem[]
}

/**
 * 积分流水
 */
export interface PointTransaction {
  id?: number
  user_id: number
  order_id?: number | null
  type: string
  delta: number
  balance_after: number
  note?: string | null
  created_at: string
}

/**
 * 用户持有的抵扣券
 */
export interface UserCoupon {
  id?: number
  template_id: number
  user_id: number
  code: string
  status: string
  used_by_order_id?: number | null
  expire_at?: string | null
  used_at?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * 用户积分余额
 */
export interface UserPointBalance {
  user_id?: number | null
  balance: number
  archived_delta: number
  created_at: string
  updated_at: string
}

/**
 * 积分全局概览
 */
export interface AdminPointOverview {
  totalUsers?: number
  totalBalance?: number
  totalGranted?: number
  totalConsumed?: number
  transactionCount?: number
}

/**
 * 用户积分余额行（含用户基础信息）
 */
export interface AdminPointBalanceItem {
  user_id?: number
  balance?: number
  archived_delta?: number
  updated_at?: string
  user?: {
    id?: number
    nickname?: string
    username?: string
    phone?: string
    country_code?: string
    email?: string
  } | null
}

/**
 * 手工发放/扣减积分请求体
 */
export interface AdminPointAdjustRequest {
  delta: number
  note?: string
}

/**
 * 手工调整积分结果
 */
export interface AdminPointAdjustResult {
  user_id?: number
  delta?: number
  balance_before?: number
  balance_after?: number
}

/**
 * 行政区划
 */
export interface AdministrativeRegion {
  id?: number
  country_code: string
  parent_id?: number | null
  level: number
  name_local: string
  name_alias: string
  postal_code?: string | null
  sort_order?: number
  is_active?: number
  created_at?: string
  updated_at?: string
}

/**
 * 用户注册请求体
 */
export interface UserRegisterRequest {
  nickname: string
  country_code?: "+86" | "+66" | "+60"
  phone: string
  email?: string
  password: string
  referral_code?: string
}

/**
 * 登录请求体（phone 需与 country_code 配对；也可只给 email）
 */
export interface UserLoginRequest {
  country_code?: "+86" | "+66" | "+60"
  phone?: string
  email?: string
  password: string
}

/**
 * 修改个人资料请求体
 */
export interface UserProfileRequest {
  nickname?: string
  email?: string
  avatar_url?: string
}

/**
 * 修改密码请求体
 */
export interface ChangePasswordRequest {
  old_password: string
  new_password: string
}

/**
 * 注销账号请求体（需校验密码）
 */
export interface DeleteAccountRequest {
  password: string
}

/**
 * 发起密码重置
 */
export interface ForgotPasswordRequest {
  email?: string
  phone?: string
  country_code?: "+86" | "+66" | "+60"
}

/**
 * 用重置令牌设置新密码
 */
export interface ResetPasswordRequest {
  token: string
  password: string
}

/**
 * 登录成功
 */
export interface AuthTokenEnvelope {
  success: boolean
  message: string
  code?: string
  data?: {
    token?: string
    user?: User
  }
}

/**
 * 个人中心指标
 */
export interface ProfileMetricsEnvelope {
  success: boolean
  message: string
  code?: string
  data?: {
    orderCount?: number
    totalSpent?: string
    couponCount?: number
    points?: number
  }
}

/**
 * 推荐码信息
 */
export interface ReferralInfoEnvelope {
  success: boolean
  message: string
  code?: string
  data?: {
    username?: string
    referral_code?: string
  }
}

/**
 * 手机号是否存在
 */
export interface PhoneExistsEnvelope {
  success: boolean
  message: string
  code?: string
  data?: {
    exists?: boolean
  }
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
  stock_prev?: number
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
