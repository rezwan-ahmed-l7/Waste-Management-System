# Database Design

## 1. Source of truth and conventions

The executable schema is `database/001_schema.sql`; this document describes that schema, not a hypothetical future model. PostgreSQL is the source of truth. The application currently uses parameterized SQL through `pg`; Prisma is not part of the runtime.

- One fest only: `fest.fest_id = 1`.
- Schema namespace: `waste_mgmt`.
- UUID keys for operational entities; identity keys for small catalogues/history rows.
- UTC `timestamptz` values; default event timezone `Asia/Dhaka`.
- Numeric kilograms with three decimal places for collected/processed quantities.
- Foreign keys, checks, unique constraints, partial indexes, triggers and views enforce core invariants.
- Deactivate reference data instead of deleting rows referenced by operational history.

## 2. Identity and permissions

| Table | Responsibility |
|---|---|
| `users` | Accounts, normalized unique email, password hash and account status |
| `roles`, `permissions` | Role and capability catalogues |
| `user_roles`, `role_permissions` | User-role and role-permission many-to-many relationships |
| `sessions` | Hashed, expiring, revocable session tokens |

There is no public registration or password-reset workflow in this release. Administrator bootstrap is a one-time CLI operation; it refuses to create a second administrator. Session cookies are HttpOnly/SameSite and secure in production; raw tokens are not persisted.

## 3. Fest, locations and taxonomy

| Table | Responsibility |
|---|---|
| `fest` | Single fest name, description, timezone, dates and status |
| `zones` | Fest-scoped top-level locations |
| `areas` | Fest-scoped nested areas with optional parent |
| `bins` | Fest/area-scoped bins and optional waste category |
| `waste_categories` | Waste taxonomy and recyclability |

Composite foreign keys prevent cross-fest location references. Code uniqueness is scoped to the appropriate fest/location. Inactive zones, areas, bins and categories cannot receive new work through the API.

## 4. Reporting and review

| Table | Responsibility |
|---|---|
| `waste_reports` | Anonymous or authenticated report, area/bin/category, priority, status and canonical duplicate reference |
| `report_tracking_tokens` | Hashed, expiring and revocable anonymous tracking tokens |
| `report_attachments` | Private evidence metadata and storage keys |
| `report_status_history` | Public/private lifecycle history |
| `report_notes` | Public or internal manager notes |
| `report_task_links` | Historical report-to-task links, with one active primary task per report |

Anonymous reports do not create fake user accounts. The tracking token is shown once; only its hash is stored. Public tracking returns only the report status, public history and public notes. Duplicate reports must reference a canonical report and cannot independently become a second work item.

## 5. Workforce and collection

| Table | Responsibility |
|---|---|
| `teams`, `team_memberships` | Teams, team leads and time-bounded memberships |
| `cleaning_rounds` | Scheduled area-based cleaning work |
| `collection_tasks` | Report-driven or planned work, lifecycle and verification metadata |
| `task_assignments` | Historical individual/team assignments; exactly one target per row |
| `task_status_history` | Trigger-maintained task lifecycle history |
| `collection_submissions` | Volunteer evidence submission and manager decision |
| `collection_records` | Category, entered quantity/unit, normalized kg and measurement method |
| `collection_photos` | Private collection evidence metadata |

A task cannot be verified without a verified collection submission or an explicit manager-entered no-waste/false-alarm reason. A submission can be decided only once and needs at least one weight record to be verified. Collection records cannot be changed after the submission leaves the pending state.

## 6. Material flow and reconciliation

| Table | Responsibility |
|---|---|
| `material_batches` | One available batch per collection record, created only after verification |
| `segregation_records` | Quantity split into an output category |
| `material_destinations` | Recycling, composting, disposal, reuse or other destination |
| `material_allocations` | Quantity handed to a destination from a batch or segregation output |

Triggers lock source rows and reject allocations/segregation totals above source quantities. Views `v_material_balance` and `v_segregation_balance` calculate remaining quantities; they are read models, not independent stored totals. The database smoke test verifies verified-only batch creation, over-allocation rejection and a reconciled remaining balance. Concurrent allocation stress testing remains a separate hardening gate.

## 7. Communications, audit and supporting records

| Table | Responsibility |
|---|---|
| `notifications` | User-scoped in-app notifications and read state |
| `announcements` | Published announcements with role/zone audience targeting |
| `audit_logs` | Actor, action, entity, request ID and intentionally narrow safe metadata |
| `idempotency_keys` | Reserved persistence structure for future retry-safe operations; not yet exposed as a general API feature |

Audit triggers capture selected operational row changes. The API sets actor/request context within transactions where supported. Audit metadata intentionally excludes passwords, tokens, personal contact fields, report descriptions and file contents.

## 8. Views, indexes and query suite

Current views:
- `v_report_overview`
- `v_verified_collection_totals`
- `v_material_balance`
- `v_segregation_balance`

Indexes cover report status/date and location, task status/due date, user-role lookup, active assignments, membership lookup, session expiry, audit actor/entity and history timelines. Review query plans with realistic fest data before increasing scale.

`database/003_reporting_queries.sql` demonstrates joins, left joins, filtered aggregation, CTEs, window functions, lateral joins, team workload, overdue tasks, verified collection, material balance and audit summaries. The CI job executes the complete query file against a fresh PostgreSQL 16 database.

## 9. Deliberate omissions and remaining work

The schema does not currently implement volunteer availability, bin inspection observations, password reset tokens, material adjustment/correction ledgers, outbox delivery, or multi-fest tenancy. These must not be presented as implemented. Add them only with approved requirements and migrations. Remaining quality gates include broader lifecycle/authorization tests, concurrent material-flow tests, and a verified production backup/restore drill.
