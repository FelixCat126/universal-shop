-- 将合作方数量步长改为 1（仅保留下限 50，50 以上逐件可调）
UPDATE system_configs SET config_value = '1', description = '合作方单 SKU 增量步长（1=仅下限起订后可逐件递增）' WHERE config_key = 'partner_order_moq_multiplier';
