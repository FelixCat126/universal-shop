-- 补齐历史行 currency_code
UPDATE orders SET currency_code = 'THB'
WHERE currency_code IS NULL OR trim(currency_code) = '';
