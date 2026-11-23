# 生产 Node 运行时拓扑（2026-11-23）

## 当前状态

同一台 ECS 上存在多个 Node 项目，**不是全部共用一个运行时**：

| 项目 | PM2 interpreter | 当前版本 |
|---|---|---|
| **universal-shop** | `/usr/local/bin/node` → `/opt/node22/bin/node` | **v22.23.5** |
| robot-cockpit | `/usr/bin/node` | v18.20.8（保持不变） |
| aether-gateway | `/usr/bin/node` | v18.20.8（保持不变） |

`sharp@0.35.5` 要求 Node ≥20.9，因此 universal-shop 单独升级到 Node 22 LTS；
其它项目没有跟着切，避免扩大影响面。

## 安装方式与回滚

- Node 22 是**旁路安装**：`/opt/node-v22.23.5/`
- 稳定入口：`/opt/node22` → `/opt/node-v22.23.5`
- `/usr/local/bin/{node,npm,npx,corepack}` 指到 `/opt/node22/bin/`
- 系统 Node 18 仍在 `/usr/bin/node`，**未覆盖**

部署脚本通过 `/usr/local/bin` 命中 Node 22；PM2 的 universal-shop
也显式绑定 `/usr/local/bin/node`，所以 `scripts/check-runtime-compat.mjs`
检查的运行时与实际服务进程一致。

回滚只需：

```bash
pm2 restart universal-shop --interpreter /usr/bin/node --update-env
pm2 save
# 如依赖已装 sharp 0.35，还必须先把 package.json / package-lock.json
# 回滚到 sharp 0.33.5 并重新安装，否则 Node 18 不支持 sharp 0.35。
```

## 切换前已做的验证

Node 22 旁路安装、SHA256 校验后，先在不切换服务的情况下实测：

- universal-shop 的全部生产依赖可加载（`scripts/check-runtime-compat.mjs`）
- `bcrypt` 原生哈希与校验通过
- `sharp` 实际生成 WebP 通过
- robot-cockpit 的 puppeteer 与配置可加载
- aether-gateway 的实际入口 `app/index.mjs` 通过 Node 22 语法检查

切换后通过 `/proc/<pid>/exe` 核实：只有 universal-shop 使用 Node 22，
另外两个项目仍是 `/usr/bin/node`。
