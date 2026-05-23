-- 合作方地址：手机国家区号（与零售 addresses 对齐）
ALTER TABLE partner_addresses ADD COLUMN phone_country_code VARCHAR(10) NOT NULL DEFAULT '+66';
