# 阿里云 CDN 接入 eshop 的配置清单

## 为什么现在做这件事

第 52 轮把三件事做完了一半：

| 项 | 状态 |
|---|---|
| nginx 升级到 1.30.7 + HTTP/3 | ✅ 已上线（**待安全组放行 UDP 443 才生效**） |
| nginx 层 gzip（静态资源 288KB → 106KB，**-63%**） | ✅ 已上线 |
| 阿里云 CDN（边缘节点） | ⏳ **需要你在控制台操作**（我没有云凭证） |

**CDN 的收益说实话**：这个站点的真实流量很小（全部 6 个域名当天合计 3436 个请求，
其中大半是互联网扫描器），CDN 省下来的**带宽**有限。
它真正改善的是**首字节延迟** —— 而这正是这个站点一直以来的痛点
（客户端到这台 ECS 的链路有 TCP SYN 丢包 → 1s RTO 重传）。

**HTTP/3 已经先一步对症**（QUIC 的首包冗余正好绕开 SYN 丢包），
CDN 是第二层保险（边缘节点离用户更近，握手往返更少）。

**如果暂时不打算买 CDN**，现在这套（HTTP/3 + gzip）已经把大头拿走了 ——
静态资源传输量降了 63%，首字节问题由 QUIC 兜住。

---

## 一、接入前必须确认的前置条件（已全部就绪 ✓）

| 前置条件 | 状态 |
|---|---|
| 源站 HTTPS 可用（`https://eshop.cider-bar.com`） | ✅ 自签 Let's Encrypt，TLS 1.3 |
| 静态资源有长缓存头 | ✅ `Cache-Control: public, max-age=604800, immutable`（Vite 哈希文件名） |
| SPA 的 index.html 不缓存 | ✅ `no-cache, no-store, must-revalidate` |
| **API 不会被缓存** | ✅ 第 52 轮新加：API 一律 `no-store`（此前**完全没有 Cache-Control 头**，CDN 会默认缓存 GET API → 下单后订单列表滞后） |
| 源站不限制回源 IP | ✅ nginx 无 allow/deny，CDN 回源不受阻 |
| 回源 Host 头正确 | ✅ CDN 回源带 `Host: eshop.cider-bar.com` → 命中 eshop 的 server 块 |

> ⚠️ **API 缓存头这一条是接 CDN 的前置条件**。没有它，CDN 配再精细也会缓存到 API。
> 第 52 轮已经补上（`src/server/app.js` 的中间件 + `tests/api/apiCacheControlGuard.test.js` 守着）。

---

## 二、控制台操作步骤

### 1. 创建 CDN 域名

- 阿里云控制台 → **CDN** → 创建加速域名
- **加速域名**：`eshop.cider-bar.com`
- **源站类型**：IP 地址 → `47.100.1.250`
- **源站端口**：`443`
- **回源协议**：`HTTPS`（回源域名留空或填 `eshop.cider-bar.com`）
- **业务类型**：下载/音视频加速 → 选「**小文件**」或「图片」不适合；选 **Web** 加速即可

### 2. HTTPS 证书

- 加速域名证书：可以「上传证书」用现成的
  `/etc/letsencrypt/live/cider-bar-subs/fullchain.pem` + `privkey.pem`
  （SAN 证书已覆盖 `eshop.cider-bar.com`）
- 也可以选阿里云免费证书（DV），但要重新签发并等 DNS 生效

### 3. 缓存规则（**最关键的一步**）

> ⚠️ **源站用的 `s-maxage` 而不是 `max-age`** —— 区别很大：
> `max-age` 会让**浏览器也缓存**（管理端新建商品后刷新仍看到旧列表），
> `s-maxage` **只给 CDN / 共享代理缓存**，浏览器每次都回源。
> 所以 CDN 侧的缓存规则与源站的 `s-maxage` 是**一致的**，不会打架。

| 路径 | 规则 | 说明 |
|---|---|---|
| `/portal/assets/*`、`/admin/assets/*`、`/partner/assets/*` | 缓存 **30 天** | Vite 哈希文件名，内容变了文件名就变 |
| `/uploads/*` | 缓存 **30 天** | 图片/上传文件 |
| `/api/*` | **不缓存** | 源站已给 `no-store`，这里再配一次是双保险 |
| `/api/products`、`/api/product-categories`、`/api/system-config/public` | 缓存 **60s** | 源站给的是 `s-maxage=60`（**只给 CDN 缓存，浏览器不缓存**）→ 运营在后台改完商品，刷新立刻能看到 |
| `/portal`、`/admin`、`/partner`（SPA 首页） | **不缓存** | index.html 引用哈希文件名，缓存了会导致部署后仍加载旧 JS |
| 其它 | 缓存 **5 分钟** | 兜底 |

> 阿里云 CDN 的规则**优先于**源站的 Cache-Control，但两者都配上最稳。

### 4. DNS 解析

- 把 `eshop.cider-bar.com` 的 A 记录改成 **CNAME → CDN 分配的 CNAME**
  （控制台会给出，形如 `eshop.cider-bar.com.w.kunlun*.com`）
- **CNAME 生效需要时间**（通常几分钟到半小时）
- ⚠️ 切换期间 DNS 会同时存在记录，注意**先加 CNAME 再删 A**，否则会有中断

### 5. 验证

```bash
# 1. DNS 已指向 CDN
dig +short CNAME eshop.cider-bar.com

# 2. 响应头出现 CDN 的特征头（阿里云 CDN 是 X-Cache: HIT / Via: ...）
curl -sI https://eshop.cider-bar.com/portal/assets/index-*.js | grep -iE 'x-cache|via|age'

# 3. 静态资源命中缓存（Age 头 > 0 表示是缓存里的）
curl -sI https://eshop.cider-bar.com/portal/assets/index-*.js | grep -i '^age'

# 4. API 没有被缓存
curl -sI https://eshop.cider-bar.com/api/products | grep -i cache-control
```

### 6. 回滚

DNS 改回 A 记录 `47.100.1.250` 即可，源站完全不用动。

---

## 三、接 CDN 后要复查的

- [ ] 客户下单后，订单列表**立刻**能看到新订单（API 没被缓存）
- [ ] 运营改商品价格后，前台**一分钟内**生效（商品接口 60s 缓存）
- [ ] 部署新版本后，浏览器拿到的是**新**的 JS（index.html 没被缓存）
- [ ] 静态资源的 `Age` 头在增长（说明确实命中了边缘缓存）

## 四、别忘的另一件事

**UDP 443**：HTTP/3 需要阿里云安全组放行 UDP 443。
不放行的话，nginx 会监听 UDP 443 但外部连不上 → 客户端自动回退 HTTP/2（不坏，但没收益）。
