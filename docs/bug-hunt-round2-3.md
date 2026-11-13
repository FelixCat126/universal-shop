# 真问题排查 · 第 2–3 轮（2026-11-12 ~ 11-13）

第 1 轮见 [bug-hunt-2026-11.md](./bug-hunt-2026-11.md)。本文记录第 2、3 轮。

**方法**（三轮通用）：
1. 分角度并行排查（每轮换一个**此前没覆盖过**的面）
2. 每条结论**我自己独立复核**——读代码 + 写复现测试
3. 修完**反向验证**：撤掉修复，确认测试真的会变红
4. 黑白盒实测：生产库 EXPLAIN / pg_stat、生产日志、生产 Redis 与 PM2 状态
5. 全量回归 → 上线 → 核对生产数据没变

---

## 第 2 轮：安全与输入边界

### 修掉的

| # | 问题 | 后果 | 位置 |
|---|---|---|---|
| 1 | **系统配置值被当路径拼接 → 任意文件删除**：`setConfig` 对 value 零校验，管理员把 `home_banner` 设成 `../../../../etc/passwd`，删除时 `path.join` 归一化后逃出 `public/` → unlink 删掉任意文件（删 `.env` → JWT 密钥丢失 → **全站掉线**） | 资损级 | `systemConfigController.js` |
| 2 | **导出任务失败 → 句柄与临时文件永久泄漏**：导出器的 fd/写流在**创建时**就打开，只有成功路径才关；失败时 fd 累积到 ulimit 后**进程所有文件操作一起失败**，临时文件每次失败留一份，而清理只回收"任务表里有 file_path 的行"，**孤儿永远收不回来** | 磁盘/句柄泄漏 | `csvExporter.js`、`excelWorkbook.js`、`exportJobService.js` |
| 3 | **清理不回收孤儿文件**：实测本地 tmp 目录堆了 **80+ 个**跨 4 天的导出文件 | 磁盘被吃满 | `exportJobService.js` |
| 4 | **用户/合作方 CSV 导出无上限全表读进内存**（20 万行 → 1GB 峰值，还把 `password_hash` 一并载入） | OOM | `userCsvService.js`、`partnerCsvService.js` |
| 5 | **图片解码不限像素**：2MB 的压缩 PNG 能解出 0.8~1GB 内存（multer 限的是压缩后字节数，不是解码尺寸；sharp 默认上限 2.68 亿像素≈不限制） | OOM | `imageProcessor.js` |
| 6 | **`safeRedirectPath` 白名单可被 `..` 归一化绕过**：`'/..//evil.com'` 归一化后 pathname 变成 `//evil.com`，而 `startsWith('//')` 的判断发生在归一化**之前** → 登录后跳 404；若接到 `window.location` 就是开放重定向 | 跳转失效/潜在开放重定向 | `src/utils/safeRedirect.js` |
| 7 | **HTTPS 入口用未校验的 Host 头拼重定向**：`Host: evil.com` → `301 Location: https://evil.com/...`，可被 CDN 缓存成 web cache poisoning | 开放重定向 | `start-https-production.js` |
| 8 | **管理员/合作方 token 过期被记成 error + 完整 stack**：生产日志里最近仅有的两条"错误"全是它（管理员 8 小时不登录就过期，是**常态**）→ 真问题反而看不见 | 日志噪音淹没真错误 | `adminAuthMiddleware.js`、`partnerAuthMiddleware.js` |
| 9 | **畸形 URL（`/%c0`）→ 500**（errorHandler 没接 URIError） | 500 | `errorHandler.js` |

> 关于 #7：生产走 `src/server/index.js`（PM2），**不用** `start-https-production.js` → 线上未受影响；但发行包里带着它，仍属隐患，已修。

### 排除的（不是 bug）

- **XSS：0 条真问题**。三端 57 个 `.vue` 里 `v-html` 出现 **0** 次；无 `innerHTML/outerHTML/document.write`；无 `iframe/object/embed`；Element Plus 未用 `dangerouslyUseHTMLString`。所有用户可控内容都走 `{{ }}` 自动转义。
- **上传链路干净**：`fileFilter`（MIME + 扩展名白名单）→ UUID 改名落盘（不用用户文件名）→ `fileTypeFromFile` 魔数校验；扩展名白名单不含 `.html/.svg/.js`，helmet 开了 `nosniff` + CSP → **存不了也执行不了**。
- **导出路径不是参数拼的**：`file_path` 全部来自 DB，`ExportJob` 表没有任何接口可写它 → **不能改成读任意文件**。
- **静态服务没暴露敏感目录**：只挂 `public/uploads` 与三个前端 dist；数据库、logs、`.env` 均未挂载。

