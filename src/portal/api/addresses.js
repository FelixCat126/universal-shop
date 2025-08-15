import api from './index.js'

// 获取用户地址列表
export const getAddresses = () => {
  return api.get('/addresses')
}

// 别名导出（保持向后兼容）
export const getUserAddresses = getAddresses

// 创建新地址
export const createAddress = (addressData) => {
  return api.post('/addresses', addressData)
}

// 别名导出（保持向后兼容）
export const addAddress = createAddress

// 获取地址详情
export const getAddressDetail = (addressId) => {
  return api.get(`/addresses/${addressId}`)
}

// 更新地址
export const updateAddress = (addressId, addressData) => {
  return api.put(`/addresses/${addressId}`, addressData)
}

// 设置默认地址
export const setDefaultAddress = (addressId) => {
  return api.put(`/addresses/${addressId}/default`)
}

// 删除地址
export const deleteAddress = (addressId) => {
  return api.delete(`/addresses/${addressId}`)
}

export default {
  getUserAddresses,
  createAddress,
  getAddressDetail,
  updateAddress,
  setDefaultAddress,
  deleteAddress
}