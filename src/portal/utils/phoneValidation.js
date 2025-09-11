// 国家配置信息
export const COUNTRIES = {
  '+86': {
    name: '中国',
    flag: '🇨🇳',
    phoneLength: 11,
    pattern: /^1[3-9]\d{9}$/
  },
  '+66': {
    name: '泰国', 
    flag: '🇹🇭',
    phoneLength: 9,
    pattern: /^[2-9]\d{8}$/
  },
  '+60': {
    name: '马来西亚',
    flag: '🇲🇾', 
    phoneLength: 11,
    pattern: /^1[0-9]\d{8,9}$/
  }
}

/**
 * 验证手机号格式
 * @param {string} phone - 手机号（不包含区号）
 * @param {string} countryCode - 国家区号
 * @returns {Object} 验证结果 { isValid: boolean, message: string }
 */
export function validatePhone(phone, countryCode) {
  // 检查参数
  if (!phone || !countryCode) {
    return {
      isValid: false,
      message: '手机号和国家区号不能为空'
    }
  }

  // 获取国家配置
  const country = COUNTRIES[countryCode]
  if (!country) {
    return {
      isValid: false,
      message: '不支持的国家区号'
    }
  }

  // 去除空格和特殊字符
  const cleanPhone = phone.replace(/[\s-]/g, '')

  // 基本格式验证：必须是纯数字
  if (!/^\d+$/.test(cleanPhone)) {
    return {
      isValid: false,
      message: '手机号只能包含数字'
    }
  }

  // 长度验证
  if (cleanPhone.length !== country.phoneLength) {
    return {
      isValid: false,
      message: `${country.name}手机号必须为${country.phoneLength}位数字`
    }
  }

  // 格式模式验证
  if (!country.pattern.test(cleanPhone)) {
    let message
    switch (countryCode) {
      case '+86':
        message = '中国手机号必须以1开头，第二位为3-9'
        break
      case '+66':
        message = '泰国手机号必须以2-9开头'
        break
      case '+60':
        message = '马来西亚手机号必须以1开头'
        break
      default:
        message = '手机号格式不正确'
    }
    return {
      isValid: false,
      message
    }
  }

  return {
    isValid: true,
    message: ''
  }
}

/**
 * 格式化手机号显示（添加区号）
 * @param {string} phone - 手机号
 * @param {string} countryCode - 国家区号
 * @returns {string} 格式化后的手机号
 */
export function formatPhoneDisplay(phone, countryCode) {
  if (!phone || !countryCode) return ''
  return `${countryCode} ${phone}`
}

/**
 * 获取国家信息
 * @param {string} countryCode - 国家区号
 * @returns {Object|null} 国家信息
 */
export function getCountryInfo(countryCode) {
  return COUNTRIES[countryCode] || null
}

/**
 * 获取所有支持的国家列表
 * @returns {Array} 国家列表
 */
export function getSupportedCountries() {
  return Object.entries(COUNTRIES).map(([code, info]) => ({
    code,
    ...info
  }))
}

/**
 * 检查两个手机号是否相同（包含区号）
 * @param {string} phone1 - 手机号1
 * @param {string} countryCode1 - 国家区号1
 * @param {string} phone2 - 手机号2
 * @param {string} countryCode2 - 国家区号2
 * @returns {boolean} 是否相同
 */
export function isSamePhone(phone1, countryCode1, phone2, countryCode2) {
  return countryCode1 === countryCode2 && phone1 === phone2
}

/**
 * 生成手机号的唯一标识
 * @param {string} phone - 手机号
 * @param {string} countryCode - 国家区号
 * @returns {string} 唯一标识
 */
export function generatePhoneId(phone, countryCode) {
  return `${countryCode}:${phone}`
}
