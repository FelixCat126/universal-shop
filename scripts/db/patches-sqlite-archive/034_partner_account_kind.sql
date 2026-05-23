-- 合作方账号类别：经销商 dealer（默认）、代理 agent
ALTER TABLE partners ADD COLUMN account_kind VARCHAR(16) NOT NULL DEFAULT 'dealer';
