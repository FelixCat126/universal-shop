module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true
  },
  extends: [
    'eslint:recommended',
    'plugin:vue/vue3-essential'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  plugins: ['vue'],
  rules: {
    // ── Vue 相关 ──────────────────────────────────────────────
    'vue/multi-word-component-names': 'off',
    'vue/no-unused-vars': 'error',
    'vue/no-multiple-template-root': 'off',

    // ── JavaScript 正确性（**error：这些是会让代码跑不对的**）─────
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'prefer-const': 'error',
    'no-var': 'error',
    // 未使用的变量：只提醒不拦（有些是刻意留着的钩子参数/占位）
    'no-unused-vars': 'warn',
    'no-unused-private-class-members': 'warn',
    // no-const-assign / no-dupe-keys / no-undef 等来自 eslint:recommended，保持 error

    // ── 代码风格（**warn：只提醒，不挡门禁**）────────────────────
    // 本项目的既定风格是「无分号 + 单引号」，与 prettier 默认相反；
    // 之前把风格规则设成 error，等于整个仓库都过不了 lint，
    // 于是 lint 脚本干脆被改成 echo —— 静态检查网形同虚设。
    // 现在：**风格只提醒、正确性才拦门禁**，lint 才可能真的被用起来。
    'indent': ['warn', 2],
    'quotes': ['warn', 'single'],
    'semi': ['warn', 'never'],
    'comma-dangle': ['warn', 'never'],
    'object-curly-spacing': ['warn', 'always'],
    'array-bracket-spacing': ['warn', 'never'],

    // 与项目风格冲突的 prettier 规则：关掉（否则 19 万条噪声）
    'prettier/prettier': 'off'
  },
  globals: {
    defineProps: 'readonly',
    defineEmits: 'readonly',
    defineExpose: 'readonly',
    withDefaults: 'readonly'
  }
}
