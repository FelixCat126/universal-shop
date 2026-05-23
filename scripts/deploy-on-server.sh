#!/usr/bin/env bash
# =============================================================================
# 服务器端部署入口（由 deploy-aliyun.sh 解压包后调用，勿单独在开发机执行）
#
# 重要变更（2026-05）：本项目已彻底切换到 PostgreSQL，移除 SQLite。
# - 全新部署：要求 .env 含 DATABASE_URL；不再创建 database/shop.sqlite
# - 旧站升级：若检测到旧版 SQLite 但未跑过迁移（无 .pg_migration_done），
#   本脚本会拒绝继续，提示先执行 scripts/migrate-prod-to-postgres.sh
#
# 用法:
#   bash scripts/deploy-on-server.sh --deploy-path /path/to/app --source /tmp/stage/universal-shop-v1.2.0
#
# 环境变量（可选）:
#   DEPLOY_UPGRADE_SKIP_NPM   非首次部署是否跳过 npm install（默认 true；依赖变更请设 false）
#   DEPLOY_PG_BACKUP=1        升级前用 pg_dump 备份当前 PG（推荐生产开启）
# =============================================================================

set -euo pipefail

DEPLOY_PATH=""
SOURCE_DIR=""
SKIP_NPM_ON_UPGRADE="${DEPLOY_UPGRADE_SKIP_NPM:-true}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy-path) DEPLOY_PATH="${2:?}"; shift 2;;
    --source) SOURCE_DIR="${2:?}"; shift 2;;
    *) echo "未知参数: $1"; exit 1;;
  esac
done

if [[ -z "$DEPLOY_PATH" || -z "$SOURCE_DIR" ]]; then
  echo "用法: $0 --deploy-path /app --source /path/to/universal-shop-vX.Y.Z"
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "❌ 源码包目录不存在: $SOURCE_DIR"
  exit 1
fi

TS="$(date +%Y%m%d%H%M%S)"
IS_FIRST="0"
if [[ ! -f "${DEPLOY_PATH}/.deploy_initialized" ]]; then
  IS_FIRST="1"
fi

echo "📂 部署目录: ${DEPLOY_PATH}"
echo "📦 软件包源: ${SOURCE_DIR}"
if [[ "$IS_FIRST" == "1" ]]; then
  echo "🆕 检测到首次部署（无 .deploy_initialized）"
else
  echo "🔄 增量部署（依赖变更时设 DEPLOY_UPGRADE_SKIP_NPM=false 触发 npm install）"
fi

mkdir -p "${DEPLOY_PATH}/database/backups" "${DEPLOY_PATH}/public/uploads" "${DEPLOY_PATH}/logs"

# --------------------------------------------------------------------------
# 1. SQLite → PG 迁移闸门：旧库存在但未迁移则拒绝继续
# --------------------------------------------------------------------------
SQLITE_PATH="${DEPLOY_PATH}/database/shop.sqlite"
PG_DONE_MARK="${DEPLOY_PATH}/.pg_migration_done"

if [[ -f "$SQLITE_PATH" && ! -f "$PG_DONE_MARK" ]]; then
  cat <<EOF
❌ 检测到旧版 SQLite 数据但尚未迁移到 PostgreSQL：
   ${SQLITE_PATH}

本版本已彻底移除 SQLite。请先在服务器上执行一次性迁移：

   cd ${DEPLOY_PATH}
   bash scripts/migrate-prod-to-postgres.sh \\
       --pg-host <RDS地址或127.0.0.1> \\
       --pg-port 5432 \\
       --pg-db shop_prod \\
       --pg-user shop_app \\
       --pg-password '<强密码>'

   迁移成功后会生成 .pg_migration_done 文件，再重新跑本部署即可。
EOF
  exit 1
fi

if [[ -f "$PG_DONE_MARK" ]]; then
  echo "✅ 已有 PG 迁移完成标记: $PG_DONE_MARK"
fi

# --------------------------------------------------------------------------
# 2. 备份策略
#    - 旧 SQLite 文件（如果还在）：保留为冷备份，防回滚
#    - PG 数据：可选 pg_dump（DEPLOY_PG_BACKUP=1）
# --------------------------------------------------------------------------
echo "💾 备份阶段..."

