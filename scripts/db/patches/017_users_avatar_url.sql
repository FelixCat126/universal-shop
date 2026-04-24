-- 用户个性头像：相对路径存于 avatar_url
ALTER TABLE users ADD COLUMN avatar_url VARCHAR(512);
