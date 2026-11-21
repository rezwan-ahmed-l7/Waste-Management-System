-- BAUST CSE Fest Waste Management System: demonstration/reporting queries
-- Run with: psql -d waste_management -f database/003_reporting_queries.sql
SET search_path TO waste_mgmt, public;

-- 1. Report volume by current status.
SELECT status, COUNT(*) AS report_count
FROM waste_reports
GROUP BY status
ORDER BY report_count DESC, status;

-- 2. Pending reports with zone, area and category (multi-table JOIN).
SELECT r.report_id, r.submitted_at, r.priority, z.name AS zone,
       a.name AS area, wc.name AS waste_category, r.description
FROM waste_reports r
JOIN areas a ON a.area_id = r.area_id
JOIN zones z ON z.zone_id = a.zone_id
JOIN waste_categories wc ON wc.category_id = r.category_id
WHERE r.status IN ('submitted', 'under_review')
ORDER BY r.submitted_at;

-- 3. Report volume by zone, including zones with zero reports (LEFT JOIN).
SELECT z.zone_id, z.name AS zone,
       COUNT(r.report_id) AS report_count
FROM zones z
LEFT JOIN areas a ON a.zone_id = z.zone_id
LEFT JOIN waste_reports r ON r.area_id = a.area_id
GROUP BY z.zone_id, z.name
ORDER BY report_count DESC, z.name;

-- 4. Rank zones by report volume (window function).
WITH zone_counts AS (
  SELECT z.zone_id, z.name AS zone, COUNT(r.report_id) AS report_count
  FROM zones z
  LEFT JOIN areas a ON a.zone_id = z.zone_id
  LEFT JOIN waste_reports r ON r.area_id = a.area_id
  GROUP BY z.zone_id, z.name
)
SELECT zone, report_count,
       DENSE_RANK() OVER (ORDER BY report_count DESC) AS volume_rank
FROM zone_counts
ORDER BY volume_rank, zone;

-- 5. Verified collected weight by category. Unverified submissions are excluded.
SELECT wc.name AS category,
       COALESCE(SUM(cr.weight_kg) FILTER (WHERE cs.status = 'verified'), 0) AS verified_weight_kg,
       COUNT(cr.collection_record_id) FILTER (WHERE cs.status = 'verified') AS verified_records
FROM waste_categories wc
LEFT JOIN collection_records cr ON cr.category_id = wc.category_id
LEFT JOIN collection_submissions cs
  ON cs.submission_id = cr.submission_id AND cs.status = 'verified'
GROUP BY wc.category_id, wc.name
ORDER BY verified_weight_kg DESC;

-- 6. Daily verified collection trend.
SELECT DATE(cr.measured_at) AS collection_day,
       SUM(cr.weight_kg) AS collected_kg,
       COUNT(DISTINCT cr.submission_id) AS verified_submissions
FROM collection_records cr
JOIN collection_submissions cs ON cs.submission_id = cr.submission_id
WHERE cs.status = 'verified'
GROUP BY DATE(cr.measured_at)
ORDER BY collection_day;

-- 7. Task workload by volunteer (direct and team assignment).
WITH user_task_assignments AS (
  SELECT ta.user_id, ta.task_id
  FROM task_assignments ta
  WHERE ta.user_id IS NOT NULL AND ta.unassigned_at IS NULL
  UNION
  SELECT tm.user_id, ta.task_id
  FROM task_assignments ta
  JOIN team_memberships tm
    ON tm.team_id = ta.team_id AND tm.ends_at IS NULL AND tm.starts_at <= now()
  WHERE ta.team_id IS NOT NULL AND ta.unassigned_at IS NULL
)
SELECT u.user_id, u.full_name,
       COUNT(DISTINCT uta.task_id) FILTER (
         WHERE t.status NOT IN ('verified', 'cancelled')
       ) AS active_tasks,
       COUNT(DISTINCT uta.task_id) FILTER (WHERE t.status = 'verified') AS verified_tasks
FROM users u
LEFT JOIN user_task_assignments uta ON uta.user_id = u.user_id
LEFT JOIN collection_tasks t ON t.task_id = uta.task_id
WHERE u.status = 'active'
GROUP BY u.user_id, u.full_name
ORDER BY active_tasks DESC, verified_tasks DESC;

-- 8. Overdue tasks (derived condition; no redundant overdue status stored).
SELECT t.task_id, t.title, t.priority, t.due_at,
       now() - t.due_at AS overdue_duration,
       a.name AS area, z.name AS zone
FROM collection_tasks t
JOIN areas a ON a.area_id = t.area_id
JOIN zones z ON z.zone_id = a.zone_id
WHERE t.due_at < now()
  AND t.status NOT IN ('verified', 'cancelled')
ORDER BY t.due_at;

-- 9. Material balance by source collection record.
SELECT mb.batch_id, cr.collection_record_id, wc.name AS category,
       mb.available_weight_kg, vmb.committed_weight_kg,
       vmb.remaining_weight_kg
FROM material_batches mb
JOIN collection_records cr ON cr.collection_record_id = mb.collection_record_id
JOIN waste_categories wc ON wc.category_id = cr.category_id
JOIN v_material_balance vmb ON vmb.batch_id = mb.batch_id
ORDER BY mb.created_at DESC;

-- 10. Recycled / disposed / composted / reused weight.
SELECT md.destination_type,
       SUM(ma.weight_kg) AS allocated_weight_kg,
       COUNT(ma.allocation_id) AS allocation_count
FROM material_allocations ma
JOIN material_destinations md ON md.destination_id = ma.destination_id
GROUP BY md.destination_type
ORDER BY allocated_weight_kg DESC;

-- 11. Report resolution duration (resolved reports only).
SELECT AVG(rh.changed_at - r.submitted_at) AS average_resolution_time,
       MIN(rh.changed_at - r.submitted_at) AS fastest_resolution,
       MAX(rh.changed_at - r.submitted_at) AS slowest_resolution
FROM waste_reports r
JOIN LATERAL (
  SELECT changed_at
  FROM report_status_history h
  WHERE h.report_id = r.report_id AND h.to_status = 'resolved'
  ORDER BY changed_at DESC
  LIMIT 1
) rh ON TRUE;

-- 12. Duplicate reports and their canonical report.
SELECT duplicate.report_id AS duplicate_report_id,
       duplicate.canonical_report_id,
       original.status AS canonical_status,
       duplicate.submitted_at AS duplicate_submitted_at
FROM waste_reports duplicate
JOIN waste_reports original
  ON original.report_id = duplicate.canonical_report_id
WHERE duplicate.status = 'duplicate'
ORDER BY duplicate.submitted_at DESC;

-- 13. Recent audited changes by entity type.
SELECT entity_type, action, COUNT(*) AS change_count,
       MAX(created_at) AS last_change_at
FROM audit_logs
WHERE created_at >= now() - interval '7 days'
GROUP BY entity_type, action
ORDER BY change_count DESC;

-- 14. Users and their assigned roles (many-to-many JOIN).
SELECT u.full_name, u.normalized_email,
       COALESCE(STRING_AGG(r.display_name, ', ' ORDER BY r.display_name), 'No role') AS roles
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.user_id
LEFT JOIN roles r ON r.role_id = ur.role_id
GROUP BY u.user_id, u.full_name, u.normalized_email
ORDER BY u.full_name;
