# Universal Shop 部署指南

## 项目重构说明

✅ **已完成的重构工作：**
- 删除了所有混乱的旧打包和安装脚本
- 创建了全新的专业级打包脚本 `package.sh`
- 集成了开箱即用的安装脚本
- 支持阿里云部署要求
- 支持动态IP地址检测和配置
- 自动SSL证书生成
- 完整的防火墙配置

## 新的打包和部署流程

### 1. 本地打包

在项目根目录下运行：

```bash
# 运行打包脚本
./package.sh
```

打包脚本会：
- 自动检测项目环境
- 安装依赖并构建前端应用
- 创建包含安装脚本的完整打包文件
- 生成SHA256校验文件
- 打包到独立文件夹（解压时不会污染当前目录）

### 2. 测试打包功能

```bash
# 运行测试脚本（可选）
./test-package.sh
```

### 3. 服务器部署

#### 3.1 上传文件
将生成的 `universal-shop-v*.tar.gz` 上传到服务器

#### 3.2 解压安装包
```bash
tar -xzf universal-shop-v*.tar.gz
cd universal-shop-v*
```

#### 3.3 运行安装脚本
```bash
./install.sh
```

安装脚本会自动：
- 检测服务器网络配置（本地IP、公网IP）
- 让用户选择访问地址（公网IP/本地IP/域名/localhost）
- 检查系统环境（Node.js、npm、OpenSSL等）
- 安装生产环境依赖
- 生成SSL证书（如果选择HTTPS模式）
- 配置环境变量和前端配置
- 初始化数据库
- 创建启动脚本
- 配置防火墙
- 显示完整的访问信息

#### 3.4 启动系统
```bash
./start.sh
```

## 部署特性

### ✅ 阿里云专项适配
- 自动检测公网IP和内网IP
- 支持阿里云安全组端口配置提醒
- 自动生成适配阿里云的SSL证书
- 支持HTTPS和HTTP两种模式
- 防火墙自动配置（UFW/FirewallD）

### ✅ 动态IP支持
- 安装时自动检测服务器IP地址
- 支持公网IP、内网IP、域名、localhost四种模式
- 自动更新前端配置文件中的API地址
- 环境变量自动配置服务器地址

### ✅ 开箱即用特性
- 一键安装，无需手动配置
- 自动生成所有必要的配置文件
- 自动创建启动、停止、重启脚本
- 完整的错误处理和用户提示
- 详细的部署说明和故障排除指南

### ✅ 安全特性
- 自动生成强随机JWT密钥
- SSL证书自动生成和配置
- 文件权限自动设置
- 安全头配置
- 默认账户提醒

## 系统要求

- **Node.js**: 18+ 版本
- **系统**: Linux (Ubuntu/CentOS/Debian等)
- **内存**: 建议2GB+
- **存储**: 建议10GB+
- **网络**: 需要开放3000端口(HTTP)和3443端口(HTTPS)

## 访问地址

安装完成后，系统提供以下访问地址：

- **用户门户**: `https://your-server-ip:3443/portal`
- **管理后台**: `https://your-server-ip:3443/admin`
- **API接口**: `https://your-server-ip:3443/api`
- **HTTP重定向**: `http://your-server-ip:3000` (自动跳转到HTTPS)

## 默认账户

- **管理员**: `admin` / `admin123`
- **测试用户**: `13800138001` / `123456`

⚠️ **安全提醒**: 部署后请立即修改默认密码

## 系统管理

```bash
# 启动服务
./start.sh

# 停止服务
./stop.sh

# 重启服务
./restart.sh

# 后台运行
nohup ./start.sh > app.log 2>&1 &

# 查看日志
tail -f app.log
```

## 故障排除

### 1. 端口占用问题
```bash
# 检查端口占用
lsof -i :3000
lsof -i :3443

# 停止占用端口的进程
./stop.sh
```

### 2. 权限问题
```bash
# 修复脚本权限
chmod +x *.sh

# 检查SSL证书权限
ls -la ssl/
```

### 3. 防火墙配置
```bash
# Ubuntu/Debian
sudo ufw allow 3000/tcp
sudo ufw allow 3443/tcp

# CentOS/RHEL
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --permanent --add-port=3443/tcp
sudo firewall-cmd --reload
```

### 4. 阿里云安全组
在阿里云控制台配置安全组规则：
- 入方向：开放3000/tcp端口
- 入方向：开放3443/tcp端口
- 来源：0.0.0.0/0

## 技术架构

- **前端**: Vue 3 + Vite + Element Plus + Tailwind CSS
- **后端**: Node.js + Express + Sequelize
- **数据库**: SQLite
- **部署**: HTTPS/HTTP双模式，自签名证书
- **文件上传**: 本地存储
- **多语言**: 中文/英语/泰语

## 目录结构

```
universal-shop-v*/
├── src/                    # 源代码
│   ├── server/            # 后端代码
│   ├── portal/            # 用户门户源码
│   ├── admin/             # 管理后台源码
│   └── config/            # 配置文件
├── dist/                  # 构建后的前端文件
│   ├── portal/           # 构建后的用户门户
│   └── admin/            # 构建后的管理后台
├── database/              # 数据库文件目录
├── public/uploads/        # 文件上传目录
├── ssl/                   # SSL证书目录
├── logs/                  # 日志文件目录
├── install.sh            # 一键安装脚本
├── start.sh              # 启动脚本
├── stop.sh               # 停止脚本
├── restart.sh            # 重启脚本
├── .env                  # 环境变量配置
├── package.json          # 项目依赖
└── README.md             # 项目说明
```

## 更新说明

相比之前的混乱脚本，新版本具有以下改进：

1. **结构清晰**: 统一的打包脚本，包含完整的安装逻辑
2. **错误处理**: 完善的错误处理和回滚机制
3. **用户友好**: 详细的进度提示和操作指导
4. **功能完整**: 支持所有必要的配置和优化
5. **安全可靠**: 自动SSL证书、权限设置、安全配置
6. **部署简单**: 真正的开箱即用，无需手动配置

## 技术支持

如遇到问题，请：
1. 查看安装日志和错误信息
2. 检查系统要求是否满足
3. 确认网络和防火墙配置
4. 查看应用日志文件

---

**注意**: 此部署指南基于最新重构的打包和安装脚本，旧版本的脚本已被删除。
