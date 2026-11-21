# System Architecture

## 1. Architecture choice

Use a **modular monolith**: one web application, one API service, one PostgreSQL database, with explicit domain-module boundaries. This is maintainable for the expected team and scope. Do not introduce microservices, service mesh, or distributed infrastructure without measured need.

## 2. Technology baseline

| Layer | Planned choice |
|---|---|
| Runtime | Node.js 24.x |
| Language | TypeScript, strict mode |
| Web | Next.js App Router + React |
| API | Express 5 REST API |
| Database | PostgreSQL |
| Data access | Parameterized SQL via pg; reviewed SQL schema |
| Authentication | Server-managed sessions, secure cookies |
| Password hashing | Argon2id or vetted equivalent if platform constraints require |
| Validation | Zod at external boundaries |
| Tests | Vitest, Supertest, Playwright |
| Quality/CI | ESLint, Prettier, TypeScript, GitHub Actions |
| Files | Storage adapter: private local dev storage; S3-compatible private object storage in production |

Direct dependencies are pinned to exact versions in workspace package manifests. A lockfile is still required before declaring reproducible installation complete.

## 3. Logical boundaries

**Web application:** routing, responsive UI, accessibility, forms, role-aware navigation, typed API client. It must not connect directly to PostgreSQL and is not an authorization boundary.

**API application:** authentication, authorization, validation, business rules, transactions, persistence, uploads, notifications, audit, errors, pagination, and filtering.

Domain modules:
- identity: users, sessions, roles, permissions.
- events: fest configuration and lifecycle.
- locations: zones, areas, bins.
- reporting: reports, review, duplicates, status history.
- workforce: teams, membership, availability.
- collection: cleaning rounds, tasks, assignments, evidence, verification.
- material-flow: categories, segregation, recycling, disposal, reconciliation.
- communications: in-app notifications and announcements.
- analytics: authorized read models, exports, final report.
- audit: append-only operational events.

Controllers remain thin. Domain services own business rules. Data access is isolated behind repositories/service boundaries where it adds value.

## 4. Proposed repository layout

    apps/web/                 Next.js frontend
    apps/api/                 Express API
    packages/contracts/       Shared schemas/types if justified
    database/001_schema.sql
    database/README.md
    scripts/verify-database.mjs
    docs/                     The four detailed project documents
    .github/workflows/
    .env.example
    package.json
    package-lock.json
    README.md

Do not create abstractions that only forward calls. Keep modules cohesive and avoid cross-module table access where practical.

## 5. Request lifecycle

1. Browser calls web app; web app calls API with session cookie when required.
2. API applies request ID, security headers, trusted-origin/CORS policy, rate limits, and body-size limits.
3. Authentication resolves session and active user.
4. Authorization checks permission and resource scope.
5. Route schema validates path, query, and body.
6. Controller invokes domain service.
7. Service enforces business invariants and starts transaction when multiple records must change together.
8. Persistence layer writes to PostgreSQL.
9. Audit and in-app notification records are created as part of the correct transaction.
10. API returns a stable response and request ID.

Never trust client-supplied user identity, role, status, ownership, or calculated totals.

## 6. API conventions

- Base path: /api/v1; JSON; camelCase; opaque UUID identifiers.
- Dates use ISO 8601; storage is UTC.
- Resource-oriented plural routes; bounded pagination; allowlisted sort/filter fields.
- State transitions use explicit actions or validated PATCH rules; arbitrary status updates are forbidden.
- Use idempotency keys for retry-prone mutations where justified.
- Success: { data, meta: { requestId } }.
- Error: { error: { code, message, details, requestId } }.
- Never expose stack traces, SQL details, secrets, internal paths, or raw provider errors.

### Implemented API surface

All routes are mounted under `/api/v1`. The current route inventory is visible in `apps/api/src/app.ts`; route groups are:

- Authentication: login, logout, current session.
- Reports: list/detail, start review, accept/reject, notes, private attachment listing/download.
- Public reporting: form options, anonymous report submission, token-protected status tracking.
- Identity administration: users, assignable users, roles, role assignment, account status.
- Fest and locations: fest settings, zones, areas, bins, waste categories and active-state changes.
- Workforce: teams, team memberships, cleaning rounds, round tasks, task list/detail, assignments, task start/cancel/no-waste closure.
- Collection: submission creation, evidence photos, manager verification/rejection.
- Material flow: overview, destinations, segregation and allocations.
- Communications: announcements, notifications and read-state updates.
- Analytics and operations: overview, CSV exports, audit logs, health and readiness.

The first release intentionally does not expose public signup, password reset, SMS/WhatsApp delivery, live maps, volunteer availability scheduling, QR, offline sync, or a multi-fest API.

## 7. Authentication and security

- Production traffic uses HTTPS; cookies are Secure, HttpOnly, and SameSite.
- Rotate session identifiers after login and privilege changes; revoke on logout, password reset, or suspension.
- Cookie-authenticated mutations reject a mismatched Origin; the session cookie is HttpOnly and SameSite=Lax. Validate browser deployment topology and add an explicit CSRF token if the web/API origin model changes.
- CORS allows configured origins only; never wildcard with credentials.
- Hash passwords using maintained Argon2id implementation and reviewed parameters.
- Rate-limit login and anonymous report submission. Add dedicated per-user upload throttling and production edge-level abuse controls before public launch.
- Validate every request field and uploaded file; encode untrusted output.
- Image uploads: allowlisted formats, inspect actual content type, enforce byte/dimension limits, server-generated names, private non-executable storage.
- Evidence access is authorized; do not expose permanent public file URLs.
- Use least-privilege database credentials and separate dev/test/prod secrets.
- Audit privileged actions without logging credentials, tokens, or sensitive payloads.
- Enable dependency and secret scanning in CI where available.

## 8. Transactions, audit, notifications

Atomic transactions are required for report review/history/task link; task assignment/history; collection verification/material batch creation; and segregation/recycling/disposal allocation/balance updates.

Audit is append-only at application level; corrections create compensating events. First release uses transactional in-app notification records. External delivery, if later added, uses an outbox and retry-safe worker. Provider outage must not undo core work.

## 9. File storage

Application code uses a storage adapter, not provider-specific calls. Development currently uses a private local directory. Production still requires a persistent private volume or a reviewed private object-storage adapter; public/static file serving is not supported. PostgreSQL stores metadata (owner, resource, key, MIME type, size, checksum, created time), not image binaries.

## 10. Configuration and operations

Validate environment variables at startup and fail fast with safe messages. Commit .env.example only with placeholders. Current config includes DATABASE_URL, API_HOST/API_PORT, WEB_ORIGIN, NEXT_PUBLIC_API_BASE_URL, PRIVATE_STORAGE_DIR and public-report rate limits. Session tokens are random and stored only as hashes; no static session secret is required. Production must not silently fall back to insecure auth or public storage.

Use structured logs with request IDs; health and readiness endpoints; avoid logging report text, personal details, cookies, secrets, or file content. Document backup/restore and test restore before production.

## 11. Architecture change policy

Any change to framework, database, ORM, authentication model, module boundary, or external service must include a written trade-off, updated docs, migration plan if needed, and tests. Prefer simple synchronous in-app behavior until scale or operational evidence justifies queues/caching/external services.
