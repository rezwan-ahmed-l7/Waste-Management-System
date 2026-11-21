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
The script creates the waste_mgmt schema, enum types, relational tables, keys, checks, indexes, triggers, views, and reference data.

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
