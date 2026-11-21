# Implementation Plan

## 1. Delivery approach

Build small vertical slices and keep implementation coherent. The project owner explicitly requires all work to remain on the single branch `docs/project-blueprint` until the entire project is complete. Do not create feature branches. Do not modify or merge into `main`; final integration requires explicit owner approval after all verification gates pass.

All commits stay on `docs/project-blueprint`. Never create feature branches, commit to `main`, merge, or rebase into `main`. Do not merge until the entire project is complete, all tests pass, and the owner explicitly approves.

## 2. Phases and exit gates

### Phase 0 — Documentation and decisions
Deliver: five-document baseline and consistency review.

Confirmed: one BAUST CSE Fest only; anonymous reporting is supported; database identifiers use English snake_case; all work remains on `docs/project-blueprint` until final owner approval.

Still requiring organizer confirmation before production: fest dates/map, final waste taxonomy, verification authority, privacy/retention policy, hosting and storage provider.

Exit: documents agree on roles, status transitions, entity names, metrics, and API concepts; critical business rules are not contradictory.

### Phase 1 — Engineering foundation
Deliver: Node 24.x TypeScript workspace, web/API scaffold, strict config, lint/typecheck scripts, PostgreSQL schema, environment validation, safe errors, health/readiness endpoints, CI and a first anonymous-reporting vertical slice.

Exit: clean install from a committed lockfile, CI passes on fresh checkout, schema and smoke tests run on clean PostgreSQL, no secrets committed.

### Phase 2 — Identity and access
Deliver: users/roles/permissions/sessions, secure login/logout/me, password hashing, session rotation/revocation, server permission middleware, admin user management.

Exit: tests cover invalid/expired/revoked/disabled sessions and allow/deny authorization for each role/resource scope.

### Phase 3 — Event and location
Deliver: event configuration, zones, areas, categories, bins, admin interfaces, dev seed data.

Exit: invalid/cross-event references rejected; inactive locations cannot receive new work; historical references remain readable.

### Phase 4 — Reporting
Deliver: create/list/detail/filter reports, uploads, review, duplicate linking, status history, reporter status view, anonymous token tracking only if approved.

Exit: lifecycle tests pass; upload security and private evidence access tested; reporters cannot access others' private reports/internal notes; duplicates cannot create duplicate work.

### Phase 5 — Workforce and collection
Deliver: teams, memberships, availability, cleaning rounds, tasks, assignments, progress, evidence submissions, manager verification/rejection.

Exit: team/resource authorization passes; assignment/status history retained; no verification without accepted evidence or explicit authorized no-waste closure; rejected submissions can be corrected without losing history; cancelled tasks are not reopened, replacement work is created and linked.

### Phase 6 — Material flow
Deliver: weight records, segregation, recycling, disposal, material balances, transaction-safe allocation.

Exit: verified-only totals correct; concurrent allocation cannot exceed source quantity; balances reconcile; corrections preserve audit history.

### Phase 7 — Notifications and analytics
Deliver: in-app notifications, announcements, role-specific dashboards, filters, CSV exports, final event report.

Exit: metric values match documented definitions; export authorization matches UI; queries are bounded; notification failure cannot undo core work.

### Phase 8 — Hardening and handover
Deliver: end-to-end tests, accessibility/security/performance review, deployment config, backup/restore procedure, accurate setup/run/test docs, sample data clearly labelled.

Exit: clean CI and production build; critical Playwright journeys pass; no known high-severity security issue; backup restore tested; owner receives exact local run instructions and limitations.

## 3. Required end-to-end journeys

1. Reporter submits → Manager reviews → task created → Volunteer completes → Manager verifies → Reporter sees resolved status.
2. Manager schedules cleaning without a report → creates area tasks → assigns team → Volunteer submits evidence → Manager verifies.
3. Verified material is segregated → recyclable fraction handed over → remainder disposed → balance reconciles.
4. Organizer views authorized dashboard → filters date/area → exports same permitted metrics.
5. Administrator suspends user → active session is rejected → audit event is visible.
6. Anonymous report (if enabled) → tracking token exposes safe reporter-facing status only.

## 4. Quality gate for every change

Before marking a task complete:
- Read relevant sections of the five docs and inspect existing code/tests.
- State expected behavior, impacted modules, risks, and test plan.
- Implement the smallest coherent change.
- Add tests for success, invalid input, denied permissions, and important failure cases.
- Run formatter, lint, typecheck, relevant tests, and build as applicable.
- For schema changes, run migration from a clean database and test migration/seed repeatability.
- Inspect diff for unrelated edits, secrets, debug code, unsafe logs, and generated files.
- Update relevant documentation if behavior/decisions changed.
- Report exact commands and results; never claim a test ran if it did not.

If a check fails: capture the error, identify root cause, fix the underlying issue, rerun the failed check, then rerun affected regression tests and broader checks. Report the failure, fix, and final result. Do not stop at the first avoidable failure.

## 5. AI coding-agent rules

