#!/usr/bin/env node

/**
 * JWT密钥生成工具
 * 用于生产环境生成安全的JWT密钥
 */

import crypto from 'crypto'

function generateSecureJWTSecret() {
  // 生成256位(32字节)的随机密钥
  const secret = crypto.randomBytes(32).toString('hex')
  return secret
}

console.log('🔐 生成安全JWT密钥')
console.log('='.repeat(50))
console.log('')
console.log('复制以下密钥到你的 .env 文件中:')
console.log('')
console.log(`JWT_SECRET=${generateSecureJWTSecret()}`)
console.log('')
console.log('⚠️  重要提醒:')
console.log('1. 请将此密钥保存在安全的地方')
console.log('2. 不要将密钥提交到代码仓库')
console.log('3. 更换密钥将使所有现有token失效')
console.log('4. 建议定期轮换密钥以增强安全性')
console.log('')
