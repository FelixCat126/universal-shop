-- 订单记账币种
ALTER TABLE orders ADD COLUMN currency_code VARCHAR(10) NOT NULL DEFAULT 'THB';
