import Address from '../models/Address.js'

/**
 * 创建用户地址（统一逻辑，可复用）
 *
 * @param {Object} params - 地址创建参数
 * @param {number} params.userId - 用户ID
 * @param {string} params.contact_name - 收货人姓名
 * @param {string} [params.contact_country_code='+86'] - 国家区号（+86/+66/+60）
 * @param {string} params.contact_phone - 手机号（不含国家区号）
 * @param {string} [params.province] - 省份
 * @param {string} [params.city] - 城市
 * @param {string} [params.district] - 区县
 * @param {string} params.detail_address - 详细地址
 * @param {string} [params.postal_code] - 邮政编码
 * @param {boolean} [params.is_default=false] - 是否默认地址
 * @param {string} [params.address_type='home'] - 地址类型
 * @param {import('sequelize').Transaction} transaction - 事务
 */
export async function createUserAddress(params, transaction) {
  const {
    userId,
    contact_name,
    contact_country_code = '+86',
    contact_phone,
    province = '',
    city = '',
    district = '',
    detail_address,
    postal_code = '',
    is_default = false,
    address_type = 'home'
  } = params

  if (!userId) {
    throw new Error('用户未登录')
  }

  // 基本必填校验
  if (!contact_name || !contact_phone || !detail_address) {
    throw new Error('收货人姓名、电话和详细地址为必填项')
  }

  // 国家区号校验
  const supportedCountries = ['+86', '+66', '+60']
  if (!supportedCountries.includes(contact_country_code)) {
    throw new Error('不支持的国家区号')
  }

  // 手机号格式和长度校验
  const phoneRegex = /^[1-9]\d+$/
  if (!phoneRegex.test(contact_phone)) {
    throw new Error('手机号必须为纯数字且不能以0开头')
  }

  let minLength
  let countryName
  switch (contact_country_code) {
    case '+86':
      minLength = 11
      countryName = '中国'
      break
    case '+60':
      minLength = 9
      countryName = '马来西亚'
      break
    case '+66':
      minLength = 9
      countryName = '泰国'
      break
    default:
      throw new Error('不支持的国家区号')
  }

  if (contact_phone.length < minLength) {
    throw new Error(`${countryName}手机号必须不少于${minLength}位数字`)
  }

  // 计算完整地址
  const addressParts = [province, city, district].filter(Boolean)
  const regionPart = addressParts.join(' ')
  const full_address = regionPart ? `${regionPart} ${detail_address}` : detail_address

  // 如需设为默认，先清理旧的默认地址
  if (is_default) {
    await Address.update(
      { is_default: false },
      {
        where: { user_id: userId, is_default: true },
        transaction
      }
    )
  }

  // 创建地址
  const address = await Address.create(
    {
      user_id: userId,
      contact_name,
      contact_country_code,
      contact_phone,
      province,
      city,
      district,
      detail_address,
      full_address,
      postal_code,
      is_default,
      address_type
    },
    { transaction }
  )

  return address
}


