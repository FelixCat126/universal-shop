#!/usr/bin/env bash
# 从 pg_dump 备份恢复。默认只恢复到空库；覆盖已有库需显式 ALLOW_DROP=1。
#
# 兼容宿主机直连 / PG 容器两种形态（自动判定），详见 scripts/db/pg-lib.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/db/pg-lib.sh
source "$SCRIPT_DIR/pg-lib.sh"

BACKUP_FILE="${1:?用法: $0 <backup.sql.gz>}"
TARGET_DATABASE_URL="${TARGET_DATABASE_URL:?请设置 TARGET_DATABASE_URL}"
test -f "$BACKUP_FILE"

if [[ "${ALLOW_DROP:-0}" != "1" ]]; then
  COUNT="$(pg_scalar "$TARGET_DATABASE_URL" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
  if [[ "$COUNT" != "0" ]]; then
    echo "❌ 目标库 public schema 已有 $COUNT 张表。覆盖恢复前请确认并设置 ALLOW_DROP=1"
    exit 1
  fi
else
  echo "⚠️ ALLOW_DROP=1：先备份目标库再覆盖 public schema"
  SAFETY_FILE="/tmp/restore-safety-$(date +%Y%m%d-%H%M%S).sql.gz"
  pg_dump_stream "$TARGET_DATABASE_URL" | gzip > "$SAFETY_FILE"
  test -s "$SAFETY_FILE" || { echo "❌ 目标库安全备份失败，中止恢复" >&2; exit 1; }
  echo "🛟 目标库已安全备份: $SAFETY_FILE"
  pg_restore_stream "$TARGET_DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
fi

echo "♻️ 恢复 $BACKUP_FILE"
gunzip -c "$BACKUP_FILE" | pg_restore_stream "$TARGET_DATABASE_URL"
echo "✅ 恢复完成"
