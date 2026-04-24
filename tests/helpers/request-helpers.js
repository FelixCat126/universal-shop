/**
 * 测试辅助工具 - 创建标准化的请求和响应对象
 */
import { vi } from 'vitest'

/**
 * 创建标准化的req对象（带认证用户）
 */
export function createAuthenticatedRequest(user, overrides = {}) {
  return {
    user: {
      id: user.id,
      phone: user.phone,
      nickname: user.nickname,
      country_code: user.country_code || '+66',
      email: user.email,
      referral_code: user.referral_code
    },
    body: {},
    query: {},
    params: {},
    ...overrides
  }
}

/**
 * 创建标准化的res对象
 */
export function createMockResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis()
  }
}

/**
 * 创建标准化的管理员req对象
 */
export function createAdminRequest(admin, overrides = {}) {
  return {
    admin: {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      is_active: admin.is_active
    },
    body: {},
    query: {},
    params: {},
    ...overrides
  }
}

/**
 * 创建未认证的req对象
 */
export function createUnauthenticatedRequest(overrides = {}) {
  return {
    body: {},
    query: {},
    params: {},
    ...overrides
  }
}

/**
 * 验证响应结构
 */
export function expectSuccessResponse(res, statusCode = 200) {
  expect(res.status).toHaveBeenCalledWith(statusCode)
  const callArgs = res.json.mock.calls[0]
  if (callArgs && callArgs[0]) {
    expect(callArgs[0]).toHaveProperty('success', true)
  }
  return callArgs?.[0]
}

/**
 * 验证错误响应结构
 */
export function expectErrorResponse(res, statusCode) {
  expect(res.status).toHaveBeenCalledWith(statusCode)
  const callArgs = res.json.mock.calls[0]
  if (callArgs && callArgs[0]) {
    expect(callArgs[0]).toHaveProperty('success', false)
  }
  return callArgs?.[0]
}


