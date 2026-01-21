import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@server/app.js'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import { TestHelpers } from '../helpers/test-helpers.js'

describe('管理员 API', () => {
  let sequelize
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
  })
  
  describe('POST /api/admin/login - 管理员登录', () => {
    let testAdmin
    
    beforeEach(async () => {
      const { Administrator } = sequelize.models
      const adminData = await TestDataFactory.createAdmin()
      testAdmin = await Administrator.create(adminData)
    })
    
    it('应该成功登录管理员', async () => {
      const response = await request(app)
        .post('/api/admin/login')
        .send({
          username: testAdmin.username,
          password: '123456'
        })
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.token).toBeDefined()
      expect(response.body.data.admin.id).toBe(testAdmin.id)
      expect(response.body.data.admin.username).toBe(testAdmin.username)
      expect(response.body.data.admin.password).toBeUndefined() // 密码不应该返回
    })
    
    it('应该拒绝错误的用户名', async () => {
      const response = await request(app)
        .post('/api/admin/login')
        .send({
          username: 'wrongusername',
          password: '123456'
        })
        .expect(401)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('用户名或密码错误')
    })
    
    it('应该拒绝错误的密码', async () => {
      const response = await request(app)
        .post('/api/admin/login')
        .send({
          username: testAdmin.username,
          password: 'wrongpassword'
        })
        .expect(401)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('用户名或密码错误')
    })
    
    it('应该拒绝被禁用的管理员', async () => {
      await testAdmin.update({ is_active: false })
      
      const response = await request(app)
        .post('/api/admin/login')
        .send({
          username: testAdmin.username,
          password: '123456'
        })
        .expect(403)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('账户已被禁用')
    })
    
    it('应该验证必填字段', async () => {
      const response = await request(app)
        .post('/api/admin/login')
        .send({
          username: testAdmin.username
          // 缺少密码
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('必填')
    })
  })
  
  describe('POST /api/admin/init - 初始化超级管理员', () => {
    it('应该成功创建初始超级管理员', async () => {
      const adminData = {
        username: 'superadmin',
        email: 'admin@example.com',
        password: 'admin123456',
        real_name: '超级管理员',
        phone: '13800138000'
      }
      
      const response = await request(app)
        .post('/api/admin/init')
        .send(adminData)
        .expect(201)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.admin.username).toBe(adminData.username)
      expect(response.body.data.admin.role).toBe('super_admin')
      expect(response.body.data.token).toBeDefined()
      
      // 验证数据库中的记录
      const { Administrator } = sequelize.models
      const admin = await Administrator.findOne({ where: { username: adminData.username } })
      expect(admin).toBeTruthy()
      expect(admin.role).toBe('super_admin')
    })
    
    it('应该拒绝在已有管理员时创建初始管理员', async () => {
      // 先创建一个管理员
      const { Administrator } = sequelize.models
      const existingAdminData = await TestDataFactory.createAdmin()
      await Administrator.create(existingAdminData)
      
      const adminData = {
        username: 'newadmin',
        email: 'newadmin@example.com',
        password: 'admin123456',
        real_name: '新管理员',
        phone: '13800138001'
      }
      
      const response = await request(app)
        .post('/api/admin/init')
        .send(adminData)
        .expect(403)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('已存在管理员')
    })
    
    it('应该验证初始管理员数据格式', async () => {
      const response = await request(app)
        .post('/api/admin/init')
        .send({
          username: 'admin',
          email: 'invalid-email', // 无效邮箱
          password: '123' // 密码太短
        })
        .expect(400)
      
      expect(response.body.success).toBe(false)
    })
  })
  
  describe('GET /api/admin/validate-token - 验证管理员Token', () => {
    let testAdmin, adminToken
    
    beforeEach(async () => {
      const { Administrator } = sequelize.models
      const adminData = await TestDataFactory.createAdmin()
      testAdmin = await Administrator.create(adminData)
      adminToken = TestHelpers.generateAdminToken(testAdmin)
    })
    
    it('应该验证有效的管理员token', async () => {
      const response = await request(app)
        .get('/api/admin/validate-token')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.admin.id).toBe(testAdmin.id)
    })
    
    it('应该拒绝无效的token', async () => {
      const response = await request(app)
        .get('/api/admin/validate-token')
        .set('Authorization', 'Bearer invalidtoken')
        .expect(403)
      
      expect(response.body.success).toBe(false)
    })
    
    it('应该拒绝缺少token的请求', async () => {
      const response = await request(app)
        .get('/api/admin/validate-token')
        .expect(401)
      
      expect(response.body.success).toBe(false)
    })
  })
  
  describe('GET /api/admin/orders - 管理员获取订单列表', () => {
    let testAdmin, adminToken, testOrders
    
    beforeEach(async () => {
      const { Administrator, User, Order } = sequelize.models
      
      // 创建管理员
      const adminData = await TestDataFactory.createAdmin({ permissions: ['orders'] })
      testAdmin = await Administrator.create(adminData)
      adminToken = TestHelpers.generateAdminToken(testAdmin)
      
      // 创建测试订单
      testOrders = []
      for (let i = 0; i < 5; i++) {
        const userData = await TestDataFactory.createUser({
          phone: `138001380${i.toString().padStart(2, '0')}`,
          email: `user${i}@example.com`
        })
        const user = await User.create(userData)
        
        const orderData = TestDataFactory.createOrder(user.id, {
          order_no: `ADMIN${Date.now()}-${i}`,
          status: i % 2 === 0 ? 'pending' : 'confirmed'
        })
        const order = await Order.create(orderData)
        testOrders.push(order)
      }
    })
    
    it('应该返回所有订单（管理员视图）', async () => {
      const response = await request(app)
        .get('/api/admin/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.orders).toHaveLength(5)
      expect(response.body.data.pagination).toBeDefined()
    })
    
    it('应该支持按状态筛选', async () => {
      const response = await request(app)
        .get('/api/admin/orders?status=pending')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      response.body.data.orders.forEach(order => {
        expect(order.status).toBe('pending')
      })
    })
    
    it('应该支持分页', async () => {
      const response = await request(app)
        .get('/api/admin/orders?page=1&pageSize=2')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.orders.length).toBeLessThanOrEqual(2)
      expect(response.body.data.pagination.page).toBe(1)
      expect(response.body.data.pagination.pageSize).toBe(2)
    })
    
    it('应该包含用户信息', async () => {
      const response = await request(app)
        .get('/api/admin/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      response.body.data.orders.forEach(order => {
        expect(order.User).toBeDefined()
        expect(order.User.phone).toBeDefined()
      })
    })
    
    it('应该拒绝没有orders权限的管理员', async () => {
      // 创建没有orders权限的管理员
      const { Administrator } = sequelize.models
      const noPermissionAdminData = await TestDataFactory.createAdmin({ 
        permissions: ['users'], // 只有users权限，没有orders权限
        username: 'nopermadmin'
      })
      const noPermissionAdmin = await Administrator.create(noPermissionAdminData)
      const noPermissionToken = TestHelpers.generateAdminToken(noPermissionAdmin)
      
      const response = await request(app)
        .get('/api/admin/orders')
        .set('Authorization', `Bearer ${noPermissionToken}`)
        .expect(403)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('权限不足')
    })
  })
  
  describe('GET /api/admin/orders/:id - 管理员获取订单详情', () => {
    let testAdmin, adminToken, testOrder
    
    beforeEach(async () => {
      const { Administrator } = sequelize.models
      const adminData = await TestDataFactory.createAdmin({ permissions: ['orders'] })
      testAdmin = await Administrator.create(adminData)
      adminToken = TestHelpers.generateAdminToken(testAdmin)
      
      // 创建测试订单
      const { user, order } = await TestHelpers.createOrderWithItems()
      testOrder = order
    })
    
    it('应该返回订单详细信息', async () => {
      const response = await request(app)
        .get(`/api/admin/orders/${testOrder.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBe(testOrder.id)
      expect(response.body.data.User).toBeDefined()
      expect(response.body.data.OrderItems).toBeDefined()
    })
    
    it('应该返回404对于不存在的订单', async () => {
      const response = await request(app)
        .get('/api/admin/orders/99999')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('订单不存在')
    })
  })
  
  describe('PUT /api/admin/orders/:id/status - 更新订单状态', () => {
    let testAdmin, adminToken, testOrder
    
    beforeEach(async () => {
      const { Administrator } = sequelize.models
      const adminData = await TestDataFactory.createAdmin({ permissions: ['orders'] })
      testAdmin = await Administrator.create(adminData)
      adminToken = TestHelpers.generateAdminToken(testAdmin)
      
      // 创建测试订单
      const { user, order } = await TestHelpers.createOrderWithItems()
      testOrder = order
    })
    
    it('应该成功更新订单状态', async () => {
      const response = await request(app)
        .put(`/api/admin/orders/${testOrder.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200)
      
      expect(response.body.success).toBe(true)
      
      // 验证状态已更新
      await testOrder.reload()
      expect(testOrder.status).toBe('confirmed')
    })
    
    it('应该验证状态值', async () => {
      const response = await request(app)
        .put(`/api/admin/orders/${testOrder.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'invalid_status' })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('无效的订单状态')
    })
    
    it('应该记录操作日志', async () => {
      await request(app)
        .put(`/api/admin/orders/${testOrder.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200)
      
      // 检查操作日志
      const { OperationLog } = sequelize.models
      const log = await OperationLog.findOne({
        where: { 
          administrator_id: testAdmin.id,
          operation_type: 'update_order_status'
        }
      })
      expect(log).toBeTruthy()
      expect(log.target_type).toBe('order')
      expect(log.target_id).toBe(testOrder.id.toString())
    })
  })
  
  describe('GET /api/admin/users - 管理员获取用户列表', () => {
    let testAdmin, adminToken, testUsers
    
    beforeEach(async () => {
      const { Administrator, User } = sequelize.models
      
      // 创建管理员
      const adminData = await TestDataFactory.createAdmin({ permissions: ['users'] })
      testAdmin = await Administrator.create(adminData)
      adminToken = TestHelpers.generateAdminToken(testAdmin)
      
      // 创建测试用户
      testUsers = []
      for (let i = 0; i < 5; i++) {
        const userData = await TestDataFactory.createUser({
          phone: `139001390${i.toString().padStart(2, '0')}`,
          email: `testuser${i}@example.com`,
          is_active: i % 2 === 0 // 部分用户被禁用
        })
        const user = await User.create(userData)
        testUsers.push(user)
      }
    })
    
    it('应该返回所有用户列表', async () => {
      const response = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.users).toHaveLength(5)
      expect(response.body.data.pagination).toBeDefined()
    })
    
    it('应该支持按状态筛选', async () => {
      const response = await request(app)
        .get('/api/admin/users?is_active=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      response.body.data.users.forEach(user => {
        expect(user.is_active).toBe(true)
      })
    })
    
    it('应该支持搜索用户', async () => {
      const response = await request(app)
        .get('/api/admin/users?search=testuser0')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.users.length).toBeGreaterThan(0)
    })
    
    it('应该不返回敏感信息', async () => {
      const response = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      response.body.data.users.forEach(user => {
        expect(user.password).toBeUndefined()
      })
    })
  })
  
  describe('PUT /api/admin/users/:id/status - 更新用户状态', () => {
    let testAdmin, adminToken, testUser
    
    beforeEach(async () => {
      const { Administrator, User } = sequelize.models
      
      const adminData = await TestDataFactory.createAdmin({ permissions: ['users'] })
      testAdmin = await Administrator.create(adminData)
      adminToken = TestHelpers.generateAdminToken(testAdmin)
      
      const userData = await TestDataFactory.createUser()
      testUser = await User.create(userData)
    })
    
    it('应该成功更新用户状态', async () => {
      const response = await request(app)
        .put(`/api/admin/users/${testUser.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_active: false })
        .expect(200)
      
      expect(response.body.success).toBe(true)
      
      // 验证状态已更新
      await testUser.reload()
      expect(testUser.is_active).toBe(false)
    })
    
    it('应该记录操作日志', async () => {
      await request(app)
        .put(`/api/admin/users/${testUser.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_active: false })
        .expect(200)
      
      // 检查操作日志
      const { OperationLog } = sequelize.models
      const log = await OperationLog.findOne({
        where: { 
          administrator_id: testAdmin.id,
          operation_type: 'update_user_status'
        }
      })
      expect(log).toBeTruthy()
    })
  })
  
  describe('GET /api/admin/administrators - 管理员管理', () => {
    let superAdmin, superAdminToken
    
    beforeEach(async () => {
      const { Administrator } = sequelize.models
      const superAdminData = await TestDataFactory.createAdmin({ 
        role: 'super_admin',
        permissions: ['administrators']
      })
      superAdmin = await Administrator.create(superAdminData)
      superAdminToken = TestHelpers.generateAdminToken(superAdmin)
    })
    
    it('应该返回管理员列表', async () => {
      const response = await request(app)
        .get('/api/admin/administrators')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.administrators).toHaveLength(1)
      expect(response.body.data.administrators[0].password).toBeUndefined()
    })
    
    it('应该拒绝非管理员权限的用户', async () => {
      // 创建普通管理员
      const { Administrator } = sequelize.models
      const normalAdminData = await TestDataFactory.createAdmin({ 
        permissions: ['orders'], // 没有administrators权限
        username: 'normaladmin'
      })
      const normalAdmin = await Administrator.create(normalAdminData)
      const normalAdminToken = TestHelpers.generateAdminToken(normalAdmin)
      
      const response = await request(app)
        .get('/api/admin/administrators')
        .set('Authorization', `Bearer ${normalAdminToken}`)
        .expect(403)
      
      expect(response.body.success).toBe(false)
    })
  })
  
  describe('POST /api/admin/administrators - 创建管理员', () => {
    let superAdmin, superAdminToken
    
    beforeEach(async () => {
      const { Administrator } = sequelize.models
      const superAdminData = await TestDataFactory.createAdmin({ 
        role: 'super_admin',
        permissions: ['administrators']
      })
      superAdmin = await Administrator.create(superAdminData)
      superAdminToken = TestHelpers.generateAdminToken(superAdmin)
    })
    
    it('应该成功创建新管理员', async () => {
      const newAdminData = {
        username: 'newadmin',
        email: 'newadmin@example.com',
        password: 'admin123456',
        real_name: '新管理员',
        phone: '13900139001',
        role: 'admin',
        permissions: ['orders', 'users']
      }
      
      const response = await request(app)
        .post('/api/admin/administrators')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(newAdminData)
        .expect(201)
      
      expect(response.body.success).toBe(true)
      expect(response.body.data.username).toBe(newAdminData.username)
      expect(response.body.data.role).toBe(newAdminData.role)
      expect(response.body.data.password).toBeUndefined()
    })
    
    it('应该拒绝重复的用户名', async () => {
      const duplicateData = {
        username: superAdmin.username, // 重复用户名
        email: 'duplicate@example.com',
        password: 'admin123456',
        real_name: '重复管理员',
        phone: '13900139002'
      }
      
      const response = await request(app)
        .post('/api/admin/administrators')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(duplicateData)
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('用户名已存在')
    })
  })
  
  describe('管理员权限控制', () => {
    let testAdmin, adminToken
    
    beforeEach(async () => {
      const { Administrator } = sequelize.models
      // 创建只有orders权限的管理员
      const adminData = await TestDataFactory.createAdmin({ 
        permissions: ['orders']
      })
      testAdmin = await Administrator.create(adminData)
      adminToken = TestHelpers.generateAdminToken(testAdmin)
    })
    
    it('应该允许访问有权限的资源', async () => {
      const response = await request(app)
        .get('/api/admin/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
      
      expect(response.body.success).toBe(true)
    })
    
    it('应该拒绝访问无权限的资源', async () => {
      const response = await request(app)
        .get('/api/admin/users') // 需要users权限
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message).toContain('权限不足')
    })
  })
  
  describe('操作日志记录', () => {
    let testAdmin, adminToken
    
    beforeEach(async () => {
      const { Administrator } = sequelize.models
      const adminData = await TestDataFactory.createAdmin({ 
        permissions: ['orders', 'users']
      })
      testAdmin = await Administrator.create(adminData)
      adminToken = TestHelpers.generateAdminToken(testAdmin)
    })
    
    it('应该记录所有需要日志的操作', async () => {
      // 创建测试数据
      const { user, order } = await TestHelpers.createOrderWithItems()
      
      // 执行需要记录日志的操作
      await request(app)
        .put(`/api/admin/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200)
      
      // 检查日志是否记录
      const { OperationLog } = sequelize.models
      const logs = await OperationLog.findAll({
        where: { administrator_id: testAdmin.id }
      })
      
      expect(logs.length).toBeGreaterThan(0)
      expect(logs[0].operation_type).toBe('update_order_status')
      expect(logs[0].ip_address).toBeDefined()
    })
  })
})
