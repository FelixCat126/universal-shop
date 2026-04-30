-- 合作方收货地址（与普通用户 addresses 分离）
CREATE TABLE IF NOT EXISTS partner_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL,
  recipient_name VARCHAR(100) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  province VARCHAR(100),
  district VARCHAR(100),
  detail TEXT NOT NULL,
  label VARCHAR(64),
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (partner_id) REFERENCES partners(id)
);

CREATE INDEX IF NOT EXISTS idx_partner_addresses_partner ON partner_addresses(partner_id);

-- 订单可选用地址（历史订单仍保留当时联系人/收货文本快照）
-- SQLite ALTER 无外键强制执行时仅存引用关系
ALTER TABLE partner_orders ADD COLUMN partner_address_id INTEGER;

-- 行明细图片快照（对账展示）
ALTER TABLE partner_order_items ADD COLUMN product_image_snapshot VARCHAR(512);
