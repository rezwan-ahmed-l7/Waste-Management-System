-- BAUST CSE Fest Waste Management System
-- PostgreSQL 15+ | Single fest | English snake_case
-- Apply: psql -v ON_ERROR_STOP=1 -U postgres -d waste_management -f database/001_schema.sql

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS waste_mgmt;
SET search_path TO waste_mgmt, public;

CREATE TYPE account_status AS ENUM ('active','suspended','disabled');
CREATE TYPE fest_status AS ENUM ('planned','active','completed','cancelled');
CREATE TYPE report_status AS ENUM ('submitted','under_review','accepted','in_progress','resolved','rejected','duplicate','cancelled');
CREATE TYPE task_status AS ENUM ('draft','open','assigned','in_progress','submitted_for_verification','verified','cancelled');
CREATE TYPE task_priority AS ENUM ('low','normal','high','urgent');
CREATE TYPE submission_status AS ENUM ('submitted','verified','rejected');
CREATE TYPE announcement_audience AS ENUM ('all_users','role','zone');

-- Identity and access control
CREATE TABLE users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(120) NOT NULL CHECK (btrim(full_name) <> ''),
  email VARCHAR(254) NOT NULL,
  normalized_email VARCHAR(254) GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  password_hash TEXT NOT NULL CHECK (btrim(password_hash) <> ''),
  phone_number VARCHAR(30),
  status account_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_users_normalized_email UNIQUE (normalized_email)
);
CREATE TABLE roles (
  role_id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_key VARCHAR(40) NOT NULL UNIQUE,
  display_name VARCHAR(80) NOT NULL UNIQUE,
  description TEXT
);
CREATE TABLE permissions (
  permission_id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  permission_key VARCHAR(80) NOT NULL UNIQUE,
  description TEXT
);
CREATE TABLE role_permissions (
  role_id SMALLINT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  permission_id SMALLINT NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  role_id SMALLINT NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
  assigned_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);
CREATE TABLE sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX idx_sessions_user_expiry ON sessions(user_id, expires_at);

