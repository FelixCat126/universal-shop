import Address from '../models/Address.js'
import User from '../models/User.js'

/**
 * 创建用户地址（统一逻辑，可复用）
 *
 * @param {Object} params - 地址创建参数
 * @param {number} params.userId - 用户ID
 * @param {string} params.contact_name - 收货人姓名
 * @param {string} [params.contact_country_code='+66'] - 国家区号（+86/+66/+60）
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
    contact_country_code = '+66',
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
    /**
     * 第 44 轮：**先锁用户行**再清默认地址。
     *
     * "设为默认"是两步：先把该用户**全部**默认清成 false，再把新的设成 true。
     * 两步之间没有锁的话，用户在另一台设备上的操作会交错：
     *   T1 清理全部 → T1 设 A → T2 清理全部（把 A 又清掉）→ T2 设 B
     * 结果可能是**两个默认地址**，或者**一个默认都没有**（结算页地址凭空变空）。
     *
     * 锁**用户行**而不是地址行：地址行之间没有父子关系，
     * 锁地址行挡不住"清理全部"那一步（它更新的是该用户的**所有**地址行）。
     *
     * 放在这个**共用函数**里，是因为有两条路径会走到这里：
     *   1. 地址控制器的"新增地址"（早就有 lockUserAddressScope 锁用户行 → 这里重复锁是幂等的）
     *   2. **游客下单时建默认地址**（订单事务内直接调这里）—— 原来**没有**用户行锁，
     *      正好能撞出"两个默认地址"。
     */
    await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE })
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


