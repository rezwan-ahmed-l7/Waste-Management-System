import { createApp } from "./app.js";
import { pool } from "./db.js";

// Vercel invokes the exported Express application per request.
const app = createApp(pool);

export default app;
