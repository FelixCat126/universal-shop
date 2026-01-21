#!/usr/bin/env node

/**
 * 性能测试脚本
 * 监控API响应时间、内存使用、数据库性能等关键指标
 */

import fs from 'fs'
import { performance } from 'perf_hooks'
import { execSync } from 'child_process'
import request from 'supertest'
import app from '../src/server/app.js'
import { TestDatabase } from '../tests/setup/test-database.js'
import { TestDataFactory } from '../tests/factories/index.js'
import { TestHelpers } from '../tests/helpers/test-helpers.js'

class PerformanceTest {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        memory: process.memoryUsage()
      },
      tests: [],
      summary: {
        totalTests: 0,
        averageResponseTime: 0,
        maxResponseTime: 0,
        minResponseTime: Infinity,
        memoryUsage: {
          initial: null,
          final: null,
          peak: null
        }
      }
    }
  }
  
  async runPerformanceTests() {
    console.log('⚡ 开始性能测试...')
    
    try {
      // 初始化测试环境
      await this.setupTestEnvironment()
      
      // 记录初始内存使用
      this.results.summary.memoryUsage.initial = process.memoryUsage()
      
      // 运行各种性能测试
      await this.testAPIPerformance()
      await this.testDatabasePerformance()
      await this.testConcurrentRequests()
      await this.testMemoryUsage()
      
      // 记录最终内存使用
      this.results.summary.memoryUsage.final = process.memoryUsage()
      
      // 计算摘要统计
      this.calculateSummary()
      
      // 生成报告
      this.generateReport()
      
      console.log('✅ 性能测试完成')
      
    } catch (error) {
      console.error('❌ 性能测试失败:', error.message)
      process.exit(1)
    }
  }
  
  async setupTestEnvironment() {
    console.log('🔧 设置测试环境...')
    
    // 设置环境变量
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_PATH = './database/performance-test.sqlite'
    process.env.JWT_SECRET = 'performance-test-jwt-secret-32-chars'
    
    // 初始化数据库
    await TestDatabase.initialize()
    await TestDatabase.syncModels()
    
    // 创建测试数据
    await this.createTestData()
  }
  
  async createTestData() {
    console.log('📊 创建测试数据...')
    
    const sequelize = TestDatabase.getSequelize()
    const { User, Product, Order } = sequelize.models
    
    // 创建100个用户
    for (let i = 0; i < 100; i++) {
      const userData = await TestDataFactory.createUser({
        phone: `138001380${i.toString().padStart(2, '0')}`,
        email: `perftest${i}@example.com`
      })
      await User.create(userData)
    }
    
    // 创建50个商品
    for (let i = 0; i < 50; i++) {
      const productData = TestDataFactory.createProduct({
        name: `性能测试商品${i}`,
        price: Math.random() * 1000,
        stock: 100
      })
      await Product.create(productData)
    }
    
    console.log('✅ 测试数据创建完成')
  }
  
  async testAPIPerformance() {
    console.log('🌐 测试API性能...')
    
    const apiTests = [
      { name: 'GET /api/products', method: 'get', path: '/api/products' },
      { name: 'GET /api/health', method: 'get', path: '/api/health' },
      { name: 'POST /api/users/register', method: 'post', path: '/api/users/register', data: this.getTestUserData() }
    ]
    
    for (const test of apiTests) {
      const start = performance.now()
      
      try {
        let req = request(app)[test.method](test.path)
        
        if (test.data) {
          req = req.send(test.data)
        }
        
        const response = await req
        const end = performance.now()
        const responseTime = end - start
        
        this.results.tests.push({
          name: test.name,
          type: 'api',
          responseTime,
          status: response.status,
          success: response.status < 400
        })
        
        console.log(`  ${test.name}: ${responseTime.toFixed(2)}ms`)
        
      } catch (error) {
        const end = performance.now()
        const responseTime = end - start
        
        this.results.tests.push({
          name: test.name,
          type: 'api',
          responseTime,
          status: 500,
          success: false,
          error: error.message
        })
        
        console.log(`  ${test.name}: ${responseTime.toFixed(2)}ms (错误)`)
      }
    }
  }
  
  async testDatabasePerformance() {
    console.log('🗄️ 测试数据库性能...')
    
    const sequelize = TestDatabase.getSequelize()
    const { User, Product, Order } = sequelize.models
    
    const dbTests = [
      {
        name: '查询所有用户',
        query: () => User.findAll({ limit: 100 })
      },
      {
        name: '复杂联表查询',
        query: () => Order.findAll({
          include: [
            { model: User, as: 'User' },
            { model: sequelize.models.OrderItem, as: 'OrderItems' }
          ],
          limit: 50
        })
      },
      {
        name: '条件查询商品',
        query: () => Product.findAll({
          where: {
            status: 'active',
            stock: { [sequelize.Sequelize.Op.gt]: 0 }
          },
          limit: 20
        })
      }
    ]
    
    for (const test of dbTests) {
      const start = performance.now()
      
      try {
        await test.query()
        const end = performance.now()
        const responseTime = end - start
        
        this.results.tests.push({
          name: test.name,
          type: 'database',
          responseTime,
          success: true
        })
        
        console.log(`  ${test.name}: ${responseTime.toFixed(2)}ms`)
        
      } catch (error) {
        const end = performance.now()
        const responseTime = end - start
        
        this.results.tests.push({
          name: test.name,
          type: 'database',
          responseTime,
          success: false,
          error: error.message
        })
        
        console.log(`  ${test.name}: ${responseTime.toFixed(2)}ms (错误)`)
      }
    }
  }
  
  async testConcurrentRequests() {
    console.log('🔀 测试并发请求性能...')
    
    const concurrentRequests = 20
    const start = performance.now()
    
    const promises = Array(concurrentRequests).fill().map(async (_, index) => {
      try {
        const response = await request(app)
          .get('/api/products')
        
        return {
          index,
          status: response.status,
          success: response.status === 200
        }
      } catch (error) {
        return {
          index,
          status: 500,
          success: false,
          error: error.message
        }
      }
    })
    
    const results = await Promise.all(promises)
    const end = performance.now()
    const totalTime = end - start
    const averageTime = totalTime / concurrentRequests
    
    const successCount = results.filter(r => r.success).length
    
    this.results.tests.push({
      name: `${concurrentRequests}个并发请求`,
      type: 'concurrent',
      responseTime: totalTime,
      averageResponseTime: averageTime,
      concurrentRequests,
      successCount,
      success: successCount === concurrentRequests
    })
    
    console.log(`  ${concurrentRequests}个并发请求: 总时间${totalTime.toFixed(2)}ms, 平均${averageTime.toFixed(2)}ms, 成功${successCount}/${concurrentRequests}`)
  }
  
  async testMemoryUsage() {
    console.log('💾 测试内存使用...')
    
    const initialMemory = process.memoryUsage()
    
    // 执行一些内存密集型操作
    const largeArray = []
    for (let i = 0; i < 10000; i++) {
      largeArray.push({
        id: i,
        data: 'a'.repeat(100),
        timestamp: new Date()
      })
    }
    
    const peakMemory = process.memoryUsage()
    
    // 清理内存
    largeArray.length = 0
    
    // 强制垃圾回收（如果可用）
    if (global.gc) {
      global.gc()
    }
    
    const finalMemory = process.memoryUsage()
    
    this.results.summary.memoryUsage.peak = peakMemory
    
    this.results.tests.push({
      name: '内存使用测试',
      type: 'memory',
      initialMemory: initialMemory.heapUsed,
      peakMemory: peakMemory.heapUsed,
      finalMemory: finalMemory.heapUsed,
      memoryIncrease: finalMemory.heapUsed - initialMemory.heapUsed,
      success: finalMemory.heapUsed < peakMemory.heapUsed * 1.1 // 内存释放合理
    })
    
    console.log(`  初始内存: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`)
    console.log(`  峰值内存: ${(peakMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`)
    console.log(`  最终内存: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`)
  }
  
  calculateSummary() {
    const apiTests = this.results.tests.filter(t => t.type === 'api' || t.type === 'database')
    
    if (apiTests.length > 0) {
      const responseTimes = apiTests.map(t => t.responseTime)
      
      this.results.summary.totalTests = apiTests.length
      this.results.summary.averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      this.results.summary.maxResponseTime = Math.max(...responseTimes)
      this.results.summary.minResponseTime = Math.min(...responseTimes)
    }
  }
  
  generateReport() {
    console.log('📋 生成性能报告...')
    
    // 生成JSON报告
    fs.writeFileSync('performance-results.json', JSON.stringify(this.results, null, 2))
    
    // 生成简要控制台报告
    console.log('\n📊 性能测试摘要:')
    console.log(`  总测试数: ${this.results.summary.totalTests}`)
    console.log(`  平均响应时间: ${this.results.summary.averageResponseTime.toFixed(2)}ms`)
    console.log(`  最大响应时间: ${this.results.summary.maxResponseTime.toFixed(2)}ms`)
    console.log(`  最小响应时间: ${this.results.summary.minResponseTime.toFixed(2)}ms`)
    
    // 性能警告
    const warnings = []
    if (this.results.summary.averageResponseTime > 1000) {
      warnings.push('⚠️  平均响应时间过长 (>1000ms)')
    }
    
    if (this.results.summary.maxResponseTime > 5000) {
      warnings.push('⚠️  最大响应时间过长 (>5000ms)')
    }
    
    const memoryIncrease = this.results.summary.memoryUsage.final.heapUsed - this.results.summary.memoryUsage.initial.heapUsed
    if (memoryIncrease > 50 * 1024 * 1024) { // 50MB
      warnings.push('⚠️  内存使用增长过多 (>50MB)')
    }
    
    if (warnings.length > 0) {
      console.log('\n⚠️  性能警告:')
      warnings.forEach(warning => console.log(`  ${warning}`))
    } else {
      console.log('\n✅ 所有性能指标正常')
    }
    
    console.log(`\n📄 详细报告已保存到: performance-results.json`)
  }
  
  getTestUserData() {
    const timestamp = Date.now()
    return {
      nickname: `性能测试用户${timestamp}`,
      country_code: '+86',
      phone: `139${timestamp.toString().slice(-8)}`,
      email: `perftest${timestamp}@example.com`,
      password: '123456'
    }
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  const performanceTest = new PerformanceTest()
  performanceTest.runPerformanceTests()
}

export { PerformanceTest }
