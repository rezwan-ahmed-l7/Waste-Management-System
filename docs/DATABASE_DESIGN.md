# Database Design

## 1. Principles

PostgreSQL is the source of truth. Use normalized relational entities, foreign keys, unique/check constraints, transaction-safe services, and forward-only migrations.

- UUID primary keys; opaque public identifiers.
- timestamptz stored in UTC; display in event timezone (default Asia/Dhaka pending confirmation).
- Decimal/numeric quantities, never floating point.
- Canonical stored weight unit: kilograms; preserve entered unit/value when needed.
- Deactivate reference records rather than deleting records used by history.
- Do not store mutable derived totals as an independent source of truth.

## 2. Identity and access

| Table | Key fields | Purpose |
|---|---|---|
| users | id, email, display_name, password_hash, phone?, status, timestamps | Account |
| roles | id, key, name, description | Role catalogue |
| permissions | id, key, description | Atomic capabilities |
| user_roles | user_id, role_id, granted_by, granted_at | Role grants |
| role_permissions | role_id, permission_id | Role permission map |
| sessions | id, user_id, session_hash, expires_at, created_at, last_seen_at | Revocable sessions |
| password_reset_tokens | id, user_id, token_hash, expires_at, used_at | Optional reset flow |

Normalize email and enforce uniqueness when present. Never create fake user accounts for anonymous reports.

## 3. Event and locations

| Table | Key fields | Purpose |
|---|---|---|
| fest_events | id, name, slug, starts_at, ends_at, timezone, status | Event configuration |
| zones | id, event_id, name, code, description, is_active | High-level zone |
| areas | id, zone_id, parent_area_id?, name, code, area_type, is_active | Hierarchical place |
| waste_categories | id, event_id?, key, name, is_hazardous, is_recyclable, is_active | Waste taxonomy |
| waste_bins | id, area_id, code, category_id?, capacity_kg?, is_active | Bin inventory |
| bin_observations | id, bin_id, observed_by, observed_at, fill_level?, condition, notes | Manual inspection |

Enforce scoped uniqueness for event/zone/area/bin codes. A bin may optionally have a category when it accepts one material type.

## 4. Reporting and review

| Table | Key fields | Purpose |
|---|---|---|
| waste_reports | id, event_id, reporter_user_id?, anonymous, tracking_token_hash?, area_id, bin_id?, category_id, description, reporter_urgency, operational_priority, status, canonical_report_id?, timestamps | Submitted issue |
| report_photos | id, report_id, uploaded_by?, storage_key, mime_type, byte_size, checksum, created_at | Private evidence metadata |
| report_status_history | id, report_id, from_status, to_status, changed_by?, reason, visibility, created_at | Transition history |
| report_notes | id, report_id, author_id, body, visibility, created_at | Internal/public note |
| report_task_links | report_id, task_id, link_type, linked_by, linked_at, ended_at? | Many-to-many linkage and active primary-task lifecycle |

Anonymous tracking tokens are high entropy; store only hashes and never log raw tokens. Duplicate reports point to a canonical report and cannot independently create collection work. A report may have at most one active PRIMARY task link; enforce this with a partial unique index on report_id where link_type='PRIMARY' and ended_at IS NULL. Close the link when its task is cancelled or no longer responsible; retain historical links.

## 5. Workforce and tasks

| Table | Key fields | Purpose |
|---|---|---|
| teams | id, event_id, name, code, team_lead_user_id?, is_active | Team |
| team_memberships | id, team_id, user_id, role_in_team, starts_at, ends_at | Historical membership |
| volunteer_availability | id, user_id, starts_at, ends_at, availability_status, note | Availability |
| cleaning_rounds | id, event_id, area_id, title, instructions, planned_start_at, planned_end_at, recurrence_rule?, status, created_by | Planned cleaning |
| collection_tasks | id, event_id, cleaning_round_id?, area_id, title, instructions, priority, status, due_at, created_by, verified_by?, verified_at?, closure_reason?, timestamps | Actionable work and explicit verification/no-waste closure |
| task_assignments | id, task_id, user_id?, team_id?, assigned_by, assigned_at, unassigned_at, note | Assignment history |
| task_status_history | id, task_id, from_status, to_status, changed_by, reason, created_at | Transition history |

Each assignment row targets exactly one user or one team, never both. Enforce this with a CHECK constraint. Use partial unique indexes to prevent duplicate active assignments. Historical memberships and assignments remain queryable.

## 6. Collection and material flow

| Table | Key fields | Purpose |
|---|---|---|
| collection_submissions | id, task_id, submitted_by, submitted_at, status, notes, verified_by?, verified_at?, verification_note | Completion evidence submission |
| collection_records | id, submission_id, category_id, entered_weight, entered_unit, weight_kg, measurement_method, measured_at, note | Measured material batch |
| collection_photos | id, submission_id, uploaded_by, storage_key, mime_type, byte_size, checksum, created_at | Evidence metadata |
| material_batches | id, collection_record_id, category_id, available_weight_kg, created_at | Verified quantity available |
| segregation_records | id, source_batch_id, output_category_id, weight_kg, recorded_by, recorded_at, note | Sorting/splitting |
| recycling_records | id, source_batch_id?, segregation_record_id?, weight_kg, destination_name, handed_over_at, recorded_by, evidence_key? | Recycled/handover amount |
| disposal_records | id, source_batch_id?, segregation_record_id?, weight_kg, destination_name, disposed_at, recorded_by, evidence_key? | Disposal amount |
| material_adjustments | id, source_batch_id, delta_weight_kg, reason, created_by, created_at | Audited correction/variance |

