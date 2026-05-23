-- 订单泰铢底价快照（便于统计与非 THB 订单核对）
ALTER TABLE orders ADD COLUMN total_amount_thb DECIMAL(10, 2);
