import { createApp } from "../apps/api/src/app.js";
import { pool } from "../apps/api/src/db.js";

// Vercel's Express runtime invokes this app per request; do not call listen().
const app = createApp(pool);

export default app;
