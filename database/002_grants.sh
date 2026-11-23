#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"

# This runs after 001_schema.sql on a fresh PostgreSQL volume.
# The bootstrap superuser owns the schema; the API gets only runtime DML.
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_password="$APP_DB_PASSWORD" \
  --set=bootstrap_user="$POSTGRES_USER" \
  --set=database_name="$POSTGRES_DB" <<'SQL'
CREATE ROLE waste_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE :"database_name" TO waste_app;
GRANT USAGE ON SCHEMA waste_mgmt TO waste_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA waste_mgmt TO waste_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA waste_mgmt TO waste_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"bootstrap_user" IN SCHEMA waste_mgmt
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO waste_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"bootstrap_user" IN SCHEMA waste_mgmt
  GRANT USAGE, SELECT ON SEQUENCES TO waste_app;
SQL
