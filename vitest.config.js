import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

/**
 * 测试矩阵：当前保留的回归覆盖（PostgreSQL 实库）
 *   - tests/api/security.test.js              止血鉴权/CORS/CSP/错误响应
 *   - tests/api/inputValidation.test.js       Joi 校验 / 上传魔法字节 / 游客密码
 *   - tests/api/securityHardening.test.js     验证码 / 登录强制守卫 / 审计日志
 *   - tests/integration/concurrencySafety.test.js  库存原子 / 支付幂等 / 默认地址原子
 *
 * 老的与现行 schema/接口已脱节的旧测试已删除，避免误报。
 */

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup/test-setup.js'],
    /**
     * 排除：
     *   - tests/vue/** —— Vue 组件/组合式单测，需要 happy-dom + @vitejs/plugin-vue，
     *     跑在 vitest.vue.config.js 里（npm run test:vue）。放进本配置会因
     *     「无法解析 .vue」「localStorage is not defined」整片失败。
     *   - tests/e2e/** —— Playwright 用例，由 npm run test:e2e 跑。
     *     Playwright 的 test.beforeEach 在 vitest 里会直接抛错。
     */
    exclude: [
      'node_modules/**',
      'dist/**',
      'tests/vue/**',
      'tests/e2e/**'
    ],
    // PostgreSQL 支持高并发，但测试间共享同一个数据库需要串行避免互相 TRUNCATE
    fileParallelism: false,
    /**
     * 文件之间必须串行：所有测试文件共用同一个 PostgreSQL 库，
     * 每个文件的 beforeEach 会 TRUNCATE 全部业务表。
     * 若两个文件并发，一个文件的清库会抹掉另一个文件刚建好的夹具数据，
     * 表现为「随机落在不同用例上的 404 / 401 / 条数不对」等假失败。
     *
     * 注意不要用 poolOptions.forks.singleFork —— 在 Vitest 1.x 里
     * singleFork 反而会让文件**并发**执行（实测两个文件的 syncModels
     * 撞在一起，sequelize.drop 报 relation "products" does not exist）。
     */
    sequence: {
      concurrent: false,
      // hooks: 'list' —— 必须显式指定。
      //
      // Vitest 1.x 的 sequence.hooks 默认是 'parallel'：setup 文件里的
      // beforeEach（TRUNCATE 全部业务表）与测试文件自己的 beforeEach
      // （创建本用例的夹具数据）会**并发**执行。
      // 于是 TRUNCATE 可能落在夹具创建之后，把刚建好的行删掉，
      // 表现为「随机落在不同用例上的、与当前用例无关的断言失败」
      // （库存不守恒 / 列表条数不对 / 401 等），极难排查。
      //
      // 'list' 让 hook 按定义顺序串行：先清库（setup）→ 再建夹具（用例）。
      hooks: 'list'
    },
    // 增加超时时间
    testTimeout: 30000,
    hookTimeout: 30000,
  coverage: {
    provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        'public/',
        'scripts/',
        '**/*.config.js',
        '**/*.config.ts',
        'database/',
        '*.sh',
        'package.sh',
        'setup.js',
        'start-https-production.js',
        'src/server/seeds/',
        'src/server/migrations/',
        'nodemon.json'
      ],
      include: [
        'src/server/**/*.js',
        'src/portal/**/*.js',
        'src/portal/**/*.vue',
        'src/admin/**/*.js',
        'src/admin/**/*.vue'
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 75,
          lines: 80,
          statements: 80
        },
        'src/server/controllers/': {
          branches: 75,
          functions: 80,
          lines: 85,
          statements: 85
        },
        'src/server/models/': {
          branches: 80,
          functions: 85,
          lines: 90,
          statements: 90
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(process.cwd(), './src'),
      '@server': resolve(process.cwd(), './src/server'),
      '@portal': resolve(process.cwd(), './src/portal'),
      '@admin': resolve(process.cwd(), './src/admin'),
      '@tests': resolve(process.cwd(), './tests')
    }
  }
})
