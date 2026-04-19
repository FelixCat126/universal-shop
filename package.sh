#!/bin/bash

# ===========================================
# Universal Shop - 打包脚本
# 遵循项目原有设计，简单可靠
# ===========================================

set -e

PROJECT_NAME="universal-shop"
VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo "1.2.0")"
PACKAGE_DIR="${PROJECT_NAME}-v${VERSION}"

echo "📦 Universal Shop 打包"
echo "====================="
echo "版本: ${VERSION}"
echo ""

# 清理环境
echo "🧹 清理环境..."
rm -rf dist/ ${PACKAGE_DIR}/ ${PACKAGE_DIR}.tar.gz

# 安装依赖并构建前端
echo "🔨 构建前端..."
npm install --silent
npm run build:portal
npm run build:admin

# 创建打包目录结构
echo "📁 创建打包目录..."
mkdir -p "${PACKAGE_DIR}"

# 复制所有必要文件（保持原有结构）
echo "📋 复制项目文件..."
cp -r src "${PACKAGE_DIR}/"
cp -r dist "${PACKAGE_DIR}/"
cp package.json package-lock.json "${PACKAGE_DIR}/"
cp setup.js "${PACKAGE_DIR}/"
cp env.example "${PACKAGE_DIR}/"
cp vite.config.js vite.admin.config.js "${PACKAGE_DIR}/"
cp tailwind.config.js postcss.config.js "${PACKAGE_DIR}/" 2>/dev/null || true
cp nodemon.json "${PACKAGE_DIR}/" 2>/dev/null || true
cp start-https-production.js "${PACKAGE_DIR}/"
cp README.md DEPLOYMENT_GUIDE.md "${PACKAGE_DIR}/" 2>/dev/null || true

# 复制文档目录
cp -r docs "${PACKAGE_DIR}/" 2>/dev/null || true

# 复制脚本目录
cp -r scripts "${PACKAGE_DIR}/" 2>/dev/null || true

