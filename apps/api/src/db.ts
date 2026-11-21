import { Pool } from "pg";
import { env } from "./config.js";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on("error", (error) => {
  // Do not log connection strings or query parameters.
  console.error("Unexpected idle PostgreSQL client error", error.message);
});