1. Read README and relevant specification, architecture, database, and plan sections before coding.
2. Plan before editing: files, behavior, dependencies, risks, and tests.
3. Do not invent requirements. Ask when a decision changes privacy, security, data ownership, workflow, or external cost.
4. Do not replace framework/database/ORM/auth/architecture without explaining trade-offs and updating docs.
5. Keep business logic in domain services; controllers thin; frontend is not a security boundary.
6. No destructive migration, production data mutation, secret exposure, or public evidence storage.
7. No fake completion: no placeholder success, hard-coded dashboard metrics, fake auth, or mock-only tests presented as end-to-end.
8. Run tests, fix change-related failures, and rerun until green or isolate a genuine external blocker.
9. Keep diffs focused; avoid mass formatting churn and unnecessary dependencies/commits.
10. Maintain the five-file documentation limit; update these docs rather than adding planning files.
11. Never disable tests, lint, type checks, or security controls just to get green.
12. Report implemented, tested, untested, blocked, and assumed behavior distinctly.

## 6. Branch and commit policy

- All project work stays on \`docs/project-blueprint\`, including schema, API, frontend, tests, documentation and CI.
- Do not create feature branches, push commits to \`main\`, open an early merge, or rebase into \`main\`.
- Keep \`main\` unchanged until every phase and final verification gate is complete.
- Merge only after the project owner explicitly approves the final integration.
- Use concise conventional commit prefixes: docs:, feat:, fix:, test:, refactor:, chore:.
- Prefer logical commits; avoid one commit per trivial edit and avoid giant opaque commits.

## 7. Definition of Done

A feature is done only when requirements and permissions are documented; UI/API/domain/persistence work together; validation and error states exist; authorization is enforced and tested server-side; writes are transaction-safe/auditable where needed; relevant tests pass; lint/typecheck/build pass; docs are accurate; and no known change-related regression remains.

## 8. Progress tracker

### Phase 0 — Documentation
- [x] Inspect repository and default branch.
- [x] Create isolated documentation branch.
- [x] Add five-document baseline (README plus four docs).
- [x] Cross-document consistency and internal documentation links verified.
- [x] Confirm single-fest scope, anonymous reporting, and English database identifiers.
- [x] Confirm single-branch delivery policy.
- [ ] Confirm remaining operational details before production.

### Phase 1 — Foundation progress
- [x] Add PostgreSQL relational schema, reference data, indexes, views and integrity triggers.
- [x] Add transactional database smoke-test script and CI PostgreSQL service.
- [x] Add Node/TypeScript workspaces, Express API, Next.js web scaffold and shared Zod contract.
- [x] Add public anonymous report submission and private token status endpoint.
- [x] Commit npm lockfile and pass clean-install CI.
- [x] Execute schema and smoke tests in CI; resolve any SQL/runtime failures.

### Phase 2 — Identity and access progress
- [x] Add password-hashed login, logout, current-session endpoint and server-side permission middleware.
- [x] Add role assignment, administrator account creation, account suspension and session revocation.
- [x] Protect the last active administrator from accidental removal or suspension.
- [x] Add middleware allow/deny and invalid/expired session regression tests.
- [ ] Expand tests across every role/resource scope and privilege-change session behavior.

### Phase 3 — Event and location progress
- [x] Add single-fest configuration, zones, areas, bins and waste-category management APIs.
- [x] Add manager-facing location management UI and inactive-location safeguards.
- [x] Add fest metadata editing UI.
- [ ] Add additional hierarchy/retention tests.

### Phase 4 — Reporting progress
- [x] Add anonymous report submission, private tracking tokens, review, duplicate linking and status history.
- [x] Add public status timeline and public/internal manager notes.
- [x] Add private report evidence uploads with content-signature checks and authorized downloads.
- [x] Add manager-facing report evidence review UI and public/internal note controls.
- [x] Add report-note schema, anonymous tracking privacy, and final-report date-validation regression tests.
- [ ] Add complete report lifecycle and tracking-token regression tests.

### Phase 5 — Workforce and collection progress
- [x] Add teams, memberships, cleaning rounds, collection tasks, assignments and volunteer task scoping.
- [x] Add collection submissions, manager verification/rejection and authorized no-waste closure.
- [x] Add private collection evidence uploads and manager-only access.
- [ ] Add membership removal, deeper team-scope tests and end-to-end workflow tests.

### Phase 6 — Material flow progress
- [x] Create verified-only material batches automatically.
- [x] Add segregation, destination and allocation APIs with database-enforced source balances.
- [x] Add material balance views and manager-facing processing UI.
- [x] Add two-connection concurrent material allocation race test to CI.
- [ ] Add date-filtered final reconciliation test with realistic fixture data.

### Phase 7 — Notifications and analytics progress
- [x] Add in-app notifications, announcements, role/zone targeting, analytics and CSV exports.
- [x] Add manager dashboards for reports, tasks, teams, locations, rounds and materials.
- [x] Add date-scoped final fest report API, metric definitions and printable dashboard UI.
- [x] Add final-report date validation, timezone filter and metric contract tests.

### Phase 8 — Hardening and handover progress
- [x] Add PostgreSQL CI service, schema verification, database smoke tests, dependency audit and production build checks.
- [x] Resolve all npm audit findings in the locked dependency tree.
- [ ] Add browser-level journeys and broader role/resource authorization regression tests.
- [x] Verify PostgreSQL dump/restore round trip and schema/smoke/reporting checks in CI; production evidence-file backup remains an operator task.
- [x] Add Docker Compose/Caddy deployment template, non-root app containers, least-privilege PostgreSQL role, private evidence volume, administrator bootstrap and coordinated backup script; actual DNS/host provisioning and a real restore drill remain operator-owned.
- [ ] Complete final security, privacy/retention and operational review.

Do not mark a phase complete until its exit-gate evidence exists. A checked implementation item does not mean the whole phase is complete.
