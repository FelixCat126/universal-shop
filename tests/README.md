# 🧪 自动化测试文档

本项目实现了全面的自动化测试框架，包括单元测试、集成测试、API测试、E2E测试以及性能监控。

## 📋 目录

- [快速开始](#快速开始)
- [测试类型](#测试类型)
- [测试命令](#测试命令)
- [测试结构](#测试结构)
- [编写测试](#编写测试)
- [持续集成](#持续集成)
- [性能监控](#性能监控)
- [最佳实践](#最佳实践)

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 设置测试环境

```bash
# 准备测试环境
npm run test:setup

# 设置Git钩子（可选）
npm run hooks:setup
```

### 3. 运行测试

```bash
# 运行所有测试
npm test

# 运行特定类型的测试
npm run test:unit      # 单元测试
npm run test:api       # API测试
npm run test:e2e       # E2E测试

# 查看覆盖率
npm run test:coverage
```

## 🔍 测试类型

### 单元测试 (Unit Tests)
- **位置**: `tests/unit/`
- **目的**: 测试单个函数、类或组件的行为
- **示例**: 用户模型验证、密码加密、推荐码生成

### 集成测试 (Integration Tests)
- **位置**: `tests/integration/`
- **目的**: 测试多个组件协同工作
- **示例**: 数据库操作、错误处理流程

### API测试 (API Tests)
- **位置**: `tests/api/`
- **目的**: 测试HTTP API端点
- **示例**: 用户注册、订单创建、商品查询

### E2E测试 (End-to-End Tests)
- **位置**: `tests/e2e/`
- **目的**: 测试完整的用户流程
- **示例**: 注册→登录→购物→下单的完整流程

## 📜 测试命令

### 基础测试命令

```bash
# 交互式测试（开发推荐）
npm test

# 运行所有测试
npm run test:all

# 按类型运行
npm run test:unit        # 单元测试
npm run test:integration # 集成测试
npm run test:api         # API测试
npm run test:e2e         # E2E测试

# 监听模式（开发时使用）
npm run test:watch

# 覆盖率测试
npm run test:coverage

# 测试UI界面
npm run test:ui
```

### 高级测试命令

```bash
# CI环境测试
npm run test:ci

# 性能测试
npm run test:performance

# 质量监控
npm run test:monitor

# 生成测试报告
npm run test:report

# 清理测试环境
npm run test:cleanup
```

## 📁 测试结构

```
tests/
├── setup/                    # 测试环境配置
│   ├── test-setup.js        # 全局测试设置
│   ├── test-database.js     # 测试数据库管理
│   ├── prepare-test-env.js  # 环境准备脚本
│   └── cleanup-test-env.js  # 环境清理脚本
├── factories/               # 测试数据工厂
│   └── index.js            # 数据生成器
├── helpers/                 # 测试辅助工具
│   └── test-helpers.js     # 通用测试方法
├── config/                  # 测试配置
│   └── ci.config.js        # CI环境配置
├── unit/                    # 单元测试
│   ├── models/             # 模型测试
│   ├── utils/              # 工具函数测试
│   └── middlewares/        # 中间件测试
├── integration/             # 集成测试
│   └── errorScenarios.test.js
├── api/                     # API测试
│   ├── auth.test.js        # 认证API测试
│   └── orders.test.js      # 订单API测试
└── e2e/                     # E2E测试
    └── criticalFlows.test.js # 关键流程测试
```

## ✍️ 编写测试

### 1. 使用测试数据工厂

```javascript
import { TestDataFactory } from '../factories/index.js'

// 创建测试用户
const userData = await TestDataFactory.createUser({
  email: 'test@example.com'
})

// 创建测试商品
const productData = TestDataFactory.createProduct({
  price: 100,
  stock: 10
})
```

### 2. 使用测试辅助工具

```javascript
import { TestHelpers } from '../helpers/test-helpers.js'

// 生成JWT令牌
const token = TestHelpers.generateToken(user)

// 创建完整的用户（包含地址）
const { user, address } = await TestHelpers.createUserWithAddress()

// 创建完整的订单（包含商品）
const { user, products, order } = await TestHelpers.createOrderWithItems()
```

### 3. API测试示例

```javascript
import request from 'supertest'
import app from '@server/app.js'

describe('用户API', () => {
  it('应该成功注册用户', async () => {
    const response = await request(app)
      .post('/api/users/register')
      .send({
        nickname: '测试用户',
        email: 'test@example.com',
        password: '123456'
      })
      .expect(201)
    
    expect(response.body.success).toBe(true)
    expect(response.body.data.token).toBeDefined()
  })
})
```

### 4. 单元测试示例

```javascript
import { TestDatabase } from '../../setup/test-database.js'

describe('User模型', () => {
  let User
  
  beforeEach(async () => {
    const sequelize = TestDatabase.getSequelize()
    User = sequelize.models.User
  })
  
  it('应该自动加密密码', async () => {
    const user = await User.create({
      email: 'test@example.com',
      password: '123456'
    })
    
    expect(user.password).not.toBe('123456')
    expect(user.password.length).toBeGreaterThan(20)
  })
})
```

## 🔄 持续集成

项目配置了 GitHub Actions 工作流，在每次推送和 Pull Request 时自动运行：

### CI 流程

1. **代码检出**: 获取最新代码
2. **环境设置**: 安装 Node.js 和依赖
3. **代码检查**: 运行 ESLint
4. **构建测试**: 构建前端应用
5. **测试执行**: 
   - 单元测试
   - 集成测试
   - API测试
   - E2E测试
6. **覆盖率报告**: 生成并上传覆盖率报告
7. **安全扫描**: 检查依赖漏洞
8. **性能测试**: 运行性能基准测试

### 本地 Git 钩子

设置后，每次提交前会自动运行：

```bash
# 设置Git钩子
npm run hooks:setup

# 跳过pre-commit检查（紧急情况）
git commit --no-verify
```

## 📊 性能监控

### 性能测试

```bash
# 运行性能测试
npm run test:performance
```

测试内容：
- API响应时间
- 数据库查询性能
- 并发请求处理
- 内存使用情况

### 质量监控

```bash
# 运行质量监控
npm run test:monitor
```

监控指标：
- 代码覆盖率趋势
- 测试通过率
- 性能基线对比
- 质量警报

### 报告生成

```bash
# 生成综合测试报告
npm run test:report
```

生成内容：
- HTML格式测试报告
- JSON格式详细数据
- 覆盖率统计
- 性能分析

## 🎯 最佳实践

### 1. 测试命名

```javascript
// ✅ 好的测试命名
describe('用户注册功能', () => {
  it('应该在提供有效数据时成功注册用户', () => {})
  it('应该在邮箱已存在时返回错误', () => {})
})

// ❌ 不好的测试命名
describe('User', () => {
  it('test1', () => {})
  it('register', () => {})
})
```

### 2. 测试结构

```javascript
// ✅ 好的测试结构
describe('功能模块', () => {
  beforeEach(async () => {
    // 每个测试前的准备工作
    await TestDatabase.clearAllData()
  })
  
  describe('具体功能点', () => {
    it('应该在正常情况下工作', () => {
      // Arrange - 准备数据
      // Act - 执行操作
      // Assert - 验证结果
    })
    
    it('应该在异常情况下正确处理', () => {
      // 测试边界情况
    })
  })
})
```

### 3. 数据隔离

```javascript
// ✅ 每个测试使用独立数据
beforeEach(async () => {
  await TestDatabase.clearAllData()
  // 创建本测试需要的数据
})

// ❌ 测试间共享数据
beforeAll(async () => {
  // 所有测试共享的数据（可能导致测试间相互影响）
})
```

### 4. 异步测试

```javascript
// ✅ 正确处理异步操作
it('应该正确处理异步操作', async () => {
  const result = await someAsyncOperation()
  expect(result).toBe(expectedValue)
})

// ❌ 忘记等待异步操作
it('异步操作测试', () => {
  someAsyncOperation() // 没有await
  expect(result).toBe(expectedValue) // 可能在操作完成前执行
})
```

### 5. 错误测试

```javascript
// ✅ 测试错误情况
it('应该在数据无效时抛出错误', async () => {
  await expect(invalidOperation()).rejects.toThrow('错误信息')
})

// ✅ 测试API错误响应
it('应该返回400错误', async () => {
  const response = await request(app)
    .post('/api/invalid')
    .send({})
    .expect(400)
  
  expect(response.body.success).toBe(false)
})
```

## 🔧 配置说明

### 覆盖率阈值

```javascript
// vitest.config.js
coverage: {
  thresholds: {
    global: {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80
    }
  }
}
```

### 测试超时

```javascript
// vitest.config.js
test: {
  testTimeout: 10000,    // 10秒
  hookTimeout: 10000     // 10秒
}
```

## 📞 支持

如果在使用测试框架时遇到问题：

1. 查看测试日志输出
2. 检查测试环境配置
3. 运行 `npm run test:cleanup` 清理环境
4. 重新运行 `npm run test:setup` 设置环境

## 📝 更新日志

- **v1.2.0**: 实现完整的自动化测试框架
  - 单元测试、集成测试、API测试、E2E测试
  - 覆盖率监控和报告
  - CI/CD集成
  - 性能监控
  - Git钩子集成
