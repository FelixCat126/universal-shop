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

  // 商品分类工厂
  static createProductCategory(overrides = {}) {
    const defaultData = {
      name: `Cat-${faker.string.alphanumeric(6)}`,
      sort_order: faker.number.int({ min: 0, max: 99 })
    }
    return { ...defaultData, ...overrides }
  }

  // 行政区划工厂（默认生成省级）
  static createAdministrativeRegion(overrides = {}) {
    const defaultData = {
      country_code: 'TH',
      parent_id: null,
      level: 1,
      name_local: `จ.${faker.location.city()}`,
      name_alias: faker.location.city(),
      postal_code: null,
      sort_order: 0,
      is_active: 1
    }
    return { ...defaultData, ...overrides }
  }

  // 合作方工厂
  static createPartner(overrides = {}) {
    const ts = Date.now()
    const rand = Math.floor(Math.random() * 1000)
    const defaultData = {
      login: `ptn${ts}${rand}`,
      password: 'Abcd1234',
      display_name: `Partner-${faker.company.name()}`,
      account_kind: 'dealer',
      discount_percent: 10,
      is_active: true
    }
    return { ...defaultData, ...overrides }
  }

  // 合作方地址工厂
  static createPartnerAddress(partnerId, overrides = {}) {
    const defaultData = {
      partner_id: partnerId,
      recipient_name: faker.person.fullName(),
      phone: '900000000',
      phone_country_code: '+66',
      province: 'Bangkok',
      city: 'Bangkok',
      district: 'Pathum Wan',
      postal_code: '10330',
      detail: faker.location.streetAddress(),
      label: '默认仓',
      is_default: false
    }
    return { ...defaultData, ...overrides }
  }

  // 合作方订单工厂
  static createPartnerOrder(partnerId, overrides = {}) {
    const ts = Date.now()
    const defaultData = {
      partner_id: partnerId,
      order_no: `PARTNER${ts}${Math.floor(Math.random() * 1000)}`,
      currency_code: 'THB',
      total_amount_thb: 0,
      status: 'submitted',
      contact_name: faker.person.fullName(),
      contact_phone: '900000000',
      delivery_address: faker.location.streetAddress()
    }
    return { ...defaultData, ...overrides }
  }

  // 合作方订单明细工厂
  static createPartnerOrderItem(partnerOrderId, productId, overrides = {}) {
    const baseUnit = parseFloat(faker.commerce.price({ min: 50, max: 500 }))
    const qty = faker.number.int({ min: 1, max: 5 })
    const partnerDiscount = 10
    const unit = parseFloat((baseUnit * (1 - partnerDiscount / 100)).toFixed(2))
    const defaultData = {
      partner_order_id: partnerOrderId,
      product_id: productId,
      quantity: qty,
      base_unit_thb: baseUnit,
      unit_price_thb: unit,
      line_total_thb: parseFloat((unit * qty).toFixed(2)),
      partner_discount_percent_snapshot: partnerDiscount,
      product_name_snapshot: faker.commerce.productName(),
      product_image_snapshot: null
    }
    return { ...defaultData, ...overrides }
  }

  // 用户积分余额工厂
  static createUserPointBalance(userId, overrides = {}) {
    const defaultData = {
      user_id: userId,
      balance: 0
    }
    return { ...defaultData, ...overrides }
  }

  // 积分流水工厂
  static createPointTransaction(userId, overrides = {}) {
    const defaultData = {
      user_id: userId,
      order_id: null,
      type: 'earn_purchase',
      delta: 1,
      balance_after: 1,
      note: 'test'
    }
    return { ...defaultData, ...overrides }
  }

  // AuditLog 工厂
  static createAuditLog(overrides = {}) {
    const defaultData = {
      actor_type: 'user',
      actor_id: null,
      actor_label: null,
      event: 'test.event',
      resource: null,
      resource_id: null,
      success: true,
      detail: null,
      ip_address: null,
      user_agent: null
    }
    return { ...defaultData, ...overrides }
  }

  // OperationLog 工厂
  static createOperationLog(adminId, adminUsername, overrides = {}) {
    const defaultData = {
      admin_id: adminId,
      admin_username: adminUsername,
      action: 'test_action',
      resource: 'test',
      resource_id: null,
      description: 'test operation',
      old_data: null,
      new_data: null,
      ip_address: null,
      user_agent: null
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
