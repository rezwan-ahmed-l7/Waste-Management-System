# BAUST CSE Fest Waste Management System

A DBMS-first full-stack operational platform to coordinate waste reporting, scheduled cleaning, collection, segregation, recycling, disposal, and event-level reporting for BAUST CSE Fest.

> **Status:** Core application implementation is merged into `main` and a Next.js frontend deployment is live on Vercel. Production operation is **not yet complete**: the Express API still needs a supported host, the API must be connected to the Supabase PostgreSQL database, and private evidence storage must be moved to durable persistent storage. Do not treat the current Vercel frontend deployment as a fully working production system.

## Product goals
- Let attendees and staff report waste issues with location, category, description, and optional photo.
- Convert reviewed reports and planned cleaning rounds into assigned collection tasks.
- Coordinate volunteers and teams with clear task ownership and deadlines.
- Verify collection evidence and weight before including it in official totals.
- Track segregation, recycling, final disposal, and material balances.
- Give managers and organizers role-appropriate operational dashboards and a final fest report.

## Main roles
Administrator · Fest Organizer · Waste Manager · Team Lead · Volunteer/Collector · Reporter (student, guest, teacher, or staff).

## Core modules
1. Authentication, profiles, roles, and permissions.
2. Anonymous waste reporting, secure tracking, review, duplicate handling, and status tracking.
3. Fest zones, areas, and waste-bin inventory.
4. Scheduled cleaning rounds and report-driven collection tasks.
5. Teams, volunteer assignments, workload, and progress.
6. Collection evidence, weight, verification, segregation, recycling, and disposal.
7. In-app notifications and announcements.
8. Dashboards, analytics, date-scoped printable final fest report, CSV export, and audit logs.

Advanced QR, live map, SMS/WhatsApp, offline sync, IoT, and AI classification are deferred until core operations are stable.

## Planned stack
Node.js 24.x · TypeScript · Next.js (web) · Express 5 (API) · PostgreSQL · parameterized SQL via pg · server-managed sessions · Vitest/Supertest · GitHub Actions (API/database regression and concurrent-allocation verification; browser E2E remains a hardening gate).

Direct dependency versions are pinned in workspace manifests. The npm lockfile is committed and clean-install verification runs in CI. The API is the business-rule and authorization boundary. The first release uses a modular monolith, not microservices.

## Documentation (five files maximum)
- [Project Specification](docs/PROJECT_SPECIFICATION.md) — scope, roles, requirements, workflows, business rules, acceptance criteria.
- [System Architecture](docs/SYSTEM_ARCHITECTURE.md) — application boundaries, API conventions, security, configuration, operations.
- [Database Design](docs/DATABASE_DESIGN.md) — entities, relationships, constraints, indexes, transactions, data lifecycle.
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) — phases, dependencies, quality gates, agent rules, progress.
- This README — overview, setup entry point, and current status.

## Database-first workflow
The PostgreSQL schema is maintained in `database/001_schema.sql`. Create a local `waste_management` database, apply the schema with `psql -v ON_ERROR_STOP=1 -d waste_management -f database/001_schema.sql`, then verify tables, constraints, views, and triggers using `database/README.md`.

