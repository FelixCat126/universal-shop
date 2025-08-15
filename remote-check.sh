#!/bin/bash

# 远程检查数据库脚本
SERVER="47.100.1.250"

echo "🔍 检查服务器 ${SERVER} 上的数据库状态..."

# 上传检查脚本
echo "📤 上传检查脚本..."
scp check-db.js root@${SERVER}:/tmp/

# 在服务器上执行检查
echo "🔍 执行数据库检查..."
ssh root@${SERVER} << 'EOF'
cd /home/app/universal-shop-v1.0.0 2>/dev/null || cd /tmp/universal-shop-v1.0.0 2>/dev/null || cd /root/universal-shop-v1.0.0 2>/dev/null || {
  echo "❌ 找不到项目目录"
  echo "请告知项目的实际路径"
  exit 1
}

echo "📍 当前目录: $(pwd)"

# 复制检查脚本到项目目录
cp /tmp/check-db.js ./

# 运行检查
node check-db.js

# 清理
rm -f check-db.js /tmp/check-db.js
EOF

echo "✅ 检查完成"
