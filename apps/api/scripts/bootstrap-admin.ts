import "dotenv/config";
import { Client } from "pg";
import argon2 from "argon2";

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const connectionString = process.env.DATABASE_URL;

if (!email || !password || !connectionString) {
  throw new Error("Set DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD before bootstrapping.");
}
if (password.length < 14 || password.length > 128) {
  throw new Error("Bootstrap password must contain between 14 and 128 characters.");
}

const client = new Client({ connectionString });
try {
  await client.connect();
  await client.query("BEGIN");
  const existing = await client.query(
    "SELECT 1 FROM waste_mgmt.user_roles ur JOIN waste_mgmt.roles r ON r.role_id=ur.role_id WHERE r.role_key='administrator' LIMIT 1"
  );
  if (existing.rowCount) {
    throw new Error("An administrator already exists. Bootstrap is a one-time operation.");
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await client.query(
    "INSERT INTO waste_mgmt.users(full_name,email,password_hash) VALUES ($1,$2,$3) RETURNING user_id",
    ["System Administrator", email, passwordHash]
  );
  const userId = user.rows[0]?.user_id;
  if (!userId) throw new Error("Administrator account could not be created.");

  await client.query(
    "INSERT INTO waste_mgmt.user_roles(user_id,role_id) SELECT $1,role_id FROM waste_mgmt.roles WHERE role_key='administrator'",
    [userId]
  );
  await client.query("COMMIT");
  console.info("Administrator account created. Remove bootstrap credentials from the environment now.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
