-- 用户积分余额（复合主键 user_id）
CREATE TABLE IF NOT EXISTS user_point_balances (
  user_id INTEGER NOT NULL PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
