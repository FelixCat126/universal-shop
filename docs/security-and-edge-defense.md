# 安全与边界防御部署指南

> 本文档与代码层加固（Batch 1-4）配套。代码层只能做"最后一道墙"，**真正的 DDoS / 撞库 / 爬虫**应在 Nginx + 阿里云 WAF 层拦截。

## 1. 环境变量（生产必须配置）

| 变量 | 用途 | 示例 |
|---|---|---|
| `NODE_ENV` | 生产模式（启用 CSP、关 CSP 调试、winston 落盘） | `production` |
| `JWT_SECRET` | JWT 签名密钥（≥ 32 字符） | `openssl rand -hex 32` |
| `INIT_SECRET` | `/api/admin/init` 初始化口令 | `openssl rand -hex 32` |
| `INIT_ADMIN_PASSWORD` | 初始超管密码（≥ 8 字符） | 强随机 |
| `ALLOWED_ORIGINS` | CORS 白名单（逗号分隔） | `https://shop.example.com,https://admin.example.com` |
| `TRUST_PROXY` | 反代信任跳数（Nginx 在前面=1） | `1` |
| `LOG_DIR` | 日志目录 | `/var/log/universal-shop` |
| `RATE_LIMIT_DISABLED` | 内网压测时可临时设 `1`，**生产必为空** | — |
| `DB_DIALECT` | `sqlite` 或 `postgres`（迁移后） | `postgres` |
| `DATABASE_URL` | PG 连接串（迁移后） | `postgres://user:pwd@host:5432/shop` |
| `PG_POOL_MAX` | PG 连接池上限 | `20` |

## 2. Nginx 配置范本（与 trust proxy=1 配合）

```nginx
# /etc/nginx/conf.d/shop.conf

# 限流区：每 IP 30 次/分（CC 防护）
limit_req_zone $binary_remote_addr zone=api_lim:10m rate=30r/s;
limit_conn_zone $binary_remote_addr zone=api_conn:10m;

upstream shop_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name shop.example.com admin.example.com partner.example.com;

    ssl_certificate     /etc/ssl/shop.crt;
    ssl_certificate_key /etc/ssl/shop.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # 安全头由后端 helmet 也会写一遍；Nginx 这一道是兜底
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # 上传体积上限：单请求 ≤ 8MB（multer 单文件 2MB，多余给 form 字段）
    client_max_body_size 8m;

    # 全站连接数限制
    limit_conn api_conn 50;

    # 静态资源：直接命中 dist/，不打到 Node
    location ~ ^/(portal|admin|partner)/assets/ {
        alias /opt/universal-shop/dist/$1/assets/;
        access_log off;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # API：CC 限流 + 反代
    location /api/ {
        limit_req zone=api_lim burst=60 nodelay;
        proxy_pass http://shop_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }

    # SPA / 静态托管
    location / {
        proxy_pass http://shop_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTP→HTTPS 跳转
server {
    listen 80;
    server_name shop.example.com admin.example.com partner.example.com;
    return 301 https://$host$request_uri;
}
```

## 3. 阿里云 WAF / Anti-Bot 配置项

- 在 WAF 控制台为域名打开：
  - **Bot 防护**：动作"拦截"，模式"严格"。
  - **CC 防护**：模式"严格"，URL 频次匹配 `/api/users/login`、`/api/admin/login`、`/api/partner/login` 单独配 `5 次/分钟/IP`。
  - **数据风控**：登录、下单、支付确认接口启用滑块/二次验证。
  - **Web 防护规则**：开启常见漏洞规则集（SQLi/XSS/路径穿越）。
- 启用 **黑名单/白名单**：把内部办公 IP 加白；把已识别的爬虫段加黑。
- 启用 **API 防护**：基于 OpenAPI Schema 校验请求字段（与代码 joi 双重防线）。

## 4. fail2ban（备用，纯主机防护）

`/etc/fail2ban/jail.d/nginx-cc.conf`：
```
[nginx-cc]
enabled = true
port    = http,https
filter  = nginx-cc
logpath = /var/log/nginx/access.log
maxretry = 200
findtime = 60
bantime = 3600
```

## 5. 审计建议

- 登录失败、支付确认、订单状态变更应统一进入 `OperationLog`（目前仅管理员路由覆盖；后续可拓展到普通用户/合作方）。
- 日志（`logs/error.log`、`logs/combined.log`）按天滚动，14 天保留；接入 ELK / SLS 做集中检索。
- 保留 `database/shop.sqlite*` 每日快照（迁 PG 后改为 PG `pg_dump`）。
