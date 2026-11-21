# Implementation Plan

## 1. Delivery approach

Build small vertical slices and keep each branch coherent. Do not generate the whole application in one unreviewed batch. Do not mark a feature complete because its screen exists.

Work on feature branches from the agreed development baseline. Never commit directly to main. Use pull requests for integration and do not merge without the repository owner's explicit approval.

## 2. Phases and exit gates

### Phase 0 — Documentation and decisions
Deliver: five-document baseline, consistency review, confirmed event details, reporting policy, verification authority, waste taxonomy, language, privacy/retention, storage/hosting decisions.

Exit: documents agree on roles, status transitions, entity names, metrics, and API concepts; critical business rules are not contradictory. Record safe assumptions explicitly rather than inventing facts.

### Phase 1 — Engineering foundation
Deliver: Node 24.x TypeScript workspace, web/API scaffold, strict config, lint/format/typecheck scripts, PostgreSQL/Prisma connection, migrations, env validation, request IDs, safe errors/logging, health/readiness endpoints, CI.

Exit: clean install from lockfile, CI passes on fresh checkout, migrations run on clean PostgreSQL, no secrets committed.

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

- main: stable baseline; no direct commits.
- docs/project-blueprint: initial documentation-only work.
- feature branches: one coherent feature or vertical slice.
- Use concise conventional commit prefixes: docs:, feat:, fix:, test:, refactor:, chore:.
- Prefer logical commits; avoid one commit per trivial edit and avoid giant opaque commits.
- PR description includes scope, design notes, test commands/results, UI screenshots when relevant, and migration notes.
- Do not merge without explicit owner approval.

## 7. Definition of Done

A feature is done only when requirements and permissions are documented; UI/API/domain/persistence work together; validation and error states exist; authorization is enforced and tested server-side; writes are transaction-safe/auditable where needed; relevant tests pass; lint/typecheck/build pass; docs are accurate; and no known change-related regression remains.

## 8. Progress tracker

### Phase 0 — Documentation
- [x] Inspect repository and default branch.
- [x] Create isolated documentation branch.
- [x] Add five-document baseline (README plus four docs).
- [ ] Cross-document consistency and link verification.
- [ ] Confirm stakeholder decisions required before implementation.
- [ ] Pass Phase 0 exit gate.

### Later phases
Not started. Do not mark a phase complete until its exit-gate evidence exists.
