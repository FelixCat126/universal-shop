#!/usr/bin/env bash
# =============================================================================
# 本机一键：打包 → 上传阿里云 ECS → 在服务器执行增量/首次部署逻辑
#
# 使用方式：
#   1. cp deploy.env.example deploy.env && 填写 ECS、路径等
#   2. cp scripts/deploy-aliyun.example.sh scripts/deploy-aliyun.sh && chmod +x scripts/deploy-aliyun.sh
#   3. npm run deploy:aliyun
#
# （scripts/deploy-aliyun.sh 通常在 .gitignore 中，仅本机保留，勿提交密钥。）
#
# 依赖：本机 bash、ssh、scp、npm、node；服务器 bash、tar、rsync、node、npm、pm2（建议）
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

if [[ ! -f deploy.env ]]; then
  echo "❌ 缺少 deploy.env。请复制: cp deploy.env.example deploy.env 并填写 ECS 等信息。"
  exit 1
fi

set -a
# shellcheck source=/dev/null
source deploy.env
set +a

: "${DEPLOY_HOST:?请在 deploy.env 中设置 DEPLOY_HOST}"
: "${DEPLOY_USER:?请在 deploy.env 中设置 DEPLOY_USER}"
: "${DEPLOY_PATH:?请在 deploy.env 中设置 DEPLOY_PATH}"

SKIP_NPM="${DEPLOY_UPGRADE_SKIP_NPM:-true}"
VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo "1.2.0")"
TGZ="universal-shop-v${VERSION}.tar.gz"

SSH_OPTS=()
SCP_OPTS=()
if [[ -n "${DEPLOY_SSH_KEY:-}" ]]; then
  SSH_OPTS+=(-i "${DEPLOY_SSH_KEY}")
  SCP_OPTS+=(-i "${DEPLOY_SSH_KEY}")
fi

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
TGZ_BASENAME="$(basename "${TGZ}")"

echo "📦 本地执行 package.sh ..."
bash "${ROOT}/package.sh"

if [[ ! -f "${ROOT}/${TGZ}" ]]; then
  echo "❌ 未找到压缩包 ${TGZ}"
  exit 1
fi

echo "📤 上传 ${TGZ} → ${REMOTE}:/tmp/${TGZ_BASENAME}"
scp "${SCP_OPTS[@]}" "${ROOT}/${TGZ}" "${REMOTE}:/tmp/${TGZ_BASENAME}"

echo "🚀 远端解压并调用 deploy-on-server.sh（DEPLOY_PATH=${DEPLOY_PATH}） ..."
ssh "${SSH_OPTS[@]}" "${REMOTE}" bash -s "${TGZ_BASENAME}" "${DEPLOY_PATH}" "${SKIP_NPM}" <<'ENDREMOTE'
set -euo pipefail
TGZ_REMOTE="/tmp/$1"
DEPLOY_REMOTE="$2"
SKIP_NPM_RAW="$3"
STAGE="$(mktemp -d "/tmp/uni-unpack.XXXXXX")"
cleanup() { rm -rf "${STAGE}"; }
trap cleanup EXIT
tar -xzf "${TGZ_REMOTE}" -C "${STAGE}"
SRC="$(find "${STAGE}" -maxdepth 1 -type d -name 'universal-shop-v*' ! -path "${STAGE}" | head -1)"
if [[ -z "${SRC}" || ! -d "${SRC}" ]]; then
  echo "❌ 解压后未找到 universal-shop-v* 目录"
  exit 1
fi
chmod +x "${SRC}/scripts/deploy-on-server.sh" 2>/dev/null || true
export DEPLOY_UPGRADE_SKIP_NPM="${SKIP_NPM_RAW}"
export DEPLOY_PATH="${DEPLOY_REMOTE}"
bash "${SRC}/scripts/deploy-on-server.sh" --deploy-path "${DEPLOY_REMOTE}" --source "${SRC}"
echo "✅ 远端部署脚本已执行。"
ENDREMOTE

if [[ -n "${DEPLOY_PUBLIC_URL:-}" ]]; then
  echo ""
  echo "🌐 建议健康检查: curl -sS -o /dev/null -w '%{http_code}' ${DEPLOY_PUBLIC_URL}/portal/ || true"
fi

echo ""
echo "✅ deploy-aliyun 流程结束（详见服务器 PM2 logs）"
