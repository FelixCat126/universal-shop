-- 手机号国际化改造数据库迁移脚本
-- 版本: 001
-- 创建时间: 2024-12-XX
-- 说明: 为用户表和地址表添加国家区号支持，支持中国(+86)、泰国(+66)、马来西亚(+60)

BEGIN TRANSACTION;

-- 1. 为用户表添加 country_code 字段
ALTER TABLE users ADD COLUMN country_code VARCHAR(10) DEFAULT '+86';

-- 2. 为现有用户设置默认区号（中国 +86）
UPDATE users SET country_code = '+86' WHERE country_code IS NULL;

-- 3. 设置字段为NOT NULL
-- 注意：SQLite不支持直接修改列为NOT NULL，我们通过重新创建表来实现

-- 创建临时表
CREATE TABLE users_temp AS SELECT * FROM users;

-- 删除原表
DROP TABLE users;

-- 重新创建用户表（包含所有字段和约束）
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username VARCHAR(100) UNIQUE,
  email VARCHAR(100) UNIQUE,
  nickname VARCHAR(50) NOT NULL,
  country_code VARCHAR(10) NOT NULL DEFAULT '+86',
  phone VARCHAR(20) NOT NULL,
  password VARCHAR(255) NOT NULL,
  referral_code VARCHAR(20) UNIQUE,
  referred_by_code VARCHAR(20),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME
);

-- 插入数据到新表
INSERT INTO users (
  id, username, email, nickname, country_code, phone, password, 
  referral_code, referred_by_code, created_at, updated_at, 
  is_active, last_login_at
) SELECT 
  id, username, email, nickname, 
  COALESCE(country_code, '+86') as country_code, 
  phone, password, referral_code, referred_by_code, 
  created_at, updated_at, is_active, last_login_at
FROM users_temp;

-- 删除临时表
DROP TABLE users_temp;

-- 创建复合唯一索引：国家区号+手机号组合唯一
CREATE UNIQUE INDEX unique_country_phone ON users(country_code, phone);

-- 4. 为地址表添加 contact_country_code 字段
ALTER TABLE addresses ADD COLUMN contact_country_code VARCHAR(10) DEFAULT '+86';

-- 5. 为现有地址设置默认区号（中国 +86）
UPDATE addresses SET contact_country_code = '+86' WHERE contact_country_code IS NULL;

-- 6. 重新创建地址表以添加NOT NULL约束
CREATE TABLE addresses_temp AS SELECT * FROM addresses;

DROP TABLE addresses;

CREATE TABLE addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  contact_name VARCHAR(100) NOT NULL,
  contact_country_code VARCHAR(10) NOT NULL DEFAULT '+86',
  contact_phone VARCHAR(20) NOT NULL,
  province VARCHAR(50),
  city VARCHAR(50),
  district VARCHAR(50),
  detail_address TEXT NOT NULL,
  full_address TEXT NOT NULL,
  postal_code VARCHAR(10),
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  address_type VARCHAR(20) DEFAULT 'home',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE NO ACTION ON UPDATE CASCADE
);

-- 插入数据到新地址表
INSERT INTO addresses (
  id, user_id, contact_name, contact_country_code, contact_phone,
  province, city, district, detail_address, full_address,
  postal_code, is_default, address_type, created_at, updated_at
) SELECT 
  id, user_id, contact_name, 
  COALESCE(contact_country_code, '+86') as contact_country_code, 
  contact_phone, province, city, district, detail_address, 
  full_address, postal_code, is_default, address_type, 
  created_at, updated_at
FROM addresses_temp;

-- 删除临时表
DROP TABLE addresses_temp;

-- 创建索引
CREATE INDEX addresses_user_id ON addresses(user_id);
CREATE INDEX addresses_is_default ON addresses(is_default);

-- 7. 验证数据完整性
-- 检查用户表
SELECT 
  COUNT(*) as total_users,
  COUNT(CASE WHEN country_code IS NULL THEN 1 END) as null_country_codes,
  COUNT(CASE WHEN country_code = '+86' THEN 1 END) as china_users,
  COUNT(CASE WHEN country_code = '+66' THEN 1 END) as thailand_users,
  COUNT(CASE WHEN country_code = '+60' THEN 1 END) as malaysia_users
FROM users;

-- 检查地址表  
SELECT 
  COUNT(*) as total_addresses,
  COUNT(CASE WHEN contact_country_code IS NULL THEN 1 END) as null_contact_codes,
  COUNT(CASE WHEN contact_country_code = '+86' THEN 1 END) as china_addresses,
  COUNT(CASE WHEN contact_country_code = '+66' THEN 1 END) as thailand_addresses,
  COUNT(CASE WHEN contact_country_code = '+60' THEN 1 END) as malaysia_addresses
FROM addresses;

COMMIT;

-- 迁移完成提示
SELECT 'Database migration completed successfully' as status;