if [[ -f "$SQLITE_PATH" && -f "$PG_DONE_MARK" ]]; then
  echo "   ℹ️  旧 SQLite 已留作回滚冷备：$SQLITE_PATH（PG 稳定一段时间后可手动清理）"
fi

if [[ "${DEPLOY_PG_BACKUP:-0}" == "1" ]]; then
  if command -v pg_dump >/dev/null 2>&1; then
    if [[ -f "${DEPLOY_PATH}/.env" ]]; then
      DB_URL_LINE="$(grep -E '^DATABASE_URL=' "${DEPLOY_PATH}/.env" | tail -n 1 | cut -d '=' -f 2- || true)"
    else
      DB_URL_LINE=""
    fi
    if [[ -n "$DB_URL_LINE" ]]; then
      DUMP_FILE="${DEPLOY_PATH}/database/backups/pg-dump.predeploy.${TS}.sql.gz"
      echo "   📥 pg_dump → ${DUMP_FILE}"
      pg_dump "${DB_URL_LINE}" --no-owner --no-acl 2>/dev/null | gzip > "${DUMP_FILE}" \
        || echo "   ⚠️ pg_dump 失败（继续部署，但建议排查）"
    else
      echo "   ⚠️ .env 未找到 DATABASE_URL，跳过 pg_dump"
    fi
  else
    echo "   ⚠️ 未安装 pg_dump，跳过备份。建议: apt-get install postgresql-client"
  fi
fi

# --------------------------------------------------------------------------
# 3. 停 PM2 重复进程
# --------------------------------------------------------------------------
echo "🛑 停止/清理重复 PM2 进程..."
if command -v pm2 >/dev/null 2>&1; then
  export DEPLOY_PATH
  pm2 jlist 2>/dev/null \
    | node -e '
        let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
          try {
            const list = JSON.parse(s);
            const target = process.env.DEPLOY_PATH || "";
            for (const p of list) {
              if (p && p.name === "universal-shop") {
                const cwd = (p.pm2_env && (p.pm2_env.pm_cwd || p.pm2_env.cwd)) || "";
                const tag = cwd === target ? "KEEP" : "DELETE";
                console.log(`${tag} ${p.pm_id} ${cwd}`);
              }
            }
          } catch (e) { console.error("jlist parse fail:", e.message); }
        });
      ' \
    | while read -r tag pmid cwd; do
        if [[ "$tag" == "DELETE" ]]; then
          echo "   pm2 delete $pmid ($cwd)"
          pm2 delete "$pmid" >/dev/null 2>&1 || true
        fi
      done
  pm2 stop universal-shop 2>/dev/null || true
else
  if [[ "$IS_FIRST" == "1" ]]; then
    echo "⚠️  未检测到 PM2。首次部署建议: npm install -g pm2 && pm2 startup"
  fi
fi

# --------------------------------------------------------------------------
# 4. rsync 替换代码（保留 database/、uploads/、.env、ssl/、logs/）
# --------------------------------------------------------------------------
echo "📋 rsync 同步发布目录..."
rsync -a --delete \
  --exclude 'database/' \
  --exclude 'public/uploads/' \
  --exclude '.env' \
  --exclude 'node_modules/' \
  --exclude 'logs/' \
  --exclude 'ssl/' \
  --exclude '.pg_migration_done' \
  "${SOURCE_DIR}/" "${DEPLOY_PATH}/"

if [[ ! -f "${DEPLOY_PATH}/.env" ]] && [[ -f "${DEPLOY_PATH}/env.example" ]]; then
  cp "${DEPLOY_PATH}/env.example" "${DEPLOY_PATH}/.env"
  echo "📝 已从 env.example 创建 .env，请登录服务器核对 DATABASE_URL / JWT_SECRET / INIT_SECRET / CAPTCHA_SECRET 等"
fi

cd "${DEPLOY_PATH}"

