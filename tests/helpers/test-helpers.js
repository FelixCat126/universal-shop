import jwt from 'jsonwebtoken'
import { TestDataFactory } from '../factories/index.js'
import { TestDatabase } from '../setup/test-database.js'

export class TestHelpers {
  // 生成JWT Token
  static generateToken(user, expiresIn = '1h') {
    return jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn }
    )
  }
  
  // 生成管理员JWT Token
  static generateAdminToken(admin, expiresIn = '8h') {
    return jwt.sign(
      { 
        adminId: admin.id, 
        username: admin.username, 
        role: admin.role,
        type: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn }
    )
  }

  // 生成合作方 JWT Token（payload 与 partnerAuthMiddleware 一致：type=partner, partnerId）
  static generatePartnerToken(partner, expiresIn = '8h') {
    return jwt.sign(
      {
        partnerId: partner.id,
        login: partner.login,
        type: 'partner'
      },
      process.env.JWT_SECRET,
      { expiresIn }
    )
  }
  
  // 创建完整的用户（包含地址）
  static async createUserWithAddress(userOverrides = {}, addressOverrides = {}) {
    const sequelize = TestDatabase.getSequelize()
    const { User, Address } = sequelize.models
    
    const userData = await TestDataFactory.createUser(userOverrides)
    const user = await User.create(userData)
    
    const addressData = TestDataFactory.createAddress(user.id, addressOverrides)
    const address = await Address.create(addressData)
    
    return { user, address }
  }
  
  // 创建完整的订单（包含商品和订单项）
  static async createOrderWithItems(userOverrides = {}, productCount = 2) {
    const sequelize = TestDatabase.getSequelize()
    const { User, Product, Order, OrderItem } = sequelize.models
    
    // 创建用户
    const userData = await TestDataFactory.createUser(userOverrides)
    const user = await User.create(userData)
    
    // 创建商品
    const products = []
    for (let i = 0; i < productCount; i++) {
      const productData = TestDataFactory.createProduct({ stock: 50 })
      const product = await Product.create(productData)
      products.push(product)
    }
    
    // 创建订单
    let totalAmount = 0
    const orderData = TestDataFactory.createOrder(user.id)
    const order = await Order.create(orderData)
    
    // 创建订单项
    const orderItems = []
    for (const product of products) {
      const quantity = Math.floor(Math.random() * 3) + 1
      const price = product.price
      totalAmount += price * quantity
      
      const orderItemData = TestDataFactory.createOrderItem(order.id, product.id, {
        quantity,
        price,
        original_price: product.price,
        product_name_zh: product.name
      })
      
      const orderItem = await OrderItem.create(orderItemData)
      orderItems.push(orderItem)
    }
    
    // 更新订单总金额
    await order.update({ total_amount: totalAmount })
    
    return { user, products, order, orderItems }
  }
  
  // 创建管理员
  static async createAdminUser(overrides = {}) {
    const sequelize = TestDatabase.getSequelize()
    const { Administrator } = sequelize.models
    
    const adminData = await TestDataFactory.createAdmin(overrides)
    const admin = await Administrator.create(adminData)
    
    return admin
  }

  // 创建合作方 + 默认地址 + token
  static async createPartnerWithAddress(partnerOverrides = {}, addressOverrides = {}) {
    const sequelize = TestDatabase.getSequelize()
    const { Partner, PartnerAddress } = sequelize.models

    const partnerData = TestDataFactory.createPartner(partnerOverrides)
    const partner = await Partner.create(partnerData)

    const addressData = TestDataFactory.createPartnerAddress(partner.id, {
      is_default: true,
      ...addressOverrides
    })
    const address = await PartnerAddress.create(addressData)

    const token = TestHelpers.generatePartnerToken(partner)
    return { partner, address, token }
  }

  // 创建商品分类 + N 个挂在该分类下的商品（默认 active 库存 100）
  static async createCategoryWithProducts({
    count = 1,
    categoryName,
    productOverrides = {}
  } = {}) {
    const sequelize = TestDatabase.getSequelize()
    const { ProductCategory, Product } = sequelize.models

    const category = await ProductCategory.create(
      TestDataFactory.createProductCategory(categoryName ? { name: categoryName } : {})
    )

    const products = []
    for (let i = 0; i < count; i++) {
      const productData = TestDataFactory.createProduct({
        stock: 100,
        status: 'active',
        category_id: category.id,
        ...productOverrides
      })
      products.push(await Product.create(productData))
    }
    return { category, products }
  }

  // 给用户充值积分（直接落库，绕过业务流程）
  static async topUpUserPoints(user, amount) {
    const sequelize = TestDatabase.getSequelize()
    const { UserPointBalance, PointTransaction } = sequelize.models

    const [bal, created] = await UserPointBalance.findOrCreate({
      where: { user_id: user.id },
      defaults: { user_id: user.id, balance: 0 }
    })
    const next = Number(bal.balance) + Number(amount)
    await bal.update({ balance: next })

    await PointTransaction.create({
      user_id: user.id,
      order_id: null,
      type: 'earn_purchase',
      delta: amount,
      balance_after: next,
      note: 'test top-up'
    })
    return next
  }

  // 写入指定汇率/币种的 SystemConfig（覆盖式）。默认 THB:1, USD:0.029, CNY:0.20, MYR:0.13
  static async createCurrenciesConfig(overrides = {}) {
    const sequelize = TestDatabase.getSequelize()
    const { SystemConfig } = sequelize.models

    const rates = {
      USD: '0.03',
      CNY: '0.20',
      MYR: '0.13',
      ...overrides
    }
    await SystemConfig.setConfig(
      'exchange_rates',
      rates,
      'json',
      '测试默认汇率'
    )
    await SystemConfig.setConfig('exchange_rate', rates.USD, 'text', '兼容字段')
    await SystemConfig.setConfig('currency_unit', 'THB', 'text', '默认币种')
    return rates
  }
  
  // 等待异步操作完成
  static async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  
  // 断言对象包含预期属性
  static expectObjectContains(actual, expected) {
    for (const [key, value] of Object.entries(expected)) {
      if (actual[key] !== value) {
        throw new Error(`Expected ${key} to be ${value}, but got ${actual[key]}`)
      }
    }
  }
  
  // 断言数组包含预期长度
  static expectArrayLength(array, expectedLength) {
    if (array.length !== expectedLength) {
      throw new Error(`Expected array length to be ${expectedLength}, but got ${array.length}`)
    }
  }
  
  // 生成随机手机号
  static generatePhoneNumber(countryCode = '+86') {
    const timestamp = Date.now()
    switch (countryCode) {
      case '+86':
        return `138${(timestamp % 100000000).toString().padStart(8, '0')}`
      case '+66':
        return `66${(timestamp % 1000000000).toString().padStart(9, '0')}`
      case '+60':
        return `1${(timestamp % 100000000).toString().padStart(8, '0')}`
      default:
        return `138${(timestamp % 100000000).toString().padStart(8, '0')}`
    }
  }
  
  // 生成随机邮箱
  static generateEmail() {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 1000)
    return `test${timestamp}${random}@example.com`
  }
}
