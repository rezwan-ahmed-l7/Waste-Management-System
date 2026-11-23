import express from "express";
import { createApp } from "./application.js";
import { pool } from "./db.js";

// Vercel invokes the exported Express application per request.
const app: express.Express = createApp(pool);

export default app;
