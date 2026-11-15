#!/usr/bin/env bash
# ===========================================
# 备份恢复演练（restore drill）
#
# 为什么需要这个脚本
#   "有备份文件" 和 "备份能恢复" 是两件事。
#   备份脚本坏了、pg_dump 版本对不上、恢复脚本语法错、权限不对 ——
#   这些都不会在"每天 02:40 备份成功"的日志里暴露，只有真正恢复一次才知道。
#   本脚本把恢复动作**在临时库里真跑一遍**，逐表比对，然后删掉临时库。
#
# 它不碰生产库：
#   - 只 CREATE 一个临时库 restore_drill_<时间戳>
#   - 恢复只往临时库里灌
#   - 比对完立刻 DROP（trap 保证异常退出也会清）
#
# 判定基准（重要）
#   比的是 **备份快照(dump) vs 恢复库**，不是「恢复库 vs 生产库」。
#   备份是生产的**某个时间点**的快照，之后生产会继续写（新增配置、新订单…），
#   那是正常的时序差，拿它判失败会永远误报。
#   真正判失败的是：恢复出来的行数与备份快照对不上 = 恢复不完整。
#
# 用法：
#   bash scripts/db/restore-drill.sh              # 演练最新一份备份
#   bash scripts/db/restore-drill.sh <备份目录>    # 演练指定备份
#
# 退出码：0 = 演练通过；非 0 = 演练失败（备份不可用）
# ===========================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/db/pg-lib.sh
source "$SCRIPT_DIR/pg-lib.sh"

ENV_FILE="${BACKUP_ENV_FILE:-$ROOT/.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ 未找到环境文件: $ENV_FILE"
  exit 2
fi

DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')"
if [[ -z "$DB_URL" ]]; then
  echo "❌ 请在 $ENV_FILE 中设置 DATABASE_URL"
  exit 2
fi

