-- 历史订单：底价与单笔金额同源时回填 total_amount_thb（与 app.ensureOrderBillingColumns 一致）
UPDATE orders SET total_amount_thb = CAST(total_amount AS REAL)
WHERE total_amount_thb IS NULL;
