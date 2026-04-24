-- 产品软删除：仅补列；索引由 Sequelize sync 根据模型创建（避免先于列存在而建索引失败）
ALTER TABLE products ADD COLUMN deleted_at DATETIME;
