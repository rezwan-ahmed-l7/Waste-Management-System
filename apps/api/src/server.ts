import { createApp } from "./app.js";
import { env } from "./config.js";
import { pool } from "./db.js";

const app = createApp(pool);
const server = app.listen(env.API_PORT, env.API_HOST, () => {
  console.info(`API listening on http://${env.API_HOST}:${env.API_PORT}`);
});

const shutdown = (signal: string) => {
  console.info(`Received ${signal}; shutting down gracefully.`);
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
