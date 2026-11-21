# BAUST CSE Fest Waste Management System

A full-stack operational platform to coordinate waste reporting, scheduled cleaning, collection, segregation, recycling, disposal, and event-level reporting for BAUST CSE Fest.

> **Status:** Planning baseline. Application implementation has not started.

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
2. Waste reporting, review, duplicate handling, and status tracking.
3. Fest zones, areas, and waste-bin inventory.
4. Scheduled cleaning rounds and report-driven collection tasks.
5. Teams, volunteer assignments, workload, and progress.
6. Collection evidence, weight, verification, segregation, recycling, and disposal.
7. In-app notifications and announcements.
8. Dashboards, analytics, CSV export, final event report, and audit logs.

Advanced QR, live map, SMS/WhatsApp, offline sync, IoT, and AI classification are deferred until core operations are stable.

## Planned stack
Node.js 24.x · TypeScript · Next.js (web) · Express 5 (API) · PostgreSQL · Prisma · server-managed sessions · Vitest/Supertest/Playwright · GitHub Actions.

This is the planning baseline; exact dependency versions will be pinned in the implementation lockfile. The API is the business-rule and authorization boundary. The first release uses a modular monolith, not microservices.

## Documentation (five files maximum)
- [Project Specification](docs/PROJECT_SPECIFICATION.md) — scope, roles, requirements, workflows, business rules, acceptance criteria.
- [System Architecture](docs/SYSTEM_ARCHITECTURE.md) — application boundaries, API conventions, security, configuration, operations.
- [Database Design](docs/DATABASE_DESIGN.md) — entities, relationships, constraints, indexes, transactions, data lifecycle.
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) — phases, dependencies, quality gates, agent rules, progress.
- This README — overview, setup entry point, and current status.

## Local setup
The executable setup commands will be added with the application scaffold. Expected prerequisites: Node.js 24.x, Git, and PostgreSQL. After the scaffold exists, the documented workflow will be: clone → install from lockfile → configure local environment → migrate/seed database → run web and API → execute tests.

Never commit real credentials, session secrets, database passwords, or private user-uploaded files. Only placeholder values belong in .env.example.

## Engineering principles
- A screen is not a completed feature; the full business workflow must work.
- Server-side authorization is mandatory; hiding a button is not security.
- Validate all external input and protect state transitions with domain rules.
- Use database constraints and transactions for important invariants.
- Keep audit history for sensitive operational changes.
- Test success, invalid input, denied permissions, and failure paths.
- Documentation must describe real implemented behavior, not pretend features exist.

## Delivery status
- [x] Repository inspected; initial branch created.
- [x] Documentation cross-verification (five-file limit, links, role/status alignment, workflows, and data integrity rules reviewed).
- [ ] Stakeholder decisions confirmed before production.
- [ ] Application scaffold and implementation.
