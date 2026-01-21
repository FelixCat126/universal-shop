/**
 * CI/CD环境测试配置
 * 用于GitHub Actions或其他CI环境的特殊配置
 */

export default {
  // CI环境下的特殊测试超时设置
  testTimeout: 15000,
  hookTimeout: 15000,
  
  // CI环境下的并发设置
  maxConcurrency: 2,
  
  // CI环境下的重试设置
  retry: {
    // 失败测试重试次数
    count: 2,
    // 重试的测试类型
    onFail: true
  },
  
  // CI环境下的覆盖率要求
  coverage: {
    thresholds: {
      global: {
        branches: 65, // 比本地环境稍低，考虑CI环境差异
        functions: 70,
        lines: 75,
        statements: 75
      }
    },
    // CI环境下生成更多格式的报告
    reporter: ['text', 'json', 'html', 'lcov', 'cobertura']
  },
  
  // 日志设置
  silent: false,
  verbose: true,
  
  // 环境变量设置
  env: {
    NODE_ENV: 'test',
    CI: 'true',
    // CI环境使用内存数据库
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'ci-test-jwt-secret-key-for-ci-testing-only-32-chars'
  }
}
