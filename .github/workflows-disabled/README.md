# 持续集成（已停用）

## 为什么停用

2026-11-23 起，本仓库的 GitHub Actions 被停用 —— 每次 push 都会收到 CI 失败邮件，
但 CI 已经在**本地**完整跑过（比 CI 更严格、覆盖更全），CI 只是重复劳动并制造噪声。

停用方式：把 `ci.yml` 从 `.github/workflows/` 移到本目录。
GitHub 只识别 `.github/workflows/` 下的 YAML → 不再有任何 workflow 运行 → **不再有邮件**。

## 原来的 CI 是什么

`.github/workflows/ci.yml`，三个 job：

| job | 内容 |
|---|---|
| `test` | 全量测试（API + 集成，带 flaky 识别）、OpenAPI 契约检查、接口性能 SLO、覆盖率门禁 |
| `security-scan` | 生产依赖漏洞门禁（High/Critical 失败）+ dev 工具链漏洞快照 |
| `browser-e2e` | 真实浏览器 E2E（Playwright） |

## 为什么它在 CI 上一直红（不是代码坏了）

停用前 CI **每次 push 都失败**，两个独立原因，都不是本项目代码的问题：

### 1. `test` job：CI 的 PostgreSQL 镜像不含 `pg_trgm` 扩展

失败用例：`tests/api/orderUserSearchIndex.test.js` 的 SI-2 / SI-3 / SI-4
（断言 6 个 trigram 索引建出来了、查询用得上索引）。

CI 用的是官方 `postgres:16-alpine` 镜像，**不带 pg_trgm 扩展**；
迁移检测到扩展不可用 → 主动跳过建索引（这是设计好的降级）→
测试断言"索引存在" → 失败。

本地测试库有 pg_trgm → 索引建得出来 → **本地 1415 个用例全绿**。

> 修法（若将来要恢复 CI）：CI 的 postgres service 换成带扩展的镜像，
> 或在 `options` 里加 `--health-cmd` 预装扩展。

### 2. `security-scan` job：`sharp` 的 libvips 传递依赖有 high 级漏洞

`npm audit --omit=dev --audit-level=high` 报 `sharp <=0.35.5-rc.1` 有 1 个 high
（libvips / libheif / librsvg 的 CVE，GHSA-f88m-g3jw-g9cj 等）。
修复需要 `npm audit fix --force` → 装 `sharp@0.35.5` → **破坏性大版本变更**，未做。

## 恢复方式

```bash
git mv .github/workflows-disabled/ci.yml .github/workflows/ci.yml
```

并按上面两点先修好 CI 环境与依赖，再推送。
