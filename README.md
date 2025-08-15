# Universal Shop - 轻量化商城系统

一个基于 Vue 3 + Node.js 的现代化商城系统，支持用户门户和管理后台。

## 快速开始

### 本地开发
```bash
npm install
npm run dev
```

### 生产部署
```bash
# 1. 打包
./package.sh

# 2. 上传到服务器并解压
tar -xzf universal-shop-v*.tar.gz
cd universal-shop-v*

# 3. 一键安装
./install.sh

# 4. 启动服务
./start.sh
```

## 访问地址

- **用户门户**: http://your-server:3000/portal
- **管理后台**: http://your-server:3000/admin
- **API接口**: http://your-server:3000/api

## 默认账户

- **管理员**: admin / admin123

## 技术栈

- **前端**: Vue 3, Vite, Element Plus, Tailwind CSS
- **后端**: Node.js, Express, Sequelize
- **数据库**: SQLite
- **部署**: 支持HTTP/HTTPS，自动SSL证书

## 系统要求

- Node.js 18+
- 支持Linux服务器部署
- 推荐2GB+内存

## 更多信息

详细部署指南请查看 [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

## 许可证

MIT License
