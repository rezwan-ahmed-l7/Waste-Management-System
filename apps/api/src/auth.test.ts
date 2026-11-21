import express from "express";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { authenticate, requirePermission } from "./auth.js";

function makeDatabase(options: { sessionValid?: boolean; permissionGranted?: boolean } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM waste_mgmt.sessions s")) {
      return {
        rows: options.sessionValid ? [{
          user_id: "d5c70e5b-77e1-4f0e-9f48-2a0d90b2c901",
          full_name: "Test Volunteer",
          normalized_email: "volunteer@example.invalid",
          roles: ["volunteer"]
        }] : [],
        rowCount: options.sessionValid ? 1 : 0
      };
    }
    if (sql.includes("FROM waste_mgmt.user_roles ur")) {
      return { rows: options.permissionGranted ? [{ "?column?": 1 }] : [], rowCount: options.permissionGranted ? 1 : 0 };
    }
    throw new Error("Unexpected SQL in auth test: " + sql);
  });
  return { query };
}

function protectedApp(database: ReturnType<typeof makeDatabase>) {
  const app = express();
  app.get("/protected", authenticate(database as never), requirePermission(database as never, "tasks.read"), (req, res) => {
    res.status(200).json({ userId: req.auth?.userId, roles: req.auth?.roles });
  });
  return app;
}

describe("session authentication and permission middleware", () => {
  it("rejects requests without a session cookie before querying the database", async () => {
    const database = makeDatabase({ sessionValid: true, permissionGranted: true });
    const response = await request(protectedApp(database)).get("/protected");
    expect(response.status).toBe(401);
    expect(database.query).not.toHaveBeenCalled();
  });

  it("rejects an expired, revoked, or unknown session", async () => {
    const database = makeDatabase({ sessionValid: false, permissionGranted: true });
    const response = await request(protectedApp(database)).get("/protected").set("Cookie", "wm_session=" + "x".repeat(43));
    expect(response.status).toBe(401);
    expect(database.query).toHaveBeenCalledTimes(1);
  });

  it("denies an authenticated user who lacks the requested permission", async () => {
    const database = makeDatabase({ sessionValid: true, permissionGranted: false });
    const response = await request(protectedApp(database)).get("/protected").set("Cookie", "wm_session=" + "x".repeat(43));
    expect(response.status).toBe(403);
    expect(database.query).toHaveBeenCalledTimes(2);
  });

  it("allows a valid session with the requested permission and exposes server-resolved identity", async () => {
    const database = makeDatabase({ sessionValid: true, permissionGranted: true });
    const response = await request(protectedApp(database)).get("/protected").set("Cookie", "wm_session=" + "x".repeat(43));
    expect(response.status).toBe(200);
    expect(response.body.userId).toBe("d5c70e5b-77e1-4f0e-9f48-2a0d90b2c901");
    expect(response.body.roles).toEqual(["volunteer"]);
  });
});
