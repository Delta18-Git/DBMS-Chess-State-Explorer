#!/usr/bin/env bash
# Start (or create) the local MySQL 8.4 and Neo4j containers with Podman or Docker.
# Reads credentials from .env.local; nothing secret is stored in this script.
# Usage: scripts/dev-db.sh [up|down|status]
set -euo pipefail
cd "$(dirname "$0")/.."

ENGINE=${CONTAINER_ENGINE:-$(command -v podman || command -v docker)}
[[ -n "$ENGINE" ]] || { echo "Install podman or docker" >&2; exit 1; }
[[ -f .env.local ]] || { echo "Create .env.local from .env.example first" >&2; exit 1; }
set -a; source .env.local; set +a

MYSQL_CTR=chess-mysql
NEO4J_CTR=chess-neo4j
NEO4J_BOLT_PORT=${NEO4J_URI##*:}
NEO4J_HTTP_PORT=${NEO4J_HTTP_PORT:-7475}

exists() { "$ENGINE" container exists "$1" 2>/dev/null || "$ENGINE" inspect "$1" >/dev/null 2>&1; }

up() {
  if exists "$MYSQL_CTR"; then "$ENGINE" start "$MYSQL_CTR" >/dev/null; else
    "$ENGINE" run -d --name "$MYSQL_CTR" \
      -e MYSQL_DATABASE="$DB_NAME" -e MYSQL_USER="$DB_USER" \
      -e MYSQL_PASSWORD="$DB_PASSWORD" -e MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" \
      -p "127.0.0.1:${DB_PORT}:3306" -v chess_mysql_data:/var/lib/mysql \
      docker.io/library/mysql:8.4 --log-bin-trust-function-creators=1 >/dev/null
  fi
  if exists "$NEO4J_CTR"; then "$ENGINE" start "$NEO4J_CTR" >/dev/null; else
    "$ENGINE" run -d --name "$NEO4J_CTR" \
      -e NEO4J_AUTH="${NEO4J_USER}/${NEO4J_PASSWORD}" \
      -p "127.0.0.1:${NEO4J_HTTP_PORT}:7474" -p "127.0.0.1:${NEO4J_BOLT_PORT}:7687" \
      -v chess_neo4j_data:/data docker.io/library/neo4j:community >/dev/null
  fi
  echo "Waiting for MySQL..."
  until "$ENGINE" exec "$MYSQL_CTR" mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent >/dev/null 2>&1; do sleep 2; done
  echo "Waiting for Neo4j..."
  until "$ENGINE" exec "$NEO4J_CTR" cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" "RETURN 1" >/dev/null 2>&1; do sleep 2; done
  echo "MySQL on 127.0.0.1:${DB_PORT}, Neo4j bolt on ${NEO4J_URI}, browser on http://127.0.0.1:${NEO4J_HTTP_PORT}"
}

case "${1:-up}" in
  up) up ;;
  down) "$ENGINE" stop "$MYSQL_CTR" "$NEO4J_CTR" ;;
  status) "$ENGINE" ps -a --filter "name=chess-" ;;
  *) echo "Usage: $0 [up|down|status]" >&2; exit 1 ;;
esac
