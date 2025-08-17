#!/usr/bin/env node

/**
 * 清理缓存脚本
 * 用于开发环境启动前清理各种缓存文件
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, '..')

console.log('🧹 清理缓存中...')

// 需要清理的缓存目录和文件
const cacheTargets = [
  'node_modules/.vite',
  'node_modules/.cache',
  // 注释掉dist目录清理，避免删除已构建的前端文件
  // 'dist/portal',
  // 'dist/admin',
  '.vite',
  'vite.config.js.timestamp-*',
  'vite.admin.config.js.timestamp-*'
]

let cleanedCount = 0

cacheTargets.forEach(target => {
  const fullPath = path.join(projectRoot, target)
  
  try {
    // 处理通配符模式
    if (target.includes('*')) {
      const dir = path.dirname(fullPath)
      const pattern = path.basename(target).replace('*', '')
      
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir)
        files.forEach(file => {
          if (file.startsWith(pattern)) {
            const filePath = path.join(dir, file)
            fs.unlinkSync(filePath)
            console.log(`  ✅ 删除文件: ${path.relative(projectRoot, filePath)}`)
            cleanedCount++
          }
        })
      }
    } else {
      // 处理普通路径
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath)
        
        if (stats.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true })
          console.log(`  ✅ 删除目录: ${target}`)
        } else {
          fs.unlinkSync(fullPath)
          console.log(`  ✅ 删除文件: ${target}`)
        }
        cleanedCount++
      }
    }
  } catch (error) {
    // 忽略清理错误，继续处理其他目标
    console.log(`  ⚠️ 清理失败: ${target} (${error.message})`)
  }
})

if (cleanedCount === 0) {
  console.log('✨ 缓存已经是干净的！')
} else {
  console.log(`✨ 缓存清理完成！清理了 ${cleanedCount} 个目标`)
}

console.log('🚀 准备启动开发环境...\n')
