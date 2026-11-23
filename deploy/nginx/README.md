# 生产 nginx 配置快照

## 这是什么

`conf.d/` 是**生产机 `/etc/nginx/conf.d/` 的快照**（2026-11-23 采集）。

## 为什么要有它

这台机器上 **6 个域名站点共用同一个 nginx**：

| 域名 | 后端 | 归属 |
|---|---|---|
| `cider-bar.com` / `www.` | `127.0.0.1:3002`（cider_web docker） | 批发商城 |
| `eshop.cider-bar.com` | `127.0.0.1:3000`（PM2） | **本项目（universal-shop）** |
| `ctime.cider-bar.com` | `127.0.0.1:13100`（next-server） | ctime |
| `game.cider-bar.com` | 静态目录 `/var/www/game.cider-bar.com/site` | game |
| `mp.cider-bar.com` | `127.0.0.1:8787`（aether-gateway） | motorprice |
| `robot.cider-bar.com` | `127.0.0.1:8080`（PM2） | robot-cockpit |

**部署脚本不管理 `/etc/nginx`**（`scripts/deploy-on-server.sh` 的 rsync 只同步项目目录），
所以在这之前，生产 nginx 配置**完全没有版本控制** ——
改了什么、为什么改，只能靠记忆和服务器上的历史文件。

这份快照解决两件事：
1. **可追溯**：改了哪些配置、为什么改，仓库里有记录
2. **可恢复**：机器重建 / 配置被误改时，有一份可对照的基线

## ⚠️ 重要：改这里**不会**自动生效

生效的是服务器上的 `/etc/nginx/conf.d/`。改完仓库里的文件，要手动同步：

```bash
scp deploy/nginx/conf.d/*.conf root@<host>:/etc/nginx/conf.d/
ssh root@<host> 'nginx -t && systemctl reload nginx'
```

**服务器上的才是权威**，仓库这份是**快照**。两者不一致时以服务器为准，
但差异本身通常意味着"有人改了服务器没同步仓库" —— 那是需要补的债。

## 只改了 eshop 的哪些地方

第 52 轮只动了 `eshop.conf`（本项目自己的站点），**其余站点配置一字未改**：

1. **HTTP/3（QUIC）**
   ```nginx
   listen 443 ssl;
   listen 443 quic reuseport;
   http2 on;
   ```
   需要阿里云安全组放行 **UDP 443**（TCP 443 早已放行）。
   未放行也不会坏 —— 客户端自动回退 HTTP/2，只是没有 QUIC 收益。

2. **gzip**
   静态资源（`/portal/assets/*.js`，288KB）此前**完全未压缩** ——
   Express 的 `compression()` 只管得到达应用层的响应，
   而静态文件是 nginx 直接吐的，绕过了它。
   放在 server 块内，**只影响本站点**。

## 证书

所有站点共用一张 SAN 证书 `/etc/letsencrypt/live/cider-bar-subs/`
（覆盖 eshop / ctime / game / mp / robot 五个域名），由 certbot 续期。

**certbot 用的是 nginx authenticator + installer** —— 续期时会**改写配置并 reload nginx**。
换 nginx 版本后必须验一次：

```bash
certbot renew --dry-run
```