Only verified submissions create official material batches. Segregation output total cannot exceed source input. Recycling/disposal cannot exceed the remaining source quantity. Lock the source batch or use suitable transaction isolation and retry logic to prevent concurrent over-allocation. Remaining balance is derived from verified input minus accepted downstream allocations and approved adjustments.

## 7. Communications and audit

| Table | Key fields | Purpose |
|---|---|---|
| notifications | id, recipient_user_id, type, title, body, resource_type, resource_id, read_at, created_at | In-app notification |
| announcements | id, event_id, title, body, audience_rule, published_by, published_at, expires_at, status | Event announcement |
| audit_logs | id, actor_user_id?, action, entity_type, entity_id, request_id, safe_metadata, created_at | Sensitive action history |
| idempotency_keys | id, key_hash, actor_user_id, operation, response_reference, expires_at | Retry protection |
| outbox_events | id, event_type, aggregate_type, aggregate_id, payload, created_at, processed_at, attempts | Future reliable async delivery |

Do not store full request bodies in audit logs. Store safe metadata and only policy-approved changed fields.

## 8. Relationships

- Event → zones, categories, reports, cleaning rounds, tasks.
- Zone → areas; area → child areas, bins, reports, tasks.
- User ↔ roles ↔ permissions.
- User → reports (optional for anonymous), notes, assignments, submissions, notifications, audit actions.
- Report → photos, notes, status history; reports ↔ tasks via report_task_links.
- Team ↔ users over time via team_memberships.
- Cleaning round → tasks; task → assignments, submissions, status history.
- Submission → collection records and photos.
- Verified collection record → material batch → segregation → recycling/disposal allocations.
- Audit records refer to actor and affected entity without requiring destructive cascades.

## 9. Constraints and indexes

Constraints:
- Unique normalized email where present; unique role/permission keys.
- Unique event slug and scoped location/category/bin codes.
- Foreign keys for all required references.
- Positive weights; non-negative bin capacity; allowlisted units.
- Event end after start; cleaning-round end after start.
- Task VERIFIED state requires verifier and timestamp; if there are no accepted collection records, require a non-empty authorized no-waste/false-alarm closure reason.
- Assignment row has exactly one target.
- Duplicate report references a different canonical report.
- Verified submission has verifier and verification timestamp.
- Recycling/disposal allocation references exactly one source (material batch or segregation output), enforced by a CHECK constraint.
- No cross-event task/report links.
- Use partial unique indexes for active assignments/memberships and active primary report-task links.

Indexes:
- users(normalized_email) unique; sessions(user_id, expires_at), session_hash unique.
- reports(event_id, status, created_at DESC), (area_id, created_at DESC), (category_id, created_at DESC).
- report_status_history(report_id, created_at DESC).
- tasks(event_id, status, due_at), (area_id, status).
- assignments(user_id, unassigned_at), (team_id, unassigned_at).
- submissions(task_id, submitted_at DESC, status).
- collection_records(category_id, measured_at DESC).
- notifications(recipient_user_id, read_at, created_at DESC).
- audit_logs(entity_type, entity_id, created_at DESC), (actor_user_id, created_at DESC).

Validate important query indexes with EXPLAIN ANALYZE using representative data; do not add indexes without a query reason.

## 10. Status catalogues

- User: INVITED, ACTIVE, SUSPENDED, DISABLED.
- Event: DRAFT, ACTIVE, COMPLETED, ARCHIVED.
- Report: SUBMITTED, UNDER_REVIEW, ACCEPTED, IN_PROGRESS, RESOLVED, REJECTED, DUPLICATE, REOPENED, CANCELLED.
- Cleaning round: DRAFT, SCHEDULED, ACTIVE, COMPLETED, CANCELLED.
- Task: DRAFT, OPEN, ASSIGNED, IN_PROGRESS, SUBMITTED_FOR_VERIFICATION, VERIFIED, CANCELLED.
- Collection submission: SUBMITTED, VERIFIED, REJECTED.

A status value does not authorize a transition; domain services enforce allowed transitions.

## 11. Transaction boundaries

Use transactions for report review + history + task link + audit; task assignment + history + notification; collection verification + batch creation + task/report progression; and segregation/recycling/disposal + balance reconciliation + audit.

Quantity allocation must re-check available quantity inside a transaction while locking the source batch or using suitable isolation. Concurrent requests must not over-allocate.

## 12. Migrations, seeds, privacy

- Commit forward migrations; never edit an already-applied migration.
- Every migration must work from an empty database and from previous schema.
- Seed roles, permissions, categories, sample event/areas, and clearly fake test users in dev/test only.
- Never seed a production default password or public admin credential.
- Production admin bootstrap must be a secure one-time process.
- Define retention with organizers before production. Preserve operational history; anonymize eligible personal fields when policy requires. Remove private images according to retention policy and revoke expired anonymous tokens.

## 13. Metric definitions

- Submitted reports: reports created in selected event/date scope; duplicates excluded only where metric says canonical reports.
- Open reports: actionable non-terminal reports.
- Verified collected weight: sum of collection_records.weight_kg for verified submissions only.
- Recycled/disposed weight: accepted downstream handovers only.
- Awaiting processing: verified input minus accepted downstream allocations and approved adjustments.
- Recycling rate: recycled weight / verified collected weight for matching scope and compatible units; show denominator and never mix categories/scopes.

Use one analytics implementation for dashboard and exports.


## Confirmed project decisions
- Single BAUST CSE Fest; no multi-fest tenancy in this release.
- Anonymous reporting is supported; high-entropy tracking tokens are stored as hashes.
- English snake_case identifiers.
- PostgreSQL schema implementation: `database/001_schema.sql` (added with the database foundation).
