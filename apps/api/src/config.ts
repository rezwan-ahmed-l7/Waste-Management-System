import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  DATABASE_URL: z.string().url().optional(),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  PRIVATE_STORAGE_DIR: z.string().min(1).default("./storage/private"),
  PUBLIC_REPORT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  PUBLIC_REPORT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(8)
});

export const env = envSchema.parse(process.env);
