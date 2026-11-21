# Project Specification

## 1. Purpose

Coordinate waste operations for one BAUST CSE Fest through a traceable workflow: report or planned cleaning → review and prioritization → task assignment → collection evidence and weight → verification → segregation → recycling/disposal → event report.

A report is not proof of collection. A task is not complete until evidence is submitted and accepted. Disposal/recycling is tracked separately from collection.

## 2. Scope

### First release
- One configured fest with dates, operating status, and timezone.
- Accounts, secure sessions, profiles, roles, and permissions.
- Waste issue reporting by attendees/staff; anonymous reporting is supported and does not require a registered account.
- Zone/area hierarchy, waste categories, and bin inventory.
- Report review, prioritization, duplicate linking, and status history.
- Scheduled cleaning rounds as well as report-driven tasks.
- Teams, team leads, volunteer membership, availability, and assignments.
- Task progress, collection submissions, photo evidence, weight, and verification.
- Segregation, recycling handover, disposal, and material reconciliation.
- In-app notifications, announcements, role-specific dashboards, CSV export, and final fest report.
- Audit trail, automated tests, deployment configuration.

### Deferred
QR workflows, live/geospatial tracking, SMS/WhatsApp provider integration, push notifications, offline-first sync, IoT sensors, AI image classification, predictive analytics, multi-fest tenancy, payments, and public chat. Add these only after a real requirement, cost, security review, and acceptance criteria exist.

## 3. Actors and permissions

| Role | Responsibility | Boundary |
|---|---|---|
| Administrator | Configure event, users, roles, categories, locations, settings | Full administration; sensitive actions audited |
| Fest Organizer | Monitor event operations and read analytics | Read-only operational access by default |
| Waste Manager | Review reports, plan/assign work, verify collection, record disposal | Operational write access |
| Team Lead | Coordinate team and team-scoped tasks | No global administration |
| Volunteer/Collector | Work assigned tasks and submit evidence | Own assignments and permitted team task data |
| Reporter | Submit and track reports | Own reports; anonymous access only through secure tracking token |

Roles are granted by an Administrator. Public signup never grants privileged roles. Every protected action is authorized on the server. Anonymous tracking reveals only safe reporter-facing status and timestamps, never internal notes, contact details, or staff identity.

## 4. Functional requirements

### FR-01 Identity
Secure login/logout, current-user profile, password hashing, revocable sessions, account suspension, role grants, and session invalidation. Public registration, if enabled, grants Reporter only.

### FR-02 Reporting
Capture report ID, event, area, optional bin, category, description, optional photo, reporter urgency hint, server-assigned operational priority, status, and timestamps. Support list/detail/filter/pagination, review, reject with reason, duplicate linking, internal/public notes, task linking, and secure tracking.

Report lifecycle: Submitted → Under Review → Accepted → In Progress → Resolved. Rejected and Duplicate are review outcomes. Reopened returns a resolved report to an actionable state with reason. Authorized staff may Cancel with reason.

### FR-03 Locations and bins
Configure zones, nested areas (stage, food court, exhibition, gaming, corridor, washroom, parking, etc.), categories, and bins. Track active status, bin type/category, area, capacity where known, and manual inspection observations. Deactivate rather than delete historical reference data.

### FR-04 Cleaning and tasks
Managers create one-off or recurring cleaning rounds and standalone tasks, or tasks linked to accepted reports. A task can address several reports. Assign users and/or teams, set priority and due window, record progress, reassign/cancel with reason, and retain assignment/status history.

Task lifecycle: Draft → Open → Assigned → In Progress → Submitted for Verification → Verified. Rejected evidence returns to In Progress. Cancelled is terminal. If work is needed again, an authorized Manager creates a replacement task and links the relevant report(s); the cancelled task remains in history. Overdue is derived from due date, not a lifecycle status.

### FR-05 Collection evidence
Volunteer submits collection timestamp, one or more material/weight records, measurement method, notes, and optional photos. Use positive decimal weights and explicit unit conversion. A task may have multiple collection batches. Only accepted/verified records count in official totals. Corrections require a reason and preserve original values.