# --------------------------------------------------------------------------
# 5. .env 健康检查（必须含 DATABASE_URL）
# --------------------------------------------------------------------------
if ! grep -qE "^DATABASE_URL=postgres" "${DEPLOY_PATH}/.env"; then
  cat <<EOF
❌ .env 中未找到有效的 DATABASE_URL=postgres://... 配置

请编辑 ${DEPLOY_PATH}/.env：
  DATABASE_URL=postgres://shop_app:<密码>@<RDS地址>:5432/shop_prod
  PG_SSL=true                # 阿里云 RDS 一般需要
  JWT_SECRET=...             # 32+ 随机字符
  INIT_SECRET=...
  CAPTCHA_SECRET=...
  ALLOWED_ORIGINS=https://your-domain.com
  TRUST_PROXY=1

修改完成后再次运行本部署。
EOF
  exit 1
fi

# --------------------------------------------------------------------------
# 6. npm install
# --------------------------------------------------------------------------
RUN_NPM="0"
if [[ "$IS_FIRST" == "1" ]]; then
  RUN_NPM="1"
  echo "📦 首次部署：npm install --omit=dev ..."
elif [[ "${SKIP_NPM_ON_UPGRADE}" != "true" && "${SKIP_NPM_ON_UPGRADE}" != "1" ]]; then
  RUN_NPM="1"
  echo "📦 增量部署：DEPLOY_UPGRADE_SKIP_NPM=false → 执行 npm install --omit=dev ..."
else
  echo "⏭️  增量部署：跳过 npm install（依赖有变请设 DEPLOY_UPGRADE_SKIP_NPM=false 后重新部署）"
fi

if [[ "$RUN_NPM" == "1" ]]; then
  npm install --omit=dev --silent
  # 已切到 PG，确保 sqlite3 二进制不再残留
  if [[ -d "${DEPLOY_PATH}/node_modules/sqlite3" ]]; then
    echo "🧹 检测到残留 sqlite3 模块，清理..."
    npm uninstall --no-save --silent sqlite3 2>/dev/null || true
  fi
fi

# --------------------------------------------------------------------------
# 7. PG sync + SQL 补丁（幂等）
# --------------------------------------------------------------------------
echo "🌱 PostgreSQL 模型同步 + SQL 补丁（幂等；不重置管理员密码）..."
NODE_ENV=production node scripts/production-deploy-setup.mjs

# --------------------------------------------------------------------------
# 8. PM2 启动/重启
# --------------------------------------------------------------------------
echo "🚀 PM2 启动/重启..."
export NODE_ENV=production
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe universal-shop >/dev/null 2>&1; then
    pm2 restart universal-shop --update-env
  elif [[ -f ecosystem.config.js ]]; then
    pm2 start ecosystem.config.js
  else
    pm2 start src/server/index.js --name universal-shop
  fi
  pm2 save 2>/dev/null || true
else
  echo "⚠️  未安装 PM2，请手动: cd ${DEPLOY_PATH} && NODE_ENV=production node src/server/index.js"
fi

if [[ "$IS_FIRST" == "1" ]]; then
  touch "${DEPLOY_PATH}/.deploy_initialized"
  echo "✅ 已写入首次部署标记: ${DEPLOY_PATH}/.deploy_initialized"
  if command -v pm2 >/dev/null 2>&1; then
    echo "💡 若需开机自启，请在服务器执行一次（需 root）: pm2 startup 并按提示执行生成的命令"
  fi
fi

# --------------------------------------------------------------------------
# 9. 健康检查（best-effort）
# --------------------------------------------------------------------------
PORT_TO_CHECK="${PORT:-3000}"
if command -v curl >/dev/null 2>&1; then
  for i in 1 2 3 4 5; do
    if curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT_TO_CHECK}/api/health" 2>/dev/null | grep -q '^200$'; then
      echo "✅ /api/health 200 OK"
      break
    fi
    sleep 2
    if [[ "$i" == "5" ]]; then
      echo "⚠️ /api/health 未在 10s 内 200，请查看 pm2 logs universal-shop"
    fi
  done
fi

echo "✅ deploy-on-server.sh 执行完毕"
