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
      /**
       * 覆盖率门槛（棘轮：只许升不许降）。
       *
       * **格式必须是 Vitest 1.6 的写法**：
       *   - 全局门槛 = **顶层数字键**（statements / branches / functions / lines）
       *   - 分目录门槛 = glob 键，且要带 `**`（如 'src/server/controllers/**'）
       *
       * 之前写的是 `{ global: {...}, 'src/server/controllers/': {...} }`，
       * Vitest 1.6 根本不认 `global` 这个键 —— 它会把 `global` 当成 glob 模式，
       * 匹配不到任何文件 → 那个分组是空的 → 直接跳过；
       * 而 'src/server/controllers/'（带尾斜杠）同样匹配不到文件。
       * 结果：**门槛从未生效过**（实测 branches 64% < 写的 70%，CI 照样绿）。
       *
       * 注意「全局」这一组 = **没被任何 glob 匹配到的文件**（即除 controllers/models 之外），
       * 它的数字比报告里的 "All files" 低，别拿 All files 直接抄。
       *
       * 数字取当前实测值并留 1~2 个点的余量（覆盖率在不同运行间会有小幅浮动，
       * 卡在临界点上会变成随机红）；补了测试再往上抬。
       */
      thresholds: {
        statements: 83,
        branches: 73,
        functions: 84,
        lines: 83,
        'src/server/controllers/**': {
          statements: 75,
          branches: 57,
          functions: 89,
          lines: 75
        },
        'src/server/models/**': {
          statements: 96,
          branches: 69,
          functions: 93,
          lines: 96
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
