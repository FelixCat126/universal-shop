#!/usr/bin/env bash
# =============================================================================
# 服务器端部署入口（由 deploy-aliyun.sh 解压包后调用，勿单独在开发机执行）
# 用法:
#   bash scripts/deploy-on-server.sh --deploy-path /path/to/app --source /tmp/stage/universal-shop-v1.2.0
#
# 环境变量（可选）:
#   DEPLOY_UPGRADE_SKIP_NPM  非首次部署时是否跳过 npm install（默认 true；依赖变更请设 false）
# =============================================================================

set -euo pipefail

DEPLOY_PATH=""
SOURCE_DIR=""
SKIP_NPM_ON_UPGRADE="${DEPLOY_UPGRADE_SKIP_NPM:-true}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy-path)
      DEPLOY_PATH="${2:?}"
      shift 2
      ;;
    --source)
      SOURCE_DIR="${2:?}"
      shift 2
      ;;
    *)
      echo "未知参数: $1"
      exit 1
      ;;
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
  echo "🔄 增量部署（将按需跳过 npm install: SKIP_NPM_ON_UPGRADE=${SKIP_NPM_ON_UPGRADE}）"
fi

mkdir -p "${DEPLOY_PATH}/database" "${DEPLOY_PATH}/public/uploads" "${DEPLOY_PATH}/logs"

echo "💾 备份现有 SQLite（若存在）..."
if [[ -f "${DEPLOY_PATH}/database/shop.sqlite" ]]; then
  mkdir -p "${DEPLOY_PATH}/database/backups"
  cp "${DEPLOY_PATH}/database/shop.sqlite" "${DEPLOY_PATH}/database/backups/shop.sqlite.predeploy.${TS}"
  echo "   已备份到 database/backups/shop.sqlite.predeploy.${TS}"
fi

echo "🛑 停止并清理重复的 PM2 进程..."
if command -v pm2 >/dev/null 2>&1; then
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

export DEPLOY_PATH
echo "📋 rsync 同步发布目录（保留 database、uploads、.env、ssl、logs）..."
rsync -a --delete \
  --exclude 'database/' \
  --exclude 'public/uploads/' \
  --exclude '.env' \
  --exclude 'node_modules/' \
  --exclude 'logs/' \
  --exclude 'ssl/' \
  "${SOURCE_DIR}/" "${DEPLOY_PATH}/"

if [[ ! -f "${DEPLOY_PATH}/.env" ]] && [[ -f "${DEPLOY_PATH}/env.example" ]]; then
  cp "${DEPLOY_PATH}/env.example" "${DEPLOY_PATH}/.env"
  echo "📝 已从 env.example 创建 .env，请登录服务器核对 JWT_SECRET 等配置"
fi

cd "${DEPLOY_PATH}"

RUN_NPM="0"
if [[ "$IS_FIRST" == "1" ]]; then
  RUN_NPM="1"
  echo "📦 首次部署：npm install --omit=dev ..."
elif [[ "${SKIP_NPM_ON_UPGRADE}" != "true" && "${SKIP_NPM_ON_UPGRADE}" != "1" ]]; then
  RUN_NPM="1"
  echo "📦 增量部署：已关闭跳过 npm（DEPLOY_UPGRADE_SKIP_NPM），执行 npm install --omit=dev ..."
else
  echo "⏭️  增量部署：跳过 npm install（依赖有变请设置 DEPLOY_UPGRADE_SKIP_NPM=false 后重新部署）"
fi

if [[ "$RUN_NPM" == "1" ]]; then
  npm install --omit=dev --silent
fi

echo "🌱 数据库（Sequelize sync + SQL 补丁；生产不重置管理员密码）..."
NODE_ENV=production node scripts/production-deploy-setup.mjs

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

echo "✅ deploy-on-server.sh 执行完毕"
