-- 订单行兑换消耗积分快照
ALTER TABLE order_items ADD COLUMN points_line_cost INTEGER;
