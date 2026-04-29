-- 积分换购订单：本单扣除积分合计
ALTER TABLE orders ADD COLUMN points_redeemed INTEGER;
