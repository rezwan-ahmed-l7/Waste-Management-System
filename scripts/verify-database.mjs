import pg from "pg";
const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required. Set it to a disposable PostgreSQL database.");
  process.exit(2);
}
const client = new Client({ connectionString });
try {
  await client.connect();
  const tables = await client.query(`
    SELECT count(*)::int AS count FROM information_schema.tables
    WHERE table_schema='waste_mgmt' AND table_type='BASE TABLE'
  `);
  const views = await client.query(`
    SELECT count(*)::int AS count FROM information_schema.views
    WHERE table_schema='waste_mgmt'
  `);
  const triggers = await client.query(`
    SELECT count(*)::int AS count FROM information_schema.triggers
    WHERE trigger_schema='waste_mgmt'
  `);
  if (tables.rows[0].count < 25 || views.rows[0].count < 3 || triggers.rows[0].count < 6) {
    throw new Error(`Schema incomplete: tables=${tables.rows[0].count}, views=${views.rows[0].count}, triggers=${triggers.rows[0].count}`);
  }
  console.log({ tables: tables.rows[0].count, views: views.rows[0].count, triggers: triggers.rows[0].count });
} finally {
  await client.end();
}
