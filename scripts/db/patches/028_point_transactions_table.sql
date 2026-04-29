-- 积分流水（与 Sequelize PointTransaction 一致）
CREATE TABLE IF NOT EXISTS point_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_id INTEGER,
  type VARCHAR(24) NOT NULL,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  note VARCHAR(255),
  created_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_point_tx_user_created ON point_transactions(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_point_tx_order ON point_transactions(order_id);