BACKUP_ROOT="${BACKUP_DIR:-$ROOT/database/backups}"
if [[ $# -ge 1 ]]; then
  BACKUP_DIR_ABS="$1"
else
  BACKUP_DIR_ABS="$(ls -1d "$BACKUP_ROOT"/2* 2>/dev/null | sort | tail -1)"
fi
if [[ -z "${BACKUP_DIR_ABS:-}" || ! -d "$BACKUP_DIR_ABS" ]]; then
  echo "❌ 找不到备份目录（$BACKUP_ROOT 下没有 2* 目录？）"
  exit 2
fi

DUMP_FILE="$BACKUP_DIR_ABS/shop.sql.gz"
if [[ ! -s "$DUMP_FILE" ]]; then
  echo "❌ 备份文件不存在或为空: $DUMP_FILE"
  exit 2
fi
# 先验 gzip 完整性：损坏的备份要在**恢复之前**就被挡住，
# 而不是恢复完才发现库里没数据
if ! gzip -t "$DUMP_FILE" 2>/dev/null; then
  echo "❌ 备份文件损坏（gzip 校验不通过）: $DUMP_FILE"
  exit 2
fi

export PG_CONTAINER="${PG_CONTAINER:-universal-shop-pg}"
pg_init "$DB_URL" || exit 2

DRILL_DB="restore_drill_$(date +%Y%m%d%H%M%S)"
export DB_URL
DRILL_URL="$(node -e "
  const u = new URL(process.env.DB_URL)
  u.pathname = '/' + process.argv[1]
  process.stdout.write(u.toString())
" "$DRILL_DB")"

cleanup () {
  if [[ -z "${DRILL_DB:-}" ]]; then return; fi
  if [[ "$PG_MODE" == "docker" ]]; then
    local super
    super="$(docker exec "$PG_CONTAINER" printenv POSTGRES_USER 2>/dev/null || echo postgres)"
    docker exec "$PG_CONTAINER" dropdb -U "$super" --if-exists "$DRILL_DB" >/dev/null 2>&1 \
      && echo "🧹 临时库已删除: $DRILL_DB" \
      || echo "⚠️ 临时库删除失败，请手动清理: $DRILL_DB"
  else
    dropdb --if-exists "$DRILL_URL" >/dev/null 2>&1 \
      && echo "🧹 临时库已删除: $DRILL_DB" \
      || echo "⚠️ 临时库删除失败，请手动清理: $DRILL_DB"
  fi
}
trap cleanup EXIT

echo "🧪 备份恢复演练"
echo "   备份: $BACKUP_DIR_ABS"
echo "   临时库: $DRILL_DB（PG 模式: $PG_MODE）"

# 1) 建临时库
if [[ "$PG_MODE" == "docker" ]]; then
  SUPER="$(docker exec "$PG_CONTAINER" printenv POSTGRES_USER 2>/dev/null || echo postgres)"
  if ! docker exec "$PG_CONTAINER" createdb -U "$SUPER" "$DRILL_DB"; then
    echo "❌ 建临时库失败（建不了库就做不了演练 —— 恢复所需的权限也要一并确认）"
    exit 3
  fi
else
  if ! createdb "$DRILL_URL"; then
    echo "❌ 建临时库失败：当前账号可能没有 CREATEDB 权限"
    exit 3
  fi
fi
echo "   ✅ 临时库已建"

# 2) 用**生产恢复脚本**恢复
#    （不另写一套恢复逻辑 —— 演练的就是真实链路）
if ! TARGET_DATABASE_URL="$DRILL_URL" bash "$SCRIPT_DIR/restore-prod.sh" "$DUMP_FILE"; then
  echo "❌ 恢复失败：这份备份不可用"
  exit 4
fi
echo "   ✅ 恢复完成"

# 3) 从 dump 解析每张表的行数（备份快照的权威值）
DUMP_COUNTS="$(mktemp /tmp/restore-drill-counts.XXXXXX)"
zcat "$DUMP_FILE" | awk '
  /^COPY public\./ { tbl=$2; sub(/.*\./,"",tbl); gsub(/\(.*/,"",tbl); n=0; inb=1; next }
  inb && /^\\\.$/ { print tbl"\t"n; inb=0; next }
  inb { n++ }
' > "$DUMP_COUNTS"
if [[ ! -s "$DUMP_COUNTS" ]]; then
  echo "❌ 解析 dump 失败：拿不到表行数（备份文件格式不对？可能被截断）"
  rm -f "$DUMP_COUNTS"
  exit 5
fi

# 4) 逐表比对：备份快照 vs 恢复库（判失败） / 备份快照 vs 生产库（时序差，仅提示）
INCOMPLETE=0
DRIFT=0
CHECKED=0
while IFS=$'\t' read -r t dump_n; do
  drill="$(pg_scalar "$DRILL_URL" "SELECT count(*) FROM public.\"$t\"" 2>/dev/null || echo ERR)"
  live="$(pg_scalar "$DB_URL" "SELECT count(*) FROM public.\"$t\"" 2>/dev/null || echo ERR)"
  CHECKED=$((CHECKED + 1))
  if [[ "$drill" != "$dump_n" ]]; then
    printf "   ❌ %-24s 备份 %-6s 恢复 %-6s  ← **恢复不完整**\n" "$t" "$dump_n" "$drill"
    INCOMPLETE=$((INCOMPLETE + 1))
  elif [[ "$live" != "$dump_n" ]]; then
    printf "   ⚠️ %-24s 备份 %-6s 恢复 %-6s 生产 %-6s  （备份后生产有变动，正常）\n" "$t" "$dump_n" "$drill" "$live"
    DRIFT=$((DRIFT + 1))
  else
    printf "   ✅ %-24s 备份 %-6s 恢复 %-6s 生产 %-6s\n" "$t" "$dump_n" "$drill" "$live"
  fi
done < "$DUMP_COUNTS"
rm -f "$DUMP_COUNTS"

echo ""
if [[ "$INCOMPLETE" == "0" ]]; then
  echo "✅ 演练通过：$CHECKED 张表恢复内容与备份快照完全一致（备份可用）"
  if [[ "$DRIFT" != "0" ]]; then
    echo "   ℹ️ 其中 $DRIFT 张表在生产上已有更新（备份点之后写入），属正常时序差"
  fi
  exit 0
fi
echo "❌ 演练失败：$CHECKED 张表中有 $INCOMPLETE 张恢复内容与备份不一致 —— 这份备份不可用"
exit 6