### 顺带做的清理

- 删掉门户 store 里无人调用、后端也没有的 `getReferralStats`（真调只会 404，留着会让人以为"推荐统计"是通的）。

---

## 第 3 轮：运维与进程健壮性

### 修掉的

| # | 问题 | 后果 | 位置 |
|---|---|---|---|
| 1 | **没有优雅停机**：部署时 `pm2 stop` 直接杀进程 → 在途请求被硬切断、正在跑的导出任务被腰斩、响应被截断 | 部署期间用户报错/订单状态不明 | `app.js` |
| 2 | **PM2 的 `kill_timeout` 默认只有 1.6 秒** —— 比服务端停机超时短，优雅停机白做（PM2 会先一步 SIGKILL） | 优雅停机形同虚设 | `package.sh` |
| 3 | **`pm2 reload <name>` 用的是 PM2 内存里的旧配置** —— 改了 `ecosystem.config` 不生效 | 配置改动不落地 | `deploy-on-server.sh` |
| 4 | **健康检查只反映启动期状态**：数据库运行期断开后照样返回 200「服务器运行正常」→ 就绪探针一直误报，负载均衡继续往坏实例打流量 | 探针误报 | `app.js` |
| 5 | **优雅停机时后台定时器没停**（HTTP 关了，清扫/导出 worker 还在跑）→ 旧进程在交接窗口里与新进程抢活干 | 重复劳动/文件写坏 | `app.js` |
| 6 | **未捕获异常 / 未处理的 Promise 拒绝没有兜底** → 崩溃只留在 PM2 输出里，排查时无从下手 | 可观测性 | `app.js` |

### 运维指标演进

`/api/admin/metrics`（仅超管）补上：
- **`databasePool`**（size/available/borrowed/pending）—— 排查"接口全卡住但 CPU 很低"的第一现场
- **`slowRequests`**（>1s 的请求数）—— 平均耗时骗人：绝大多数 2ms、偶尔一个 8 秒，平均值看着正常但用户已经投诉

### 生产实测结论（都正常，记录备查）

| 项 | 实测 |
|---|---|
| Redis | **活着**（GET 27ms / PING OK）→ 跨实例缓存没问题（`.env` 里配了 `REDIS_URL`，虽然服务器没装 `redis-cli`） |
| PM2 | `instances: 1`（fork）→ 不存在导出 worker 跑两份 |
| 日志 | 有轮转（10MB × 14 / 10MB × 7），生产 `logs/` 里能看到轮转产物 |
| 超时清扫幂等 | `findByPk` 带 `lock: UPDATE` + **复查状态** → 部署重叠窗口**不会重复回补库存** |
| i18n 三语键集 | 已有测试守着，当前全绿 |
| 生产最近错误 | 仅 2 条，都是"token 过期"和"畸形 URL"（均已处理）→ **生产运行是健康的** |

---

## 部署事故记录（自己踩的，值得记住）

**改动部署脚本 → `pm2 reload ecosystem.config.js` → 生产 502。**

原因：项目 `package.json` 是 `"type": "module"`，`.js` 会被 Node 当 ESM，而 **PM2 用 `require()` 加载配置文件** → `ERR_REQUIRE_ESM` → reload 失败 → **老进程已停、新进程没起** → 502（中断约 1–2 分钟）。

修法与固化：
- PM2 配置必须是 **`.cjs`**（`module.exports` 在 CommonJS 里合法）
- 部署脚本用 `pm2 reload ecosystem.config.cjs`，并在启动前删掉遗留的 `.js`
- **新增回归测试**：package.sh 生成的配置必须能被 `require()` 解析且带 `kill_timeout`
- **部署前先本地验证配置能被加载**（这次是先执行才炸的 —— 顺序错了）

> 教训：改部署脚本 = 改"生产怎么被启动"。这类改动**必须先验证再执行**，
> 且失败时要能一条命令恢复（这次是 `pm2 restart universal-shop`）。

---

## 三轮累计

| 轮 | 角度 | 修掉 | 排除/推迟 |
|---|---|---|---|
| 1（上一轮） | 全项目 6 面并行 | 28 | 3 误报 + 4 推迟 |
| 2 | 安全与输入边界 | 9 + 1 清理 | XSS/上传/静态服务 均无问题 |
| 3 | 运维与进程健壮性 | 6 + 指标演进 | 5 项生产实测正常 |

**测试规模**：API 1029 → Vue 193 → E2E 56（三轮共新增约 45 个测试文件级用例）
**生产数据**：三轮全程 3 用户 / 9 订单 / 9 明细 / 18 商品 / 2 合作方 / 1 管理员，**一次没变**；14 项数据不变量每次全过。
