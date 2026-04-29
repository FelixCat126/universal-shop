import { faker } from '@faker-js/faker'
import bcrypt from 'bcrypt'

export class TestDataFactory {
  // 用户数据工厂
  static async createUser(overrides = {}) {
    const timestamp = Date.now()
    const randomSuffix = Math.floor(Math.random() * 1000)
    
    const defaultData = {
      username: faker.internet.email(),
      nickname: faker.person.firstName(),
      country_code: '+66',
      phone: `8${(timestamp % 100000000).toString().padStart(8, '0')}`,
      email: `test${timestamp}${randomSuffix}@example.com`,
      password: 'Abcd1234', // 原始密码，将在模型中自动加密（须符合门户密码复杂度）
      is_active: true,
      referral_code: faker.string.alphanumeric(8).toUpperCase(),
      referral_from: null
    }
    
    return { ...defaultData, ...overrides }
  }
  
  // 管理员数据工厂
  static async createAdmin(overrides = {}) {
    const timestamp = Date.now()
    
    const defaultData = {
      username: `testadmin${timestamp}`,
      email: `admin${timestamp}@test.com`,
      password: 'Abcd1234', // 原始密码，将在模型中自动加密（须符合门户密码复杂度）
      role: 'admin',
      is_active: true,
      real_name: faker.person.fullName(),
      phone: `139001390${(timestamp % 100).toString().padStart(2, '0')}`
    }
    
    return { ...defaultData, ...overrides }
  }
  
  // 商品数据工厂
  static createProduct(overrides = {}) {
    const defaultData = {
      name: faker.commerce.productName(),
      name_th: faker.commerce.productName() + ' (TH)',
      alias: faker.lorem.slug(),
      description: faker.commerce.productDescription(),
      category: faker.commerce.department(),
      price: parseFloat(faker.commerce.price({ min: 10, max: 1000 })),
      stock: faker.number.int({ min: 0, max: 100 }),
      discount: faker.datatype.boolean() ? faker.number.int({ min: 5, max: 50 }) : null,
      status: 'active',
      image: null
    }
    
    return { ...defaultData, ...overrides }
  }
  
  // 订单数据工厂
  static createOrder(userId, overrides = {}) {
    const timestamp = Date.now()
    
    const defaultData = {
      user_id: userId,
      order_no: `TEST${timestamp}`,
      contact_name: faker.person.fullName(),
      contact_phone: '13800138001',
      delivery_address: faker.location.streetAddress(),
      province: '北京市',
      city: '北京市',
      district: '朝阳区',
      postal_code: '100000',
      status: 'pending',
      total_amount: parseFloat(faker.commerce.price({ min: 50, max: 500 })),
      exchange_rate: 1.0,
      notes: null
    }
    
    return { ...defaultData, ...overrides }
  }
  
  // 订单项数据工厂
  static createOrderItem(orderId, productId, overrides = {}) {
    const quantity = faker.number.int({ min: 1, max: 5 })
    const price = parseFloat(faker.commerce.price({ min: 10, max: 100 }))
    
    const defaultData = {
      order_id: orderId,
      product_id: productId,
      quantity: quantity,
      price: price,
      original_price: price,
      discount: null,
      product_name_zh: faker.commerce.productName(),
      product_name_th: null
    }
    
    return { ...defaultData, ...overrides }
  }
  
  // 地址数据工厂
  static createAddress(userId, overrides = {}) {
    const province = '北京市'
    const city = '北京市'
    const district = '朝阳区'
    const detail = faker.location.streetAddress()
    const postal = '100000'
    
    const defaultData = {
      user_id: userId,
      province: province,
      city: city,
      district: district,
      detail_address: detail,
      postal_code: postal,
      full_address: `${province} ${city} ${district} ${detail}`,
      contact_name: faker.person.fullName(),
      contact_phone: '13800138001',
      is_default: false
    }
    
    return { ...defaultData, ...overrides }
  }
  
  // 购物车数据工厂
  static createCart(userId, productId, overrides = {}) {
    const defaultData = {
      user_id: userId,
      product_id: productId,
      quantity: faker.number.int({ min: 1, max: 10 })
    }
    
    return { ...defaultData, ...overrides }
  }
  
  // 系统配置数据工厂
  static createSystemConfig(overrides = {}) {
    const configKey = faker.lorem.word()
    
    const defaultData = {
      config_key: configKey,
      config_value: faker.lorem.sentence(),
      config_type: 'text',
      description: `Test config for ${configKey}`,
      is_public: false
    }
    
    return { ...defaultData, ...overrides }
  }
  
  // 生成多个实体的便捷方法
  static async createMultipleUsers(count = 3, overrides = {}) {
    const users = []
    for (let i = 0; i < count; i++) {
      const userData = await this.createUser({
        ...overrides,
        phone: `138001380${(Date.now() + i) % 100}`.slice(0, 11)
      })
      users.push(userData)
    }
    return users
  }
  
  static createMultipleProducts(count = 5, overrides = {}) {
    const products = []
    for (let i = 0; i < count; i++) {
      const productData = this.createProduct(overrides)
      products.push(productData)
    }
    return products
  }
  
  // 设置中文本地化
  static setChineseLocale() {
    faker.locale = 'zh_CN'
  }
  
  // 重置为默认本地化
  static resetLocale() {
    faker.locale = 'en'
  }
}
