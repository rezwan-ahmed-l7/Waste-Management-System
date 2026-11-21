# PostgreSQL database

## Requirements
- PostgreSQL 15+
- psql or pgAdmin Query Tool

## Create a database
Run in pgAdmin or psql:
```sql
CREATE DATABASE waste_management;
```

## Apply schema
From the repository root:
```powershell
psql -v ON_ERROR_STOP=1 -U postgres -d waste_management -f database/001_schema.sql
```
The script creates the waste_mgmt schema, enum types, relational tables, keys, checks, indexes, triggers, views, and reference data. For a local runtime role, set `POSTGRES_USER=postgres`, `POSTGRES_DB=waste_management`, and a strong `APP_DB_PASSWORD`, then run `bash database/002_grants.sh` from Git Bash. The script expects a local TCP connection when run from the host; set `PGHOST=localhost` and `PGPASSWORD` for the PostgreSQL bootstrap superuser. Inside the Compose database initialization container, it uses the local socket. It creates a non-superuser `waste_app` role with schema usage and table/sequence DML privileges. Set the API `DATABASE_URL` to this role rather than using the PostgreSQL superuser.

## Verify
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='waste_mgmt' AND table_type='BASE TABLE'
ORDER BY table_name;

SELECT table_name FROM information_schema.views
WHERE table_schema='waste_mgmt' ORDER BY table_name;

SELECT routine_name FROM information_schema.routines
WHERE routine_schema='waste_mgmt' ORDER BY routine_name;

SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema='waste_mgmt' ORDER BY event_object_table, trigger_name;
```

For manual queries:
```sql
SET search_path TO waste_mgmt, public;
```

## Data integrity notes
- Exactly one fest is permitted by the fest_id CHECK constraint.
- Anonymous reports do not require a user row. Tracking tokens are high entropy; only token hashes are stored.
- Only verified collection submissions create material batches.
- Segregation and downstream allocations lock their source and reject totals above the available source weight.
- API authorization, token generation/delivery, request rate limiting, upload inspection and allowed status transitions remain API responsibilities.
- Evidence is stored in private file storage; PostgreSQL stores storage keys and metadata only.
- No default administrator or production password is seeded.

## Runtime test status
The schema must be applied to a clean PostgreSQL 15+ database with ON_ERROR_STOP enabled before it is considered runtime-verified. See the project implementation plan for the verification gate.


## Demonstration and reporting queries

After applying the schema and smoke tests, run the DBMS query suite:

```powershell
psql -U postgres -d waste_management -f database/003_reporting_queries.sql
```

The suite demonstrates relational joins, left joins, aggregation, filtered aggregates, CTEs, window functions, lateral joins, workload reporting, overdue-task derivation, material reconciliation and audit summaries. Run the two-connection race test with `npm run db:test-concurrency`; it verifies that concurrent allocations cannot both overdraw the same source batch.

## Backup and restore runbook

Use a dedicated PostgreSQL role with the minimum required privileges. The Compose deployment initializes `waste_app` as a non-superuser runtime role; the PostgreSQL superuser is reserved for initialization and backup. Store backups outside the repository on encrypted storage with access controls; never place credentials in command history or commit them.

PowerShell example (run from the repository root; replace the destination with a protected backup directory):

```powershell
# Configure libpq passfile authentication (pgpass.conf) or supply PGPASSWORD securely in your local session.
pg_dump -h localhost -U postgres -d waste_management -Fc -f "D:\Backups\waste_management.dump"
pg_restore --list "D:\Backups\waste_management.dump"
```

Restore into a new, empty verification database first. Do not restore over the live database as a routine test:

```powershell
createdb -h localhost -U postgres waste_management_restore_check
pg_restore -h localhost -U postgres -d waste_management_restore_check --clean --if-exists "D:\Backups\waste_management.dump"
```

For the Compose deployment, `bash scripts/backup-compose.sh` archives the database and the private evidence volume into one timestamped directory and writes SHA-256 checksums. Copy it off-host. After restore, run `npm run db:verify`, execute `database/002_smoke_test.sql`, compare expected row counts, and confirm representative evidence files can be read through the authorized API before accepting the backup. Back up the private evidence directory (or private object-storage bucket) consistently with the database; a database dump alone does not contain uploaded files. Define retention, encryption, off-site copies, RPO/RTO and restore ownership with the event operator. CI now performs a PostgreSQL custom-format dump, restores it into a separate disposable database, and reruns schema verification, smoke tests and reporting queries. This verifies database backup/restore mechanics; production retention, encrypted/off-site storage, and coordinated restore of private uploaded files still require an operator-owned drill.

## Private evidence storage

Report attachments and collection evidence are stored outside the web application's public directory. Local development uses `PRIVATE_STORAGE_DIR` (default: `apps/api/storage/private`). Files are size-limited, MIME-checked and inspected by file signature; generated storage keys are used instead of client-supplied paths. Downloads require the appropriate manager permission. Do not expose this directory through a static file server or commit its contents.

The current adapter is local filesystem storage. Production deployment must provide a persistent private volume or a reviewed private object-storage adapter before uploads are enabled in production.
