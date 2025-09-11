# 数据库迁移指南 - 手机号国际化改造

## 概述

本次更新为系统添加了国际手机号支持，允许用户使用不同国家的区号注册和登录。支持的国家包括：
- 🇨🇳 中国 (+86) - 11位手机号
- 🇹🇭 泰国 (+66) - 9位手机号  
- 🇲🇾 马来西亚 (+60) - 11位手机号

## 变更内容

### 数据库结构变更

#### 用户表 (users)
- ✅ 新增 `country_code` 字段 (VARCHAR(10), NOT NULL, DEFAULT '+86')
- ✅ 创建复合唯一索引 `unique_country_phone` (country_code, phone)
- ✅ 移除原有的 `phone` 单字段唯一约束

#### 地址表 (addresses)
- ✅ 新增 `contact_country_code` 字段 (VARCHAR(10), NOT NULL, DEFAULT '+86')

### 应用逻辑变更

#### 前端变更
- ✅ 用户注册页面：添加国家选择器
- ✅ 用户登录页面：支持手机号+区号登录
- ✅ 地址管理：联系人手机号支持区号选择
- ✅ 结算页面：收货人手机号支持区号
- ✅ 后台管理：用户列表显示完整手机号信息

#### 后端变更  
- ✅ 用户注册API：支持区号验证
- ✅ 用户登录API：支持区号+手机号登录
- ✅ 地址管理API：支持区号保存和验证
- ✅ 手机号格式验证：按国家验证位数

## 迁移前准备

### 1. 备份数据库

```bash
# 备份SQLite数据库
cp database/shop.sqlite database/shop.sqlite.backup.$(date +%Y%m%d_%H%M%S)

# 或者使用SQLite命令
sqlite3 database/shop.sqlite ".backup database/shop_backup_$(date +%Y%m%d_%H%M%S).sqlite"
```

### 2. 停止应用服务

```bash
# 停止所有相关服务
# 确保没有其他进程在使用数据库
```

### 3. 验证环境

```bash
# 检查Node.js版本
node --version

# 检查必要的依赖
npm list sqlite3
```

## 执行迁移

### 方式一：使用JavaScript脚本（推荐）

```bash
# 进入项目根目录
cd universal-shop

# 执行迁移脚本
node src/server/scripts/migrate-country-codes.js
```

脚本会自动：
- ✅ 检查数据库是否存在
- ✅ 验证是否已经执行过迁移
- ✅ 执行SQL迁移
- ✅ 验证迁移结果
- ✅ 提供详细的统计信息

### 方式二：手动执行SQL

```bash
# 使用sqlite3命令行
sqlite3 database/shop.sqlite < src/server/migrations/001-add-country-codes.sql
```

## 迁移验证

迁移完成后，请验证以下内容：

### 1. 数据完整性检查

```sql
-- 检查用户表结构
PRAGMA table_info(users);

-- 验证所有用户都有区号
SELECT COUNT(*) as total, COUNT(country_code) as with_code FROM users;

-- 检查地址表结构  
PRAGMA table_info(addresses);

-- 验证所有地址都有联系人区号
SELECT COUNT(*) as total, COUNT(contact_country_code) as with_code FROM addresses;
```

### 2. 功能测试

- [ ] 用户注册：尝试使用不同国家区号注册
- [ ] 用户登录：使用区号+手机号登录
- [ ] 地址管理：添加和编辑地址时选择国家
- [ ] 后台管理：查看用户列表显示区号信息

## 回滚方案

如果迁移出现问题，可以使用以下方案回滚：

### 1. 恢复备份

```bash
# 恢复备份的数据库
cp database/shop.sqlite.backup.YYYYMMDD_HHMMSS database/shop.sqlite
```

### 2. 移除新增字段（如果需要）

```sql
-- 注意：SQLite不直接支持删除列，需要重建表
-- 建议直接使用备份恢复
```

## 常见问题

### Q: 迁移脚本显示"已经执行过迁移"？
A: 脚本检测到数据库已包含新字段。如果确需重新执行，请先恢复备份或手动删除相关字段。

### Q: 现有用户数据会丢失吗？  
A: 不会。所有现有用户和地址都会保留，并自动设置为中国区号(+86)。

### Q: 如何处理重复的手机号？
A: 迁移后，原本重复的手机号会被认为是不同国家的号码。如有需要，请手动检查和清理。

### Q: 手机号格式验证规则是什么？
A: 
- 中国(+86): 11位，以1开头
- 泰国(+66): 9位，以2-9开头  
- 马来西亚(+60): 11位，以1开头

## 注意事项

⚠️ **重要警告**
1. 请务必在生产环境执行前在测试环境完整验证
2. 迁移过程中请勿中断，可能导致数据不一致  
3. 建议在业务低峰期执行迁移
4. 确保有可靠的数据库备份

✅ **最佳实践**
1. 先在开发环境测试完整流程
2. 准备回滚方案和时间窗口
3. 通知相关用户可能的服务中断
4. 迁移后进行全面功能测试

## 技术支持

如果在迁移过程中遇到问题，请：

1. 检查错误日志获取详细信息
2. 确认数据库文件权限和磁盘空间
3. 验证SQL语法和数据完整性
4. 必要时使用备份恢复数据

---

**迁移文档版本**: v1.0  
**最后更新**: 2024年12月  
**适用版本**: Universal Shop v1.x
