-- Disposable-database smoke tests. This file rolls back all test rows.
BEGIN;
SET search_path TO waste_mgmt, public;

DO $test$
DECLARE
  v_admin UUID;
  v_worker UUID;
  v_zone UUID;
  v_area UUID;
  v_task UUID;
  v_submission UUID;
  v_record UUID;
  v_batch UUID;
  v_destination UUID;
  v_category SMALLINT;
  v_rejected BOOLEAN;
BEGIN
  INSERT INTO users(full_name,email,password_hash)
  VALUES ('Schema Test Admin','schema-admin@example.invalid','test-hash-only')
  RETURNING user_id INTO v_admin;

  INSERT INTO users(full_name,email,password_hash)
  VALUES ('Schema Test Volunteer','schema-volunteer@example.invalid','test-hash-only')
  RETURNING user_id INTO v_worker;

  PERFORM set_config('app.actor_user_id',v_admin::text,true);
  PERFORM set_config('app.request_id','schema-smoke-request',true);

  INSERT INTO zones(fest_id,code,name)
  VALUES (1,'SMOKE_ZONE','Smoke Test Zone')
  RETURNING zone_id INTO v_zone;

  IF NOT EXISTS (
    SELECT 1 FROM audit_logs
    WHERE actor_user_id=v_admin AND request_id='schema-smoke-request'
      AND entity_type='zones' AND entity_id=v_zone::text
  ) THEN
    RAISE EXCEPTION 'Audit trigger did not capture actor and request context';
  END IF;

  INSERT INTO areas(fest_id,zone_id,code,name)
  VALUES (1,v_zone,'SMOKE_AREA','Smoke Test Area')
  RETURNING area_id INTO v_area;

  SELECT category_id INTO v_category FROM waste_categories WHERE code='paper';

  INSERT INTO collection_tasks(fest_id,area_id,title,created_by)
  VALUES (1,v_area,'Schema smoke test task',v_admin)
  RETURNING task_id INTO v_task;

  -- Move the task into its execution state before testing verification.
  UPDATE collection_tasks SET status='in_progress' WHERE task_id=v_task;

  -- A task cannot be verified without accepted evidence or a no-waste reason.
  v_rejected := FALSE;
  BEGIN
    UPDATE collection_tasks
    SET status='verified', verified_by=v_admin, verified_at=now()
    WHERE task_id=v_task;
  EXCEPTION WHEN raise_exception THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Task verification guard did not reject missing evidence';
  END IF;

  INSERT INTO collection_submissions(task_id,submitted_by,notes)
  VALUES (v_task,v_worker,'Schema smoke test submission')
  RETURNING submission_id INTO v_submission;

  INSERT INTO collection_records(submission_id,category_id,entered_weight,entered_unit,weight_kg,measurement_method)
  VALUES (v_submission,v_category,1.200,'kg',1.200,'weighing_scale')
  RETURNING collection_record_id INTO v_record;

  UPDATE collection_submissions
  SET status='verified', verified_by=v_admin, verified_at=now()
  WHERE submission_id=v_submission;

  SELECT batch_id INTO v_batch
  FROM material_batches WHERE collection_record_id=v_record;
  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'Verified submission did not create a material batch';
  END IF;

  UPDATE collection_tasks SET status='submitted_for_verification' WHERE task_id=v_task;
  UPDATE collection_tasks
  SET status='verified', verified_by=v_admin, verified_at=now()
  WHERE task_id=v_task;

  INSERT INTO material_destinations(destination_type,name)
  VALUES ('recycling','Smoke Test Destination')
  RETURNING destination_id INTO v_destination;

  INSERT INTO material_allocations(source_batch_id,destination_id,weight_kg)
  VALUES (v_batch,v_destination,0.400);

  INSERT INTO segregation_records(source_batch_id,output_category_id,weight_kg,recorded_by)
  VALUES (v_batch,v_category,0.600,v_admin);

  -- Direct allocations plus segregation outputs must not exceed source input.
  v_rejected := FALSE;
  BEGIN
    INSERT INTO material_allocations(source_batch_id,destination_id,weight_kg)
    VALUES (v_batch,v_destination,0.300);
  EXCEPTION WHEN raise_exception THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Material allocation guard did not reject over-allocation';
  END IF;

  -- Segregation outputs must not exceed their source batch either.
  v_rejected := FALSE;
  BEGIN
    INSERT INTO segregation_records(source_batch_id,output_category_id,weight_kg,recorded_by)
    VALUES (v_batch,v_category,0.700,v_admin);
  EXCEPTION WHEN raise_exception THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Segregation guard did not reject over-allocation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM v_material_balance
    WHERE batch_id=v_batch AND remaining_weight_kg=0.200
  ) THEN
    RAISE EXCEPTION 'Material balance view returned an unexpected remaining weight';
  END IF;
END;
$test$;

ROLLBACK;
