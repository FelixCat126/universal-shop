#!/usr/bin/env bash
# 生产备份：pg_dump + uploads 打包 + 保留期清理；不修改数据库内容
#
# 兼容两种 PG 部署形态（自动判定）：
#   - 宿主机安装了 postgresql-client → 直连 pg_dump
#   - PG 跑在容器里（宿主机无 client）→ docker exec 进容器执行
# 详见 scripts/db/pg-lib.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=scripts/db/pg-lib.sh
source "$SCRIPT_DIR/pg-lib.sh"

ENV_FILE="${BACKUP_ENV_FILE:-$ROOT/.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ 未找到环境文件: $ENV_FILE"
  exit 1
fi

# 只读取需要的键，避免 .env 中含空格/特殊字符的未加引号值导致 source 报错
DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')"
: "${DB_URL:?请在 $ENV_FILE 中设置 DATABASE_URL}"

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${BACKUP_DIR:-$ROOT/database/backups}"
BACKUP_DIR="$BACKUP_ROOT/$TS"
mkdir -p "$BACKUP_DIR"

echo "📥 备份 PostgreSQL 到 $BACKUP_DIR/shop.sql.gz"
# 先在当前 shell 初始化一次，让 PG_MODE 在后续 manifest 中可见
# （pg_dump_stream 内部走管道子 shell，变量不会回传）
pg_init "$DB_URL"
pg_dump_stream "$DB_URL" | gzip > "$BACKUP_DIR/shop.sql.gz"

# 空/损坏备份必须在第一时间失败，而不是留到恢复时才发现
if [[ ! -s "$BACKUP_DIR/shop.sql.gz" ]]; then
  echo "❌ 备份文件为空，已中止" >&2
  rm -f "$BACKUP_DIR/shop.sql.gz"
  exit 1
fi
# gzip 完整性校验（管道写坏时能立刻发现）
if ! gzip -t "$BACKUP_DIR/shop.sql.gz" 2>/dev/null; then
  echo "❌ 备份文件 gzip 校验失败，已中止" >&2
  rm -f "$BACKUP_DIR/shop.sql.gz"
  exit 1
fi
BACKUP_SIZE="$(du -h "$BACKUP_DIR/shop.sql.gz" | cut -f1)"
echo "   备份大小: $BACKUP_SIZE"

if [[ -d "$ROOT/public/uploads" ]]; then
  echo "📦 打包 public/uploads"
  tar -czf "$BACKUP_DIR/uploads.tar.gz" -C "$ROOT/public" uploads
  test -s "$BACKUP_DIR/uploads.tar.gz" || { echo "❌ uploads 打包失败" >&2; exit 1; }
fi

# 写一份元数据，便于人工核对备份对应的时间点与库表数量
{
  echo "timestamp=$TS"
  echo "size_bytes=$(stat -c %s "$BACKUP_DIR/shop.sql.gz" 2>/dev/null || stat -f %z "$BACKUP_DIR/shop.sql.gz")"
  echo "pg_mode=${PG_MODE:-unknown}"
  echo "table_count=$(pg_scalar "$DB_URL" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
} > "$BACKUP_DIR/manifest.txt"

if [[ -n "${BACKUP_OFFSITE_DIR:-}" ]]; then
  echo "☁️ 复制到异地目录: $BACKUP_OFFSITE_DIR"
  mkdir -p "$BACKUP_OFFSITE_DIR"
  cp -a "$BACKUP_DIR" "$BACKUP_OFFSITE_DIR/"
fi

# 保留最近 14 天（BACKUP_RETENTION_DAYS 可覆盖）
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -exec rm -rf {} +

echo "✅ 备份完成: $BACKUP_DIR"