# 生成PM2配置文件
cat > "${PACKAGE_DIR}/ecosystem.config.js" << 'EOF'
module.exports = {
  apps: [{
    name: 'universal-shop',
    script: 'src/server/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
}
EOF

# 创建必要目录
mkdir -p "${PACKAGE_DIR}/public/uploads"
mkdir -p "${PACKAGE_DIR}/database"
mkdir -p "${PACKAGE_DIR}/ssl"
mkdir -p "${PACKAGE_DIR}/logs"

# 生成安装脚本
echo "📝 生成安装脚本..."
cat > "${PACKAGE_DIR}/install.sh" << 'EOF'
#!/bin/bash
echo "🚀 Universal Shop 安装"
echo "===================="

# 检查Node.js版本
node --version || { echo "❌ 需要Node.js 18+"; exit 1; }

# 安装生产依赖
echo "📦 安装依赖..."
npm install --only=production --silent

# 创建环境配置
if [ ! -f ".env" ]; then
    cp env.example .env
    echo "📝 已创建.env配置文件"
fi

# 创建必要目录
mkdir -p public/uploads database ssl logs

# 初始化管理员账户
echo "👤 初始化管理员账户..."
npm run setup

echo "✅ 安装完成！"
echo ""
echo "🚀 启动服务: ./start.sh"
echo "🔑 默认管理员: admin / 123456"
EOF

# 生成启动脚本
cat > "${PACKAGE_DIR}/start.sh" << 'EOF'
#!/bin/bash
echo "🚀 启动 Universal Shop (HTTP模式)..."

# 设置生产环境
export NODE_ENV=production

# 检查是否安装了PM2
if command -v pm2 >/dev/null 2>&1; then
    echo "📦 使用PM2启动 (推荐，支持持久化)..."
    pm2 start src/server/index.js --name "universal-shop" --watch --ignore-watch="database node_modules public/uploads"
    pm2 save
    pm2 startup
    echo "✅ 服务已启动！"
    echo "📊 查看状态: pm2 status"
    echo "📋 查看日志: pm2 logs universal-shop"
    echo "🛑 停止服务: pm2 stop universal-shop"
else
    echo "⚠️  PM2未安装，使用普通模式启动..."
    echo "💡 安装PM2获得更好体验: npm install -g pm2"
    node src/server/index.js
fi
EOF

# 生成HTTPS启动脚本
cat > "${PACKAGE_DIR}/start-https.sh" << 'EOF'
#!/bin/bash
echo "🚀 启动 Universal Shop (HTTPS模式)..."

# 检查SSL证书
if [ ! -f "ssl/server.key" ] || [ ! -f "ssl/server.crt" ]; then
    echo "❌ SSL证书不存在，请先生成证书："
    echo "mkdir -p ssl"
    echo "openssl req -x509 -newkey rsa:4096 -keyout ssl/server.key -out ssl/server.crt -days 365 -nodes"
    exit 1
fi

# 设置生产环境
export NODE_ENV=production

# 启动HTTPS服务器
node start-https-production.js
EOF

# 生成停止脚本
cat > "${PACKAGE_DIR}/stop.sh" << 'EOF'
#!/bin/bash
echo "🛑 停止 Universal Shop..."

# 优先使用PM2停止
if command -v pm2 >/dev/null 2>&1; then
    pm2 stop universal-shop || echo "PM2进程未运行"
    pm2 delete universal-shop || echo "PM2进程不存在"
else
    # 备用方案：直接杀进程
    pkill -f "node.*src/server" || pkill -f "node.*start-https-production" || echo "没有运行的进程"
fi

echo "✅ 服务已停止"
EOF

# 设置权限
chmod +x "${PACKAGE_DIR}"/*.sh

# 生成部署指南
cat > "${PACKAGE_DIR}/DEPLOY.md" << 'EOF'
# Universal Shop 部署指南 (v1.2)

## 🚀 快速部署 (推荐PM2)

### 1. 安装PM2 (用于持久化运行)
```bash
npm install -g pm2
```

### 2. 部署应用
```bash
# 1. 安装 (自动初始化管理员)
./install.sh

# 2. 启动服务 (自动使用PM2)
./start.sh

# 3. 访问系统
# 用户端: http://your-server:3000/portal/
# 管理端: http://your-server:3000/admin/
# 账户: admin / 123456
```

## ✨ v1.2版本新特性
- ✅ 推荐码系统完全修复 - 游客下单推荐码正确写入
- ✅ 订单地址系统全面优化 - 完整地址信息管理  
- ✅ 购物车多商品支持 - 数据库约束优化
- ✅ 智能数据库管理 - 开箱即用，自动修复约束
- ✅ 开发体验提升 - 热重载支持（仅开发环境）
- ✅ 订单状态国际化 - 三语言导出支持

## 📊 PM2 管理命令
```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs universal-shop

# 重启服务
pm2 restart universal-shop

# 停止服务
pm2 stop universal-shop

# 删除服务
pm2 delete universal-shop

# 查看监控面板
pm2 monit
```

## 🔧 手动PM2部署
```bash
# 使用配置文件启动
pm2 start ecosystem.config.js

# 保存PM2进程列表
pm2 save

# 设置开机自启
pm2 startup
```

## HTTPS模式 (可选)
```bash
# 1. 生成SSL证书
mkdir -p ssl
openssl req -x509 -newkey rsa:4096 -keyout ssl/server.key -out ssl/server.crt -days 365 -nodes

# 2. 启动HTTPS服务
./start-https.sh
```

## 停止服务
```bash
./stop.sh
```

## 注意事项
- 管理员初始化只能在无管理员时执行
- 首次登录后请立即修改密码
- 生产环境建议使用HTTPS
EOF

# 打包
echo "🗜️ 创建压缩包..."
tar -czf "${PACKAGE_DIR}.tar.gz" "${PACKAGE_DIR}/"
SIZE=$(du -h "${PACKAGE_DIR}.tar.gz" | cut -f1)

# 清理临时目录
rm -rf "${PACKAGE_DIR}/"

echo ""
echo "🎉 打包完成!"
echo "📦 文件: ${PACKAGE_DIR}.tar.gz (${SIZE})"
echo ""
echo "🚀 部署步骤:"
echo "1. 上传: scp ${PACKAGE_DIR}.tar.gz user@server:/path/"
echo "2. 解压: tar -xzf ${PACKAGE_DIR}.tar.gz"
echo "3. 安装: cd ${PACKAGE_DIR} && ./install.sh (自动初始化管理员)"
echo "4. 启动: ./start.sh"
echo ""
echo "📋 管理员: admin / 123456"