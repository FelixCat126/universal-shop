#!/usr/bin/env node

/**
 * 测试报告生成脚本
 * 生成详细的测试报告和覆盖率分析
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

class TestReporter {
  constructor() {
    this.reportDir = './test-reports'
    this.timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  }
  
  async generateReports() {
    console.log('📊 生成测试报告...')
    
    try {
      // 确保报告目录存在
      if (!fs.existsSync(this.reportDir)) {
        fs.mkdirSync(this.reportDir, { recursive: true })
      }
      
      // 运行所有测试并生成覆盖率报告
      console.log('🧪 运行完整测试套件...')
      const testResults = await this.runAllTests()
      
      // 生成HTML报告
      console.log('📄 生成HTML报告...')
      await this.generateHtmlReport(testResults)
      
      // 生成JSON报告
      console.log('📋 生成JSON报告...')
      await this.generateJsonReport(testResults)
      
      // 生成覆盖率摘要
      console.log('📈 生成覆盖率摘要...')
      await this.generateCoverageSummary()
      
      // 生成性能报告
      console.log('⚡ 生成性能报告...')
      await this.generatePerformanceReport()
      
      console.log(`✅ 测试报告已生成到: ${this.reportDir}`)
      console.log('📂 报告文件:')
      console.log(`  - HTML报告: ${this.reportDir}/test-report-${this.timestamp}.html`)
      console.log(`  - JSON报告: ${this.reportDir}/test-results-${this.timestamp}.json`)
      console.log(`  - 覆盖率报告: ${this.reportDir}/coverage-summary-${this.timestamp}.json`)
      console.log(`  - 性能报告: ${this.reportDir}/performance-${this.timestamp}.json`)
      
    } catch (error) {
      console.error('❌ 生成测试报告失败:', error.message)
      process.exit(1)
    }
  }
  
  async runAllTests() {
    const testCommands = [
      'npm run test:unit',
      'npm run test:integration', 
      'npm run test:api'
    ]
    
    const results = {
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0
      },
      suites: []
    }
    
    for (const command of testCommands) {
      try {
        console.log(`  执行: ${command}`)
        const startTime = Date.now()
        
        const output = execSync(command, { 
          encoding: 'utf8',
          stdio: 'pipe'
        })
        
        const duration = Date.now() - startTime
        results.summary.duration += duration
        
        // 解析测试结果（简化版）
        const suiteResult = this.parseTestOutput(output, command, duration)
        results.suites.push(suiteResult)
        
        results.summary.total += suiteResult.total
        results.summary.passed += suiteResult.passed
        results.summary.failed += suiteResult.failed
        results.summary.skipped += suiteResult.skipped
        
      } catch (error) {
        console.warn(`⚠️  ${command} 执行失败:`, error.message)
        
        results.suites.push({
          name: command,
          status: 'failed',
          error: error.message,
          total: 0,
          passed: 0,
          failed: 1,
          skipped: 0,
          duration: 0
        })
        
        results.summary.failed += 1
      }
    }
    
    return results
  }
  
  parseTestOutput(output, command, duration) {
    // 简化的输出解析，实际实现应该更完善
    const lines = output.split('\n')
    let passed = 0
    let failed = 0
    let total = 0
    
    // 尝试从输出中提取测试统计信息
    for (const line of lines) {
      if (line.includes('✓') || line.includes('passed')) {
        passed++
      } else if (line.includes('✗') || line.includes('failed')) {
        failed++
      }
    }
    
    total = passed + failed
    
    return {
      name: command,
      status: failed === 0 ? 'passed' : 'failed',
      total: total || 1,
      passed: passed || (failed === 0 ? 1 : 0),
      failed: failed,
      skipped: 0,
      duration
    }
  }
  
  async generateHtmlReport(testResults) {
    const htmlTemplate = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>测试报告 - ${this.timestamp}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            padding: 30px;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .metric {
            text-align: center;
            padding: 20px;
            border-radius: 8px;
            color: white;
        }
        .metric.total { background: #3498db; }
        .metric.passed { background: #2ecc71; }
        .metric.failed { background: #e74c3c; }
        .metric.duration { background: #9b59b6; }
        .metric h3 {
            margin: 0 0 10px 0;
            font-size: 2em;
        }
        .metric p {
            margin: 0;
            opacity: 0.9;
        }
        .suites {
            margin-top: 30px;
        }
        .suite {
            border: 1px solid #ddd;
            border-radius: 8px;
            margin-bottom: 20px;
            overflow: hidden;
        }
        .suite-header {
            background: #f8f9fa;
            padding: 15px 20px;
            border-bottom: 1px solid #ddd;
        }
        .suite-content {
            padding: 20px;
        }
        .status-passed { color: #2ecc71; }
        .status-failed { color: #e74c3c; }
        .progress-bar {
            width: 100%;
            height: 6px;
            background: #eee;
            border-radius: 3px;
            margin-top: 10px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: #2ecc71;
            transition: width 0.3s ease;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧪 测试报告</h1>
            <p>生成时间: ${new Date().toLocaleString('zh-CN')}</p>
        </div>
        
        <div class="summary">
            <div class="metric total">
                <h3>${testResults.summary.total}</h3>
                <p>总测试数</p>
            </div>
            <div class="metric passed">
                <h3>${testResults.summary.passed}</h3>
                <p>通过</p>
            </div>
            <div class="metric failed">
                <h3>${testResults.summary.failed}</h3>
                <p>失败</p>
            </div>
            <div class="metric duration">
                <h3>${(testResults.summary.duration / 1000).toFixed(1)}s</h3>
                <p>总耗时</p>
            </div>
        </div>
        
        <div class="suites">
            <h2>📋 测试套件详情</h2>
            ${testResults.suites.map(suite => `
                <div class="suite">
                    <div class="suite-header">
                        <h3>${suite.name}</h3>
                        <span class="status-${suite.status}">● ${suite.status.toUpperCase()}</span>
                    </div>
                    <div class="suite-content">
                        <p><strong>总数:</strong> ${suite.total}</p>
                        <p><strong>通过:</strong> ${suite.passed}</p>
                        <p><strong>失败:</strong> ${suite.failed}</p>
                        <p><strong>耗时:</strong> ${(suite.duration / 1000).toFixed(2)}s</p>
                        ${suite.total > 0 ? `
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${(suite.passed / suite.total * 100)}%"></div>
                            </div>
                        ` : ''}
                        ${suite.error ? `<p style="color: #e74c3c;"><strong>错误:</strong> ${suite.error}</p>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    </div>
</body>
</html>`
    
    const htmlPath = path.join(this.reportDir, `test-report-${this.timestamp}.html`)
    fs.writeFileSync(htmlPath, htmlTemplate)
  }
  
  async generateJsonReport(testResults) {
    const jsonPath = path.join(this.reportDir, `test-results-${this.timestamp}.json`)
    fs.writeFileSync(jsonPath, JSON.stringify({
      ...testResults,
      metadata: {
        timestamp: this.timestamp,
        generatedAt: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform
      }
    }, null, 2))
  }
  
  async generateCoverageSummary() {
    try {
      // 运行覆盖率测试
      const coverageOutput = execSync('npm run test:coverage --silent', { 
        encoding: 'utf8',
        stdio: 'pipe'
      })
      
      // 尝试读取覆盖率JSON文件
      const coverageJsonPath = './coverage/coverage-summary.json'
      if (fs.existsSync(coverageJsonPath)) {
        const coverageData = JSON.parse(fs.readFileSync(coverageJsonPath, 'utf8'))
        
        const summaryPath = path.join(this.reportDir, `coverage-summary-${this.timestamp}.json`)
        fs.writeFileSync(summaryPath, JSON.stringify({
          ...coverageData,
          metadata: {
            timestamp: this.timestamp,
            generatedAt: new Date().toISOString()
          }
        }, null, 2))
      }
      
    } catch (error) {
      console.warn('⚠️  生成覆盖率摘要失败:', error.message)
    }
  }
  
  async generatePerformanceReport() {
    const performanceData = {
      timestamp: this.timestamp,
      generatedAt: new Date().toISOString(),
      metrics: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        platform: process.platform,
        nodeVersion: process.version
      },
      recommendations: []
    }
    
    // 添加性能建议
    if (performanceData.metrics.memoryUsage.heapUsed > 100 * 1024 * 1024) {
      performanceData.recommendations.push('内存使用较高，建议检查是否有内存泄漏')
    }
    
    const perfPath = path.join(this.reportDir, `performance-${this.timestamp}.json`)
    fs.writeFileSync(perfPath, JSON.stringify(performanceData, null, 2))
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  const reporter = new TestReporter()
  reporter.generateReports()
}

export { TestReporter }