### FR-06 Material flow
Record segregation/sorting, recyclable quantities and destination/recipient, and disposal quantities and destination/facility. Partial processing is allowed. Never allocate more material downstream than the verified available quantity. Show collected, processed, and awaiting-processing balances.

### FR-07 Workforce
Create teams, appoint team leads, manage time-bounded memberships and volunteer availability, assign work, and show workload/performance. Inactive users cannot receive new assignments; historical membership remains queryable.

### FR-08 Notifications
Create in-app notifications for report updates, assignments, reminders, verification decisions, and announcements. Notifications are recipient-scoped and have read/unread state. External email/SMS/WhatsApp is deferred; core operations must work without external provider credentials.

### FR-09 Dashboard and analytics
Show reports by status/category/priority/area; open and overdue tasks; verification backlog; workload; verified collected weight; recycled/disposed/awaiting quantities; average review/resolution time; and area hotspots. Provide date/area/category filters and authorization-safe CSV export. Final report states event/date scope and metric definitions.

### FR-10 Administration and audit
Manage accounts, roles, categories, zones/areas/bins, event configuration, announcements, and audit views. Audit actor, action, entity, timestamp, request ID, and safe metadata. Never log passwords, tokens, or unnecessary personal data.

## 5. Business rules

1. Every report/task belongs to the configured event and valid area.
2. Store timestamps in UTC; display in event timezone (default Asia/Dhaka until confirmed).
3. Reporter urgency is advisory; authorized staff set operational priority.
4. Status transitions are explicit and server-validated; clients cannot set arbitrary statuses.
5. Rejection, cancellation, reopening, reassignment, and correction require reasons where applicable.
6. Duplicate reports point to a canonical report and cannot independently create work.
7. Only verified collection records count in official collected-weight metrics.
8. Recycling/disposal cannot exceed available verified material.
9. Store canonical weight in kilograms using decimal arithmetic; preserve original entered unit/value when needed.
10. Deactivated users/areas/categories remain visible in historical records.
11. Task verification requires accepted evidence or an explicit authorized no-waste/false-alarm closure reason.
12. Frontend visibility never replaces server-side permission checks.

## 6. Non-functional requirements

- Security: secure cookies, strong password hashing, CSRF controls, input validation, output encoding, rate limits, upload allowlists, least privilege.
- Reliability: transactions for multi-record changes; no silent partial writes.
- Performance: pagination, bounded uploads, indexed filters, aggregated dashboard queries.
- Accessibility: semantic HTML, keyboard support, focus visibility, labels, contrast, clear validation.
- Responsive: mobile and desktop usability.
- Maintainability: modular boundaries, strict typing, consistent errors, migrations, documented decisions.
- Observability: structured logs, request correlation, health/readiness checks; no secrets in logs.
- Privacy: collect minimum reporter data; retention and anonymous reporting policy require organizer approval.
- Localization: prepare for Bangla/English; confirm initial interface language before UI build.

## 7. Confirmed stakeholder decisions
- Scope: one BAUST CSE Fest only.
- Reporting: anonymous reporting is supported.
- Database identifiers: English naming convention.

## 8. Decisions to confirm before production

Fest dates/hours and map; anonymous reporting and abuse controls; who verifies collections and disposal; available scales and measurement process; actual waste categories and real disposal/recycling partners; interface language/branding; privacy and retention policy; hosting/database/object-storage provider. Do not invent partners or operational facts.

## 9. First-release acceptance

- Reporter can submit and track a report without accessing other users' private data.
- Manager can review and link reports to tasks; Manager can also schedule cleaning without a report.
- Volunteer can access only permitted assignments and submit evidence/weight.
- Manager can verify or reject submissions with history.
- Only verified quantities appear in official totals.
- Recycling/disposal balances reconcile and cannot be over-allocated.
- API permission tests cover all roles and resource scopes.
- Sensitive changes are audited.
- Critical journeys pass automated tests and production build succeeds.
