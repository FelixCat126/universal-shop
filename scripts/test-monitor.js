#!/usr/bin/env node

/**
 * 测试监控脚本
 * 跟踪测试覆盖率趋势、性能基线、质量指标等
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

class TestMonitor {
  constructor() {
    this.historyFile = './test-history.json'
    this.history = this.loadHistory()
    this.currentData = {
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0],
      git: this.getGitInfo(),
      coverage: null,
      performance: null,
      quality: null
    }
  }
  
  loadHistory() {
    if (fs.existsSync(this.historyFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.historyFile, 'utf8'))
      } catch (error) {
        console.warn('⚠️  读取历史数据失败，创建新的历史记录')
        return { records: [] }
      }
    }
    return { records: [] }
  }
  
  saveHistory() {
    fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2))
  }
  
  getGitInfo() {
    try {
      return {
        commit: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
        branch: execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim(),
        author: execSync('git log -1 --format="%an"', { encoding: 'utf8' }).trim(),
        message: execSync('git log -1 --format="%s"', { encoding: 'utf8' }).trim()
      }
    } catch (error) {
      return {
        commit: 'unknown',
        branch: 'unknown',
        author: 'unknown',
        message: 'unknown'
      }
    }
  }
  
  async collectCoverageData() {
    console.log('📊 收集覆盖率数据...')
    
    try {
      // 运行覆盖率测试
      execSync('npm run test:coverage --silent', { stdio: 'pipe' })
      
      // 读取覆盖率数据
      const coverageFile = './coverage/coverage-summary.json'
      if (fs.existsSync(coverageFile)) {
        const coverageData = JSON.parse(fs.readFileSync(coverageFile, 'utf8'))
        
        this.currentData.coverage = {
          statements: coverageData.total.statements.pct,
          branches: coverageData.total.branches.pct,
          functions: coverageData.total.functions.pct,
          lines: coverageData.total.lines.pct,
          total: (
            coverageData.total.statements.pct +
            coverageData.total.branches.pct +
            coverageData.total.functions.pct +
            coverageData.total.lines.pct
          ) / 4
        }
        
        console.log(`  总覆盖率: ${this.currentData.coverage.total.toFixed(1)}%`)
      }
    } catch (error) {
      console.warn('⚠️  收集覆盖率数据失败:', error.message)
      this.currentData.coverage = null
    }
  }
  
  async collectPerformanceData() {
    console.log('⚡ 收集性能数据...')
    
    try {
      // 运行性能测试
      execSync('npm run test:performance --silent', { stdio: 'pipe' })
      
      // 读取性能数据
      const performanceFile = './performance-results.json'
      if (fs.existsSync(performanceFile)) {
        const performanceData = JSON.parse(fs.readFileSync(performanceFile, 'utf8'))
        
        this.currentData.performance = {
          averageResponseTime: performanceData.summary.averageResponseTime,
          maxResponseTime: performanceData.summary.maxResponseTime,
          memoryUsage: performanceData.summary.memoryUsage.final.heapUsed,
          totalTests: performanceData.summary.totalTests
        }
        
        console.log(`  平均响应时间: ${this.currentData.performance.averageResponseTime.toFixed(2)}ms`)
      }
    } catch (error) {
      console.warn('⚠️  收集性能数据失败:', error.message)
      this.currentData.performance = null
    }
  }
  
  async collectQualityMetrics() {
    console.log('🎯 收集质量指标...')
    
    try {
      // 运行测试获取质量指标
      const testOutput = execSync('npm run test:all --silent', { encoding: 'utf8', stdio: 'pipe' })
      
      // 简单解析测试结果（实际实现应该更精确）
      const passedTests = (testOutput.match(/✓/g) || []).length
      const failedTests = (testOutput.match(/✗/g) || []).length
      const totalTests = passedTests + failedTests
      
      this.currentData.quality = {
        totalTests,
        passedTests,
        failedTests,
        passRate: totalTests > 0 ? (passedTests / totalTests) * 100 : 0,
        codeQuality: this.calculateCodeQuality()
      }
      
      console.log(`  测试通过率: ${this.currentData.quality.passRate.toFixed(1)}%`)
    } catch (error) {
      console.warn('⚠️  收集质量指标失败:', error.message)
      this.currentData.quality = {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        passRate: 0,
        codeQuality: 'unknown'
      }
    }
  }
  
  calculateCodeQuality() {
    // 基于覆盖率和测试通过率计算代码质量评级
    if (!this.currentData.coverage || !this.currentData.quality) {
      return 'unknown'
    }
    
    const coverage = this.currentData.coverage.total
    const passRate = this.currentData.quality.passRate
    
    const qualityScore = (coverage + passRate) / 2
    
    if (qualityScore >= 90) return 'excellent'
    if (qualityScore >= 80) return 'good'
    if (qualityScore >= 70) return 'fair'
    if (qualityScore >= 60) return 'poor'
    return 'critical'
  }
  
  analyzeQualityTrends() {
    console.log('📈 分析质量趋势...')
    
    if (this.history.records.length < 2) {
      console.log('  历史数据不足，无法分析趋势')
      return null
    }
    
    const recent = this.history.records.slice(-5) // 最近5次记录
    const analysis = {
      coverage: this.analyzeTrend(recent, 'coverage', 'total'),
      performance: this.analyzeTrend(recent, 'performance', 'averageResponseTime'),
      quality: this.analyzeTrend(recent, 'quality', 'passRate')
    }
    
    console.log('  趋势分析:')
    console.log(`    覆盖率: ${analysis.coverage.trend} (${analysis.coverage.change > 0 ? '+' : ''}${analysis.coverage.change.toFixed(1)}%)`)
    console.log(`    性能: ${analysis.performance.trend} (${analysis.performance.change > 0 ? '+' : ''}${analysis.performance.change.toFixed(1)}ms)`)
    console.log(`    质量: ${analysis.quality.trend} (${analysis.quality.change > 0 ? '+' : ''}${analysis.quality.change.toFixed(1)}%)`)
    
    return analysis
  }
  
  analyzeTrend(records, category, metric) {
    const values = records
      .filter(r => r[category] && r[category][metric] !== null)
      .map(r => r[category][metric])
    
    if (values.length < 2) {
      return { trend: 'insufficient_data', change: 0 }
    }
    
    const first = values[0]
    const last = values[values.length - 1]
    const change = last - first
    
    let trend = 'stable'
    if (change > 0) {
      trend = category === 'performance' ? 'declining' : 'improving' // 性能指标越低越好
    } else if (change < 0) {
      trend = category === 'performance' ? 'improving' : 'declining'
    }
    
    return { trend, change }
  }
  
  generateAlerts() {
    console.log('🚨 生成质量警报...')
    
    const alerts = []
    
    // 覆盖率警报
    if (this.currentData.coverage) {
      if (this.currentData.coverage.total < 70) {
        alerts.push({
          level: 'error',
          type: 'coverage',
          message: `代码覆盖率过低: ${this.currentData.coverage.total.toFixed(1)}% (目标: >70%)`
        })
      } else if (this.currentData.coverage.total < 80) {
        alerts.push({
          level: 'warning',
          type: 'coverage',
          message: `代码覆盖率需要改进: ${this.currentData.coverage.total.toFixed(1)}% (目标: >80%)`
        })
      }
    }
    
    // 性能警报
    if (this.currentData.performance) {
      if (this.currentData.performance.averageResponseTime > 1000) {
        alerts.push({
          level: 'error',
          type: 'performance',
          message: `API响应时间过慢: ${this.currentData.performance.averageResponseTime.toFixed(2)}ms (目标: <1000ms)`
        })
      } else if (this.currentData.performance.averageResponseTime > 500) {
        alerts.push({
          level: 'warning',
          type: 'performance',
          message: `API响应时间较慢: ${this.currentData.performance.averageResponseTime.toFixed(2)}ms (目标: <500ms)`
        })
      }
    }
    
    // 质量警报
    if (this.currentData.quality) {
      if (this.currentData.quality.passRate < 95) {
        alerts.push({
          level: 'error',
          type: 'quality',
          message: `测试通过率过低: ${this.currentData.quality.passRate.toFixed(1)}% (目标: >95%)`
        })
      }
    }
    
    if (alerts.length > 0) {
      console.log('  发现质量问题:')
      alerts.forEach(alert => {
        const icon = alert.level === 'error' ? '🔴' : '🟡'
        console.log(`    ${icon} ${alert.message}`)
      })
    } else {
      console.log('  ✅ 所有质量指标正常')
    }
    
    return alerts
  }
  
  generateReport() {
    console.log('📋 生成监控报告...')
    
    const report = {
      summary: this.currentData,
      trends: this.analyzeQualityTrends(),
      alerts: this.generateAlerts(),
      history: {
        totalRecords: this.history.records.length,
        dateRange: this.history.records.length > 0 ? {
          first: this.history.records[0].date,
          last: this.history.records[this.history.records.length - 1].date
        } : null
      }
    }
    
    // 保存报告
    const reportFile = `./test-reports/monitor-report-${this.currentData.date}.json`
    const reportDir = path.dirname(reportFile)
    
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true })
    }
    
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
    console.log(`  报告已保存到: ${reportFile}`)
    
    return report
  }
  
  async runMonitoring() {
    console.log('🔍 开始测试监控...')
    
    try {
      // 收集各种数据
      await this.collectCoverageData()
      await this.collectPerformanceData()
      await this.collectQualityMetrics()
      
      // 更新质量评级
      if (this.currentData.quality) {
        this.currentData.quality.codeQuality = this.calculateCodeQuality()
      }
      
      // 生成报告和分析
      const report = this.generateReport()
      
      // 更新历史记录
      this.history.records.push(this.currentData)
      
      // 保持历史记录在合理范围内（最多保留100条）
      if (this.history.records.length > 100) {
        this.history.records = this.history.records.slice(-100)
      }
      
      this.saveHistory()
      
      console.log('✅ 测试监控完成')
      
      // 如果有错误级别的警报，退出码为1
      const hasErrors = report.alerts.some(alert => alert.level === 'error')
      if (hasErrors) {
        console.log('❌ 发现严重质量问题')
        process.exit(1)
      }
      
    } catch (error) {
      console.error('❌ 测试监控失败:', error.message)
      process.exit(1)
    }
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  const monitor = new TestMonitor()
  monitor.runMonitoring()
}

export { TestMonitor }