## Local setup
Prerequisites: Node.js 24.x, npm, Git, PostgreSQL 15+, and Git Bash (for the grants helper). Run `npm ci`, create the `waste_management` database, and apply `database/001_schema.sql`. In Git Bash, set `POSTGRES_USER=postgres`, `POSTGRES_DB=waste_management`, `PGHOST=localhost`, `PGPASSWORD` (the local PostgreSQL superuser password), and a strong `APP_DB_PASSWORD`, then run `bash database/002_grants.sh`. Copy `.env.example` to `.env` and set `DATABASE_URL` to the `waste_app` role, `PRIVATE_STORAGE_DIR`, and `TRUST_PROXY_HOPS=0` for direct local development. Start the API with `npm run dev:api` and the web app with `npm run dev:web`. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:verify`, and `npm run build`. Run `database/002_smoke_test.sql` for database integrity checks and `database/003_reporting_queries.sql` for the DBMS reporting-query suite.

Never commit real credentials, session secrets, database passwords, or private user-uploaded files. Only placeholder values belong in .env.example.

## Production deployment starter

A Docker Compose deployment is provided for a single Linux host with a DNS name. It runs PostgreSQL 16, the API, Next.js web app, private evidence volume, and Caddy-managed HTTPS.

1. Point the chosen domain's DNS A/AAAA records at the host and allow inbound TCP 80/443.
2. Copy `.env.production.example` to `.env.production`. Set a long random URL-safe database password and a unique bootstrap administrator password; never commit this file.
3. Validate configuration: `docker compose --env-file .env.production config --quiet`.
4. Start: `docker compose --env-file .env.production up -d --build`. On a fresh PostgreSQL volume, `database/001_schema.sql` initializes the schema and `database/002_grants.sh` creates a non-superuser `waste_app` runtime role with DML-only grants.
5. Create the first administrator once: `docker compose --env-file .env.production exec api npm run bootstrap:admin --workspace @waste/api`.
6. Remove `BOOTSTRAP_ADMIN_PASSWORD` (and the email if desired) from `.env.production`, then restart the API: `docker compose --env-file .env.production up -d api`.
7. Verify `https://DOMAIN/api/v1/ready`, sign in, configure fest dates/timezone, locations, categories, roles, teams and real processing destinations.

The API and web containers run as UID 1000 and are not published directly; Caddy terminates HTTPS and proxies `/api/*` to the API. PostgreSQL uses a superuser only for initialization/backup and a non-superuser `waste_app` role for runtime DML. PostgreSQL data and private evidence use separate persistent volumes. Run `bash scripts/backup-compose.sh` to archive both the database and private evidence with checksums; copy the result off-host and verify restore regularly. Use a URL-safe password for the interpolated database URL. This is a single-host deployment starter, not a substitute for host hardening, firewall policy, monitoring, off-host encrypted backups, or a production restore drill. The schema SQL is an initial-database bootstrap; existing volumes require reviewed forward migrations, never rerun the bootstrap script blindly.

## Engineering principles
- A screen is not a completed feature; the full business workflow must work.
- Server-side authorization is mandatory; hiding a button is not security.
- Validate all external input and protect state transitions with domain rules.
- Use database constraints and transactions for important invariants.
- Keep audit history for sensitive operational changes.
- Test success, invalid input, denied permissions, and failure paths.
- Documentation must describe real implemented behavior, not pretend features exist.

## Verified delivery status

- [x] Core single-fest application, PostgreSQL schema, API, public reporting portal and staff dashboard implemented.
- [x] Authentication, session validation/revocation, server-side permission checks, user/role administration and last-administrator protection implemented.
- [x] Report lifecycle, duplicate linking, public tracking, manager notes, private evidence uploads and evidence-review screens implemented.
- [x] Location/category administration, teams, memberships, rounds, tasks, assignments, collection submissions and manager decisions implemented.
- [x] Verified-only material batches, segregation, destinations, allocations and database balance guards implemented.
- [x] In-app notifications, announcements, analytics, date-scoped printable final fest report, CSV exports, fest settings and audit-log screens implemented.
- [x] CI passed on 2026-11-21 for commit `db3906f432e9c0b9f78c74e4b4e499dbbc2e0168`: clean `npm ci`, `npm audit` (0 advisories), typecheck, lint, 19 Vitest tests, PostgreSQL 16 schema verification and integrity smoke tests as a non-superuser runtime role, actor/request audit-context assertion, two-connection allocation race, reporting SQL, PostgreSQL dump/restore round trip, production build, Compose validation, Docker image build and non-root container check.
- [ ] Expand role/resource authorization and lifecycle regression coverage; add browser-level journeys.
- [x] CI verifies PostgreSQL backup/restore, non-superuser runtime privileges, audit context and a two-connection concurrent-allocation race; coordinated production database+evidence restore drill and live host/domain deployment remain operator tasks.
- [ ] Complete operational security review and confirm fest-specific settings, privacy/retention policy, hosting and persistent private storage before production use.

The current Vercel deployment hosts only the Next.js web application. The Express API is a separate long-running service and is not deployed by that Vercel project. Do not point production traffic at a placeholder API URL. Complete API hosting, database connectivity, durable private evidence storage, production secrets, end-to-end verification, backup/restore validation, and fest-specific configuration before announcing the system as operational.
