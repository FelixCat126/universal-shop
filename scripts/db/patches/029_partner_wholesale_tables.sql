-- B 端合作方：账号、批发订单（不占零售 inventory）
CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login VARCHAR(64) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  discount_percent DECIMAL(6, 2) NOT NULL DEFAULT 0,
  tier_discount_json TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at DATETIME,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_partners_login ON partners(login);
CREATE INDEX IF NOT EXISTS idx_partners_is_active ON partners(is_active);

CREATE TABLE IF NOT EXISTS partner_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL,
  order_no VARCHAR(50) NOT NULL UNIQUE,
  currency_code VARCHAR(10) NOT NULL DEFAULT 'THB',
  total_amount_thb DECIMAL(12, 2) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'submitted',
  notes TEXT,
  contact_name VARCHAR(100),
  contact_phone VARCHAR(32),
  delivery_address TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (partner_id) REFERENCES partners(id)
);

CREATE INDEX IF NOT EXISTS idx_partner_orders_partner_created ON partner_orders(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_orders_status ON partner_orders(status);

CREATE TABLE IF NOT EXISTS partner_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  base_unit_thb DECIMAL(12, 2) NOT NULL,
  unit_price_thb DECIMAL(12, 2) NOT NULL,
  line_total_thb DECIMAL(12, 2) NOT NULL,
  partner_discount_percent_snapshot DECIMAL(6, 2) NOT NULL DEFAULT 0,
  product_name_snapshot VARCHAR(255),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (partner_order_id) REFERENCES partner_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_partner_order_items_order ON partner_order_items(partner_order_id);
CREATE INDEX IF NOT EXISTS idx_partner_order_items_product ON partner_order_items(product_id);
