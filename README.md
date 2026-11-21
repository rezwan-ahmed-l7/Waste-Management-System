# BAUST CSE Fest Waste Management System

A DBMS-first full-stack operational platform to coordinate waste reporting, scheduled cleaning, collection, segregation, recycling, disposal, and event-level reporting for BAUST CSE Fest.

> **Status:** Implementation is in progress on `docs/project-blueprint`. Do not merge into `main` until all work and verification are complete and the owner approves.

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
8. Dashboards, analytics, CSV export, final event report, and audit logs.

Advanced QR, live map, SMS/WhatsApp, offline sync, IoT, and AI classification are deferred until core operations are stable.

## Planned stack
Node.js 24.x · TypeScript · Next.js (web) · Express 5 (API) · PostgreSQL · parameterized SQL via pg · server-managed sessions · Vitest/Supertest · GitHub Actions (Playwright end-to-end suite planned for final hardening).

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
Prerequisites: Node.js 24.x, npm, Git, and PostgreSQL 15+. Run `npm ci`, copy `.env.example` to `.env`, set `DATABASE_URL` and `PRIVATE_STORAGE_DIR`, create the `waste_management` database, and apply `database/001_schema.sql`. Start the API with `npm run dev:api` and the web app with `npm run dev:web`. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:verify`, and `npm run build`. Run `database/002_smoke_test.sql` for database integrity checks and `database/003_reporting_queries.sql` for the DBMS reporting-query suite.

Never commit real credentials, session secrets, database passwords, or private user-uploaded files. Only placeholder values belong in .env.example.

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
- [x] In-app notifications, announcements, analytics, CSV exports, fest settings and audit-log screens implemented.
- [x] CI passed on 2026-11-21 for commit `f879b7237e8e4e63cee4441e07be04ce5c561a58`: clean `npm ci`, `npm audit` (0 advisories), typecheck, lint, 11 Vitest tests, PostgreSQL 16 schema verification, database smoke tests, reporting SQL, PostgreSQL 16 dump/restore round-trip verification and production build.
- [ ] Add broad role/resource authorization and lifecycle regression coverage plus browser-level end-to-end journeys.
- [ ] Add a tested backup/restore drill and production deployment configuration.
- [ ] Complete operational security review and confirm fest-specific settings, privacy/retention policy, hosting and persistent private storage before production use.

The core implementation is not a production deployment. Keep this branch unmerged until the remaining verification and operational gates are complete and the owner explicitly approves integration.
