#!/usr/bin/env node

/**
 * Git钩子设置脚本
 * 自动配置pre-commit钩子来运行测试
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const GIT_HOOKS_DIR = '.git/hooks'
const PRE_COMMIT_HOOK = path.join(GIT_HOOKS_DIR, 'pre-commit')

// pre-commit钩子内容
const PRE_COMMIT_SCRIPT = `#!/bin/sh
#
# 自动生成的pre-commit钩子
# 在提交前运行测试以确保代码质量
#

echo "🔍 运行pre-commit检查..."

# 检查是否有暂存的文件
if git diff --cached --quiet; then
  echo "📝 没有暂存的文件，跳过检查"
  exit 0
fi

# 运行快速测试
echo "🧪 运行快速测试..."
npm run test:unit --silent

if [ $? -ne 0 ]; then
  echo "❌ 单元测试失败，请修复后再提交"
  exit 1
fi

# 检查代码覆盖率（可选，如果覆盖率太低会警告但不阻止提交）
echo "📊 检查代码覆盖率..."
npm run test:coverage --silent > /dev/null 2>&1

if [ $? -eq 0 ]; then
  echo "✅ 代码覆盖率检查通过"
else
  echo "⚠️  代码覆盖率检查失败，建议增加测试覆盖"
fi

echo "✅ Pre-commit检查完成"
exit 0
`

async function setupGitHooks() {
  console.log('🔧 设置Git钩子...')
  
  try {
    // 检查是否在Git仓库中
    if (!fs.existsSync(GIT_HOOKS_DIR)) {
      console.error('❌ 错误: 当前目录不是Git仓库或Git未初始化')
      process.exit(1)
    }
    
    // 创建pre-commit钩子
    fs.writeFileSync(PRE_COMMIT_HOOK, PRE_COMMIT_SCRIPT, { mode: 0o755 })
    console.log('✅ Pre-commit钩子已创建')
    
    // 使钩子可执行
    try {
      execSync(`chmod +x "${PRE_COMMIT_HOOK}"`)
      console.log('✅ Pre-commit钩子权限已设置')
    } catch (error) {
      console.warn('⚠️  设置钩子权限失败:', error.message)
    }
    
    console.log('')
    console.log('🎉 Git钩子设置完成!')
    console.log('')
    console.log('现在当你运行 `git commit` 时，会自动:')
    console.log('  1. 运行单元测试')
    console.log('  2. 检查代码覆盖率')
    console.log('  3. 如果测试失败，阻止提交')
    console.log('')
    console.log('如果需要跳过pre-commit检查，可使用:')
    console.log('  git commit --no-verify')
    
  } catch (error) {
    console.error('❌ 设置Git钩子失败:', error.message)
    process.exit(1)
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  setupGitHooks()
}

export { setupGitHooks }
