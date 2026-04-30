-- 合作方地址与零售对齐：府/县层级 + 邮编
ALTER TABLE partner_addresses ADD COLUMN city VARCHAR(100);
ALTER TABLE partner_addresses ADD COLUMN postal_code VARCHAR(10);