-- Single-fest configuration and locations
CREATE TABLE fest (
  fest_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (fest_id = 1),
  name VARCHAR(160) NOT NULL CHECK (btrim(name) <> ''),
  description TEXT,
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Dhaka',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  status fest_status NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);
CREATE TABLE zones (
  zone_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fest_id SMALLINT NOT NULL DEFAULT 1 REFERENCES fest(fest_id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (fest_id, code),
  UNIQUE (fest_id, zone_id),
  CHECK (btrim(code) <> '' AND btrim(name) <> '')
);
CREATE TABLE areas (
  area_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fest_id SMALLINT NOT NULL DEFAULT 1 REFERENCES fest(fest_id) ON DELETE RESTRICT,
  zone_id UUID NOT NULL,
  parent_area_id UUID,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  FOREIGN KEY (fest_id, zone_id) REFERENCES zones(fest_id, zone_id) ON DELETE RESTRICT,
  FOREIGN KEY (fest_id, parent_area_id) REFERENCES areas(fest_id, area_id) ON DELETE RESTRICT,
  UNIQUE (zone_id, code),
  UNIQUE (fest_id, area_id),
  CHECK (btrim(code) <> '' AND btrim(name) <> ''),
  CHECK (parent_area_id IS NULL OR parent_area_id <> area_id)
);
CREATE INDEX idx_areas_zone ON areas(zone_id);
CREATE TABLE waste_categories (
  category_id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL UNIQUE,
  description TEXT,
  is_recyclable BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE bins (
  bin_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fest_id SMALLINT NOT NULL DEFAULT 1 REFERENCES fest(fest_id) ON DELETE RESTRICT,
  area_id UUID NOT NULL,
  code VARCHAR(40) NOT NULL,
  category_id SMALLINT REFERENCES waste_categories(category_id) ON DELETE RESTRICT,
  capacity_kg NUMERIC(10,2) CHECK (capacity_kg IS NULL OR capacity_kg > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  installed_at TIMESTAMPTZ,
  FOREIGN KEY (fest_id, area_id) REFERENCES areas(fest_id, area_id) ON DELETE RESTRICT,
  UNIQUE (fest_id, code),
  UNIQUE (fest_id, bin_id)
);
CREATE INDEX idx_bins_area ON bins(area_id);

-- Anonymous and authenticated reports
CREATE TABLE waste_reports (
  report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fest_id SMALLINT NOT NULL DEFAULT 1 REFERENCES fest(fest_id) ON DELETE RESTRICT,
  area_id UUID NOT NULL,
  bin_id UUID,
  category_id SMALLINT NOT NULL REFERENCES waste_categories(category_id) ON DELETE RESTRICT,
  reporter_user_id UUID REFERENCES users(user_id) ON DELETE RESTRICT,
  is_anonymous BOOLEAN NOT NULL DEFAULT TRUE,
  reporter_name VARCHAR(120),
  reporter_contact VARCHAR(254),
  description TEXT NOT NULL CHECK (btrim(description) <> ''),
  estimated_weight_kg NUMERIC(10,2) CHECK (estimated_weight_kg IS NULL OR estimated_weight_kg >= 0),
  priority task_priority NOT NULL DEFAULT 'normal',
  status report_status NOT NULL DEFAULT 'submitted',
  canonical_report_id UUID REFERENCES waste_reports(report_id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES users(user_id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (fest_id, area_id) REFERENCES areas(fest_id, area_id) ON DELETE RESTRICT,
  FOREIGN KEY (fest_id, bin_id) REFERENCES bins(fest_id, bin_id) ON DELETE RESTRICT,
  CHECK ((is_anonymous AND reporter_user_id IS NULL) OR (NOT is_anonymous AND reporter_user_id IS NOT NULL)),
  CHECK (canonical_report_id IS NULL OR canonical_report_id <> report_id),
  CHECK ((reviewed_by IS NULL AND reviewed_at IS NULL) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK (status <> 'duplicate' OR canonical_report_id IS NOT NULL)
);
CREATE INDEX idx_reports_status_date ON waste_reports(status, submitted_at DESC);
CREATE INDEX idx_reports_area_date ON waste_reports(area_id, submitted_at DESC);
CREATE INDEX idx_reports_category_date ON waste_reports(category_id, submitted_at DESC);
CREATE INDEX idx_reports_canonical ON waste_reports(canonical_report_id) WHERE canonical_report_id IS NOT NULL;
CREATE TABLE report_tracking_tokens (
  tracking_token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES waste_reports(report_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE report_attachments (
  attachment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES waste_reports(report_id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  original_file_name VARCHAR(255) NOT NULL,
  media_type VARCHAR(120) NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE report_status_history (
  history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES waste_reports(report_id) ON DELETE RESTRICT,
  from_status report_status,
  to_status report_status NOT NULL,
  changed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  reason TEXT,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_report_history_report_date ON report_status_history(report_id, changed_at DESC);
CREATE TABLE report_notes (
  note_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES waste_reports(report_id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (btrim(body) <> ''),
  visibility VARCHAR(10) NOT NULL CHECK (visibility IN ('public','internal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Workforce, cleaning rounds and tasks
CREATE TABLE teams (
  team_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  code VARCHAR(40) NOT NULL UNIQUE,
  team_lead_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (btrim(name) <> '' AND btrim(code) <> '')
);
CREATE TABLE team_memberships (
  membership_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(team_id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  member_role VARCHAR(30) NOT NULL DEFAULT 'volunteer',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX uq_active_team_membership ON team_memberships(team_id,user_id) WHERE ends_at IS NULL;
CREATE INDEX idx_memberships_user ON team_memberships(user_id, ends_at);
CREATE TABLE cleaning_rounds (
  round_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fest_id SMALLINT NOT NULL DEFAULT 1 REFERENCES fest(fest_id) ON DELETE RESTRICT,
  area_id UUID NOT NULL,
  title VARCHAR(160) NOT NULL CHECK (btrim(title) <> ''),
  instructions TEXT,
  planned_start_at TIMESTAMPTZ NOT NULL,
  planned_end_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('draft','scheduled','active','completed','cancelled')),
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (fest_id, area_id) REFERENCES areas(fest_id, area_id) ON DELETE RESTRICT,
  CHECK (planned_end_at > planned_start_at)
);
CREATE TABLE collection_tasks (
  task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fest_id SMALLINT NOT NULL DEFAULT 1 REFERENCES fest(fest_id) ON DELETE RESTRICT,
  round_id UUID REFERENCES cleaning_rounds(round_id) ON DELETE RESTRICT,
  area_id UUID NOT NULL,
  title VARCHAR(160) NOT NULL CHECK (btrim(title) <> ''),
  instructions TEXT,
  priority task_priority NOT NULL DEFAULT 'normal',
  status task_status NOT NULL DEFAULT 'open',
  due_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  verified_by UUID REFERENCES users(user_id) ON DELETE RESTRICT,
  verified_at TIMESTAMPTZ,
  closure_reason TEXT,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (fest_id, area_id) REFERENCES areas(fest_id, area_id) ON DELETE RESTRICT,
  CHECK ((status='verified' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND completed_at IS NOT NULL) OR (status<>'verified' AND verified_by IS NULL AND verified_at IS NULL)),
  CHECK ((status='cancelled' AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL) OR (status<>'cancelled' AND cancelled_at IS NULL))
);
CREATE INDEX idx_tasks_status_due ON collection_tasks(status, due_at);
CREATE INDEX idx_tasks_area_status ON collection_tasks(area_id, status);
CREATE TABLE report_task_links (
  report_id UUID NOT NULL REFERENCES waste_reports(report_id) ON DELETE RESTRICT,
  task_id UUID NOT NULL REFERENCES collection_tasks(task_id) ON DELETE RESTRICT,
  link_type VARCHAR(12) NOT NULL CHECK (link_type IN ('primary','related')),
  linked_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  PRIMARY KEY (report_id, task_id),
  CHECK (ended_at IS NULL OR ended_at >= linked_at)
);
CREATE UNIQUE INDEX uq_active_primary_task_per_report ON report_task_links(report_id)
  WHERE link_type='primary' AND ended_at IS NULL;
CREATE TABLE task_assignments (
  assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES collection_tasks(task_id) ON DELETE RESTRICT,
  user_id UUID REFERENCES users(user_id) ON DELETE RESTRICT,
  team_id UUID REFERENCES teams(team_id) ON DELETE RESTRICT,
  assigned_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unassigned_at TIMESTAMPTZ,
  note TEXT,
  CHECK ((user_id IS NOT NULL AND team_id IS NULL) OR (user_id IS NULL AND team_id IS NOT NULL)),
  CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at)
);
CREATE UNIQUE INDEX uq_active_task_user ON task_assignments(task_id,user_id) WHERE user_id IS NOT NULL AND unassigned_at IS NULL;
CREATE UNIQUE INDEX uq_active_task_team ON task_assignments(task_id,team_id) WHERE team_id IS NOT NULL AND unassigned_at IS NULL;
CREATE INDEX idx_task_assignments_user ON task_assignments(user_id) WHERE unassigned_at IS NULL;
CREATE INDEX idx_task_assignments_team ON task_assignments(team_id) WHERE unassigned_at IS NULL;
CREATE TABLE task_status_history (
  history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES collection_tasks(task_id) ON DELETE RESTRICT,
  from_status task_status,
  to_status task_status NOT NULL,
  changed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Collection submissions and canonical weights
CREATE TABLE collection_submissions (
  submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES collection_tasks(task_id) ON DELETE RESTRICT,
  submitted_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  status submission_status NOT NULL DEFAULT 'submitted',
  notes TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by UUID REFERENCES users(user_id) ON DELETE RESTRICT,
  verified_at TIMESTAMPTZ,
  verification_note TEXT,
  CHECK ((status='submitted' AND verified_by IS NULL AND verified_at IS NULL) OR (status IN ('verified','rejected') AND verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX idx_submissions_task_date ON collection_submissions(task_id, submitted_at DESC);
CREATE TABLE collection_records (
  collection_record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES collection_submissions(submission_id) ON DELETE RESTRICT,
  category_id SMALLINT NOT NULL REFERENCES waste_categories(category_id) ON DELETE RESTRICT,
  entered_weight NUMERIC(12,3) NOT NULL CHECK (entered_weight > 0),
  entered_unit VARCHAR(8) NOT NULL CHECK (entered_unit IN ('kg','g')),
  weight_kg NUMERIC(12,3) NOT NULL CHECK (weight_kg > 0),
  measurement_method VARCHAR(30) NOT NULL CHECK (measurement_method IN ('weighing_scale','estimated','count_converted')),
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  CHECK ((entered_unit='kg' AND weight_kg=entered_weight) OR (entered_unit='g' AND weight_kg=entered_weight/1000))
);
CREATE INDEX idx_collection_records_category_date ON collection_records(category_id, measured_at DESC);
CREATE TABLE collection_photos (
  photo_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES collection_submissions(submission_id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  media_type VARCHAR(120) NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  checksum_sha256 CHAR(64),
  uploaded_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Material processing and allocations
CREATE TABLE material_batches (
  batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_record_id UUID NOT NULL UNIQUE REFERENCES collection_records(collection_record_id) ON DELETE RESTRICT,
  available_weight_kg NUMERIC(12,3) NOT NULL CHECK (available_weight_kg > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE segregation_records (
  segregation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_batch_id UUID NOT NULL REFERENCES material_batches(batch_id) ON DELETE RESTRICT,
  output_category_id SMALLINT NOT NULL REFERENCES waste_categories(category_id) ON DELETE RESTRICT,
  weight_kg NUMERIC(12,3) NOT NULL CHECK (weight_kg > 0),
  recorded_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);
CREATE TABLE material_destinations (
  destination_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_type VARCHAR(12) NOT NULL CHECK (destination_type IN ('recycling','disposal','composting','reuse')),
  name VARCHAR(160) NOT NULL CHECK (btrim(name) <> ''),
  contact_info TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE material_allocations (
  allocation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_batch_id UUID REFERENCES material_batches(batch_id) ON DELETE RESTRICT,
  source_segregation_id UUID REFERENCES segregation_records(segregation_id) ON DELETE RESTRICT,
  destination_id UUID NOT NULL REFERENCES material_destinations(destination_id) ON DELETE RESTRICT,
  weight_kg NUMERIC(12,3) NOT NULL CHECK (weight_kg > 0),
  allocated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_storage_key TEXT,
  notes TEXT,
  CHECK ((source_batch_id IS NOT NULL AND source_segregation_id IS NULL) OR (source_batch_id IS NULL AND source_segregation_id IS NOT NULL))
);
CREATE INDEX idx_allocations_batch ON material_allocations(source_batch_id) WHERE source_batch_id IS NOT NULL;
CREATE INDEX idx_allocations_segregation ON material_allocations(source_segregation_id) WHERE source_segregation_id IS NOT NULL;

-- Communications and audit
CREATE TABLE notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL,
  title VARCHAR(160) NOT NULL CHECK (btrim(title) <> ''),
  body TEXT NOT NULL CHECK (btrim(body) <> ''),
  resource_type VARCHAR(40),
  resource_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE TABLE announcements (
  announcement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(160) NOT NULL CHECK (btrim(title) <> ''),
  body TEXT NOT NULL CHECK (btrim(body) <> ''),
  audience announcement_audience NOT NULL DEFAULT 'all_users',
  target_role_id SMALLINT REFERENCES roles(role_id) ON DELETE RESTRICT,
  target_zone_id UUID REFERENCES zones(zone_id) ON DELETE RESTRICT,
  published_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((audience='all_users' AND target_role_id IS NULL AND target_zone_id IS NULL)
      OR (audience='role' AND target_role_id IS NOT NULL AND target_zone_id IS NULL)
      OR (audience='zone' AND target_role_id IS NULL AND target_zone_id IS NOT NULL)),
  CHECK (expires_at IS NULL OR published_at IS NULL OR expires_at > published_at)
);
CREATE TABLE audit_logs (
  audit_log_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  action VARCHAR(10) NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  entity_type VARCHAR(80) NOT NULL,
  entity_id TEXT NOT NULL,
  request_id VARCHAR(100),
  safe_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_user_id, created_at DESC);
CREATE TABLE idempotency_keys (
  idempotency_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash CHAR(64) NOT NULL,
  actor_user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
  operation VARCHAR(120) NOT NULL,
  response_reference UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key_hash, actor_user_id, operation)
);

-- Generic updated timestamp
CREATE FUNCTION set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_fest_updated BEFORE UPDATE ON fest FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_reports_updated BEFORE UPDATE ON waste_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON collection_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Create material batches only when a collection submission becomes verified.
CREATE FUNCTION create_material_batches_after_verification() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='verified' AND OLD.status <> 'verified' THEN
    INSERT INTO material_batches(collection_record_id, available_weight_kg)
    SELECT collection_record_id, weight_kg
    FROM collection_records WHERE submission_id=NEW.submission_id
    ON CONFLICT (collection_record_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_submission_verified_batches
AFTER UPDATE OF status ON collection_submissions
FOR EACH ROW EXECUTE FUNCTION create_material_batches_after_verification();

-- Prevent concurrent segregation output from exceeding the source batch.
CREATE FUNCTION enforce_segregation_balance() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_available NUMERIC(12,3); v_used NUMERIC(12,3);
BEGIN
  SELECT available_weight_kg INTO v_available FROM material_batches
    WHERE batch_id=NEW.source_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material batch does not exist'; END IF;
  SELECT COALESCE(SUM(weight_kg),0) INTO v_used FROM segregation_records
    WHERE source_batch_id=NEW.source_batch_id AND segregation_id <> NEW.segregation_id;
  IF v_used + NEW.weight_kg > v_available THEN
    RAISE EXCEPTION 'Segregation output exceeds source batch quantity';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_segregation_balance
BEFORE INSERT OR UPDATE ON segregation_records
FOR EACH ROW EXECUTE FUNCTION enforce_segregation_balance();

-- Prevent concurrent allocations from exceeding source batch/segregation quantity.
CREATE FUNCTION enforce_material_allocation_balance() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_available NUMERIC(12,3); v_used NUMERIC(12,3);
BEGIN
  IF NEW.source_batch_id IS NOT NULL THEN
    SELECT available_weight_kg INTO v_available FROM material_batches
      WHERE batch_id=NEW.source_batch_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source material batch does not exist'; END IF;
    SELECT COALESCE(SUM(weight_kg),0) INTO v_used FROM material_allocations
      WHERE source_batch_id=NEW.source_batch_id AND allocation_id <> NEW.allocation_id;
  ELSE
    SELECT weight_kg INTO v_available FROM segregation_records
      WHERE segregation_id=NEW.source_segregation_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source segregation record does not exist'; END IF;
    SELECT COALESCE(SUM(weight_kg),0) INTO v_used FROM material_allocations
      WHERE source_segregation_id=NEW.source_segregation_id AND allocation_id <> NEW.allocation_id;
  END IF;
  IF v_used + NEW.weight_kg > v_available THEN
    RAISE EXCEPTION 'Material allocation exceeds available source quantity';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_material_allocation_balance
BEFORE INSERT OR UPDATE ON material_allocations
FOR EACH ROW EXECUTE FUNCTION enforce_material_allocation_balance();


-- A task cannot be verified without a verified collection submission unless
-- an authorized manager explicitly records a no-waste/false-alarm reason.
CREATE FUNCTION validate_task_verification() RETURNS TRIGGER LANGUAGE plpgsql AS $
BEGIN
  IF NEW.status='verified' AND OLD.status IS DISTINCT FROM 'verified' THEN
    IF NOT EXISTS (
      SELECT 1 FROM collection_submissions cs
      WHERE cs.task_id=NEW.task_id AND cs.status='verified'
    ) AND NULLIF(btrim(NEW.closure_reason),'') IS NULL THEN
      RAISE EXCEPTION 'Task verification requires verified evidence or an explicit no-waste closure reason';
    END IF;
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  END IF;
  RETURN NEW;
END; $;
CREATE TRIGGER trg_task_verification_guard
BEFORE UPDATE OF status ON collection_tasks
FOR EACH ROW EXECUTE FUNCTION validate_task_verification();

-- Auditing captures row snapshots for selected operational entities.
-- The API sets app.actor_user_id and app.request_id with SET LOCAL per transaction.
CREATE FUNCTION audit_row_change() RETURNS TRIGGER LANGUAGE plpgsql AS $
DECLARE
  v_actor UUID;
  v_request_id TEXT;
  v_old JSONB;
  v_new JSONB;
  v_entity_id TEXT;
BEGIN
  v_actor := NULLIF(current_setting('app.actor_user_id', TRUE),'')::UUID;
  v_request_id := NULLIF(current_setting('app.request_id', TRUE),'');
  IF TG_OP='INSERT' THEN
    v_new := to_jsonb(NEW);
    v_entity_id := v_new ->> TG_ARGV[0];
  ELSIF TG_OP='UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_entity_id := v_new ->> TG_ARGV[0];
  ELSE
    v_old := to_jsonb(OLD);
    v_entity_id := v_old ->> TG_ARGV[0];
  END IF;
  INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,request_id,safe_metadata)
  VALUES (
    v_actor, TG_OP, TG_TABLE_NAME, COALESCE(v_entity_id,'unknown'), v_request_id,
    jsonb_build_object('old',v_old,'new',v_new)
  );
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $;
CREATE TRIGGER trg_audit_reports AFTER INSERT OR UPDATE OR DELETE ON waste_reports
FOR EACH ROW EXECUTE FUNCTION audit_row_change('report_id');
CREATE TRIGGER trg_audit_tasks AFTER INSERT OR UPDATE OR DELETE ON collection_tasks
FOR EACH ROW EXECUTE FUNCTION audit_row_change('task_id');
CREATE TRIGGER trg_audit_submissions AFTER INSERT OR UPDATE OR DELETE ON collection_submissions
FOR EACH ROW EXECUTE FUNCTION audit_row_change('submission_id');
CREATE TRIGGER trg_audit_allocations AFTER INSERT OR UPDATE OR DELETE ON material_allocations
FOR EACH ROW EXECUTE FUNCTION audit_row_change('allocation_id');

-- Views are read models, not authorization boundaries.
CREATE VIEW v_report_overview AS
SELECT r.report_id, r.submitted_at, r.status, r.priority, r.is_anonymous,
       z.name AS zone_name, a.name AS area_name, wc.name AS category_name,
       r.estimated_weight_kg, r.description, r.canonical_report_id
FROM waste_reports r
JOIN areas a ON a.area_id=r.area_id
JOIN zones z ON z.zone_id=a.zone_id
JOIN waste_categories wc ON wc.category_id=r.category_id;

CREATE VIEW v_verified_collection_totals AS
SELECT wc.category_id, wc.name AS category_name,
       COALESCE(SUM(cr.weight_kg) FILTER (WHERE cs.status='verified'),0) AS verified_weight_kg,
       COUNT(cr.collection_record_id) FILTER (WHERE cs.status='verified') AS verified_record_count
FROM waste_categories wc
LEFT JOIN collection_records cr ON cr.category_id=wc.category_id
LEFT JOIN collection_submissions cs ON cs.submission_id=cr.submission_id
GROUP BY wc.category_id, wc.name;

CREATE VIEW v_material_balance AS
SELECT mb.batch_id, mb.available_weight_kg,
       COALESCE(SUM(ma.weight_kg),0) AS allocated_weight_kg,
       mb.available_weight_kg-COALESCE(SUM(ma.weight_kg),0) AS remaining_weight_kg
FROM material_batches mb
LEFT JOIN material_allocations ma ON ma.source_batch_id=mb.batch_id
GROUP BY mb.batch_id, mb.available_weight_kg;

-- Reference data only. No seeded credentials or default administrator.
INSERT INTO roles(role_key,display_name,description) VALUES
 ('administrator','Administrator','Full system administration'),
 ('fest_organizer','Fest Organizer','Event oversight and analytics'),
 ('waste_manager','Waste Manager','Operational reporting, assignment and verification'),
 ('team_lead','Team Lead','Team coordination and assigned work'),
 ('volunteer','Volunteer / Collector','Assigned collection work');
INSERT INTO permissions(permission_key,description) VALUES
 ('users.manage','Manage users and roles'),
 ('fest.manage','Manage fest configuration'),
 ('locations.manage','Manage zones, areas and bins'),
 ('reports.read','Read reports'),
 ('reports.review','Review and update reports'),
 ('tasks.manage','Create and assign collection tasks'),
 ('tasks.execute','Execute assigned tasks'),
 ('collections.submit','Submit collection evidence'),
 ('collections.verify','Verify collection submissions'),
 ('materials.manage','Manage segregation and material allocations'),
 ('analytics.read','Read dashboards and exports'),
 ('announcements.manage','Publish announcements'),
 ('audit.read','Read audit history');

-- Least-privilege role-to-permission mapping.
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key='administrator';
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r JOIN permissions p ON p.permission_key IN ('analytics.read','reports.read')
WHERE r.role_key='fest_organizer';
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r JOIN permissions p ON p.permission_key IN
 ('locations.manage','reports.read','reports.review','tasks.manage','collections.verify','materials.manage','analytics.read','announcements.manage')
WHERE r.role_key='waste_manager';
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r JOIN permissions p ON p.permission_key IN ('reports.read','tasks.execute','collections.submit')
WHERE r.role_key='team_lead';
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r JOIN permissions p ON p.permission_key IN ('tasks.execute','collections.submit')
WHERE r.role_key='volunteer';

INSERT INTO fest(fest_id,name,description,status)
VALUES (1,'BAUST CSE Fest','Waste management operations for BAUST CSE Fest','planned');
INSERT INTO waste_categories(code,name,description,is_recyclable) VALUES
 ('plastic','Plastic','Plastic bottles, packaging and containers',TRUE),
 ('paper','Paper','Paper and cardboard',TRUE),
 ('food','Food Waste','Leftover food and biodegradable waste',FALSE),
 ('metal','Metal','Metal cans and recyclable metal',TRUE),
 ('glass','Glass','Glass bottles and containers',TRUE),
 ('general','General Waste','Other non-specialized waste',FALSE),
 ('electronic','Electronic Waste','Discarded electronic items',FALSE);
COMMIT;
