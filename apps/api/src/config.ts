import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default(process.env.RENDER ? "0.0.0.0" : "127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(
    process.env.PORT ? Number(process.env.PORT) : 4000
  ),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(process.env.RENDER ? 1 : 0),
  DATABASE_URL: z.string().url().optional(),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  PRIVATE_STORAGE_DIR: z.string().min(1).default("./storage/private"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("waste-evidence"),
  PUBLIC_REPORT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  PUBLIC_REPORT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(8)
});

export const env = envSchema.parse(process.env);

if (env.NODE_ENV === "production") {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL must be configured before starting the API server.");
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for durable private evidence storage.");
  }
}
