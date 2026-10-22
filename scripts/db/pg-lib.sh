#!/usr/bin/env bash
# PG 调用层：宿主机装了 client 就直连，否则走 docker exec 进 PG 容器
#
# 用法：
#   source pg-lib.sh
#   pg_dump_stream "$DATABASE_URL" > out.sql      # 导出（gzip 由调用方处理）
#   pg_restore_stream "$DATABASE_URL" < in.sql    # 导入
#   pg_scalar "$DATABASE_URL" "SELECT ..."        # 取单值
#
# 容器模式开关（自动判定，也可用 PG_CONTAINER 强制指定）：
#   - 宿主机有 pg_dump/psql 可执行文件 → 直连模式
#   - 否则若有 PG_CONTAINER（默认探测同名容器）→ 容器模式
#   - 两者皆无 → 报错退出，避免静默产出空备份
#
# 容器模式下凭据从 DATABASE_URL 解析出 user/password/db，
# 通过 PGPASSWORD 环境变量传入容器内 psql/pg_dump，不落盘、不进 argv。

# 从 postgres 连接串解析出 user / password / db
# 支持 postgres://user:pass@host:port/db 与 postgres://user@host/db
_pg_parse_url () {
  local url="$1"
  local rest="${url#*://}"
  local userinfo="${rest%%@*}"
  local hostpart="${rest#*@}"
  local dbpart="${hostpart#*/}"
  dbpart="${dbpart%%\?*}"
  hostpart="${hostpart%%/*}"

  PG_USER="${userinfo%%:*}"
  local pass=""
  if [[ "$userinfo" == *:* ]]; then
    # 只处理百分号编码未出现的常规口令；生产口令为随机 base64url，无特殊字符
    pass="${userinfo#*:}"
  fi
  PG_PASS="$pass"
  PG_DB="${dbpart:-postgres}"
  export PG_USER PG_PASS PG_DB
}

# 判定模式：echo "direct" 或 "docker"
_pg_mode () {
  if [[ -n "${PG_FORCE_MODE:-}" ]]; then
    echo "$PG_FORCE_MODE"
    return
  fi
  if command -v pg_dump >/dev/null 2>&1 && command -v psql >/dev/null 2>&1; then
    echo "direct"
    return
  fi
  local container="${PG_CONTAINER:-}"
  if [[ -z "$container" ]] && command -v docker >/dev/null 2>&1; then
    container="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E '(^|[-_])pg$|postgres' | head -1)"
  fi
  if [[ -n "$container" ]] && docker exec "$container" sh -c 'command -v pg_dump' >/dev/null 2>&1; then
    PG_CONTAINER="$container"
    export PG_CONTAINER
    echo "docker"
    return
  fi
  echo "none"
}

# 解析 + 选模式；不可用时直接失败（fail loud，绝不静默产出空备份）
pg_init () {
  local url="${1:?需要 DATABASE_URL}"
  _pg_parse_url "$url"
  PG_MODE="$(_pg_mode)"
  if [[ "$PG_MODE" == "none" ]]; then
    echo "❌ 未找到可用的 pg_dump/psql：宿主机无 client，且未探测到 PG 容器" >&2
    echo "   请安装 postgresql-client，或用 PG_CONTAINER=<容器名> 指定 PG 容器" >&2
    return 1
  fi
  if [[ "$PG_MODE" == "docker" && -z "${PG_CONTAINER:-}" ]]; then
    echo "❌ 容器模式下未能确定 PG_CONTAINER" >&2
    return 1
  fi
  export PG_MODE
  return 0
}

# 导出：pg_dump_stream <url> [额外参数...]
pg_dump_stream () {
  local url="$1"; shift
  pg_init "$url" || return 1
  if [[ "$PG_MODE" == "direct" ]]; then
    pg_dump "$url" --no-owner --no-acl "$@"
  else
    docker exec -i -e PGPASSWORD="$PG_PASS" "$PG_CONTAINER" \
      pg_dump -U "$PG_USER" -d "$PG_DB" --no-owner --no-acl "$@"
  fi
}

# 导入：pg_restore_stream <url>  （从 stdin 读 SQL）
pg_restore_stream () {
  local url="$1"; shift
  pg_init "$url" || return 1
  if [[ "$PG_MODE" == "direct" ]]; then
    psql "$url" -v ON_ERROR_STOP=1 "$@"
  else
    docker exec -i -e PGPASSWORD="$PG_PASS" "$PG_CONTAINER" \
      psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 "$@"
  fi
}

# 单值查询：pg_scalar <url> <sql>
pg_scalar () {
  local url="$1"; shift
  local sql="$*"
  pg_init "$url" || return 1
  if [[ "$PG_MODE" == "direct" ]]; then
    psql "$url" -Atc "$sql"
  else
    docker exec -i -e PGPASSWORD="$PG_PASS" "$PG_CONTAINER" \
      psql -U "$PG_USER" -d "$PG_DB" -Atc "$sql"
  fi
}
