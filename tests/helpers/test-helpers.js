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
