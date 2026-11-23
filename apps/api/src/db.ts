import { Pool } from "pg";
import { env } from "./config.js";

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be configured before starting the API server.");
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  options: "-c search_path=waste_mgmt,public",
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on("error", (error) => {
  // Do not log connection strings or query parameters.
  console.error("Unexpected idle PostgreSQL client error", error.message);
});
