-- 容器首次启动时，由 docker-entrypoint-initdb.d 自动执行：
-- 默认 POSTGRES_DB 由环境变量创建（如 shop_dev），这里再额外创建测试库。
CREATE DATABASE shop_test;
GRANT ALL PRIVILEGES ON DATABASE shop_test TO shop;
