import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for material concurrency verification.");

const pool = new Pool({ connectionString, max: 5, options: "-c search_path=waste_mgmt,public" });
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
let ids = {};

async function query(sql, values = []) {
  return pool.query(sql, values);
}

try {
  const admin = await query(
    "INSERT INTO waste_mgmt.users(full_name,email,password_hash) VALUES ($1,$2,$3) RETURNING user_id",
    ["Concurrency Test Admin", `concurrency-admin-${suffix}@example.invalid`, "test-hash-only"]
  );
  ids.admin = admin.rows[0].user_id;

  const worker = await query(
    "INSERT INTO waste_mgmt.users(full_name,email,password_hash) VALUES ($1,$2,$3) RETURNING user_id",
    ["Concurrency Test Worker", `concurrency-worker-${suffix}@example.invalid`, "test-hash-only"]
  );
  ids.worker = worker.rows[0].user_id;

  const zone = await query(
    "INSERT INTO waste_mgmt.zones(fest_id,code,name) VALUES (1,$1,$2) RETURNING zone_id",
    [`CONC_${suffix}`, `Concurrency ${suffix}`]
  );
  ids.zone = zone.rows[0].zone_id;

  const area = await query(
    "INSERT INTO waste_mgmt.areas(fest_id,zone_id,code,name) VALUES (1,$1,$2,$3) RETURNING area_id",
    [ids.zone, `AREA_${suffix}`, `Concurrency Area ${suffix}`]
  );
  ids.area = area.rows[0].area_id;

  const task = await query(
    "INSERT INTO waste_mgmt.collection_tasks(fest_id,area_id,title,created_by) VALUES (1,$1,$2,$3) RETURNING task_id",
    [ids.area, `Concurrency Task ${suffix}`, ids.admin]
  );
  ids.task = task.rows[0].task_id;

  const submission = await query(
    "INSERT INTO waste_mgmt.collection_submissions(task_id,submitted_by,notes) VALUES ($1,$2,$3) RETURNING submission_id",
    [ids.task, ids.worker, "Concurrent allocation regression fixture"]
  );
  ids.submission = submission.rows[0].submission_id;

  const category = await query("SELECT category_id FROM waste_mgmt.waste_categories WHERE is_active=TRUE ORDER BY category_id LIMIT 1");
  if (!category.rows[0]) throw new Error("No active waste category exists for concurrency test.");
  const record = await query(
    "INSERT INTO waste_mgmt.collection_records(submission_id,category_id,entered_weight,entered_unit,weight_kg,measurement_method) VALUES ($1,$2,1,'kg',1,'weighing_scale') RETURNING collection_record_id",
    [ids.submission, category.rows[0].category_id]
  );
  ids.record = record.rows[0].collection_record_id;

  await query(
    "UPDATE waste_mgmt.collection_submissions SET status='verified',verified_by=$1,verified_at=now() WHERE submission_id=$2",
    [ids.admin, ids.submission]
  );
  const batch = await query("SELECT batch_id FROM waste_mgmt.material_batches WHERE collection_record_id=$1", [ids.record]);
  if (!batch.rows[0]) throw new Error("Verification did not create the material batch.");
  ids.batch = batch.rows[0].batch_id;

  const destination = await query(
    "INSERT INTO waste_mgmt.material_destinations(destination_type,name) VALUES ('recycling',$1) RETURNING destination_id",
    [`Concurrency Destination ${suffix}`]
  );
  ids.destination = destination.rows[0].destination_id;

  const attempt = async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO waste_mgmt.material_allocations(source_batch_id,destination_id,weight_kg,allocated_by) VALUES ($1,$2,0.700,$3)",
        [ids.batch, ids.destination, ids.admin]
      );
      await client.query("COMMIT");
      return "committed";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error?.message?.includes("exceeds available source quantity")) return "rejected";
      throw error;
    } finally {
      client.release();
    }
  };

  const outcomes = await Promise.all([attempt(), attempt()]);
  const committed = outcomes.filter(x => x === "committed").length;
  const rejected = outcomes.filter(x => x === "rejected").length;
  if (committed !== 1 || rejected !== 1) {
    throw new Error(`Expected one concurrent allocation to commit and one to be rejected; got ${outcomes.join(", ")}.`);
  }

  const balance = await query(
    "SELECT COALESCE(SUM(weight_kg),0) AS allocated FROM waste_mgmt.material_allocations WHERE source_batch_id=$1",
    [ids.batch]
  );
  if (Number(balance.rows[0].allocated) !== 0.7) {
    throw new Error(`Expected exactly 0.700 kg allocated; found ${balance.rows[0].allocated}.`);
  }
  console.log("Concurrent material allocation guard passed: one commit, one rejection, 0.700 kg allocated.");
} finally {
  if (ids.destination) await query("DELETE FROM waste_mgmt.material_allocations WHERE destination_id=$1", [ids.destination]).catch(() => undefined);
  if (ids.batch) await query("DELETE FROM waste_mgmt.material_batches WHERE batch_id=$1", [ids.batch]).catch(() => undefined);
  if (ids.destination) await query("DELETE FROM waste_mgmt.material_destinations WHERE destination_id=$1", [ids.destination]).catch(() => undefined);
  if (ids.record) await query("DELETE FROM waste_mgmt.collection_records WHERE collection_record_id=$1", [ids.record]).catch(() => undefined);
  if (ids.submission) await query("DELETE FROM waste_mgmt.collection_submissions WHERE submission_id=$1", [ids.submission]).catch(() => undefined);
  if (ids.task) await query("DELETE FROM waste_mgmt.collection_tasks WHERE task_id=$1", [ids.task]).catch(() => undefined);
  if (ids.area) await query("DELETE FROM waste_mgmt.areas WHERE area_id=$1", [ids.area]).catch(() => undefined);
  if (ids.zone) await query("DELETE FROM waste_mgmt.zones WHERE zone_id=$1", [ids.zone]).catch(() => undefined);
  if (ids.worker) await query("DELETE FROM waste_mgmt.users WHERE user_id=$1", [ids.worker]).catch(() => undefined);
  if (ids.admin) await query("DELETE FROM waste_mgmt.users WHERE user_id=$1", [ids.admin]).catch(() => undefined);
  await pool.end();
}
