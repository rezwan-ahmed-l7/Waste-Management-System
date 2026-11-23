import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./application.js";

function fakeDatabase() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT 1")) return { rows: [{ "?column?": 1 },], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT area_id")) return { rows: [{ area_id: "5f4b1c0e-0d34-4b22-9e2c-2b28e7f8b6d1" }], rowCount: 1 };
      if (sql.includes("SELECT category_id")) return { rows: [{ category_id: 1 }], rowCount: 1 };
      if (sql.includes("INSERT INTO waste_mgmt.waste_reports")) return { rows: [{ report_id: "e6f9b8b0-7f1b-4d5f-ae83-5e4d20c0a1a2", submitted_at: new Date("2026-11-21T00:00:00Z") }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn()
  };
  const connect = vi.fn(async () => client);
  return { db: { query, connect }, query, connect, client };
}

describe("public reporting API", () => {
  it("serves liveness without a database query", async () => {
    const fake = fakeDatabase();
    const response = await request(createApp(fake.db as never)).get("/api/v1/health");
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("rejects invalid report input", async () => {
    const fake = fakeDatabase();
    const response = await request(createApp(fake.db as never))
      .post("/api/v1/public/reports").send({ description: "short" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it("creates an anonymous report and returns a one-time tracking token", async () => {
    const fake = fakeDatabase();
    const response = await request(createApp(fake.db as never))
      .post("/api/v1/public/reports")
      .send({
        areaId: "5f4b1c0e-0d34-4b22-9e2c-2b28e7f8b6d1",
        categoryId: 1,
        description: "Overflowing waste around the main entrance."
      });
    expect(response.status).toBe(201);
    expect(response.body.data.reportId).toBe("e6f9b8b0-7f1b-4d5f-ae83-5e4d20c0a1a2");
    expect(response.body.data.trackingToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(fake.client.query).toHaveBeenCalledWith("COMMIT");
    expect(fake.client.query.mock.calls.some(([sql]) => String(sql).includes("set_config('app.request_id'"))).toBe(true);
    expect(fake.client.release).toHaveBeenCalled();
  });

  it("rolls back when the selected area is invalid", async () => {
    const fake = fakeDatabase();
    fake.client.query.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT area_id")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const response = await request(createApp(fake.db as never))
      .post("/api/v1/public/reports")
      .send({
        areaId: "5f4b1c0e-0d34-4b22-9e2c-2b28e7f8b6d1",
        categoryId: 1,
        description: "Overflowing waste around the main entrance."
      });
    expect(response.status).toBe(422);
    expect(fake.client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(fake.client.release).toHaveBeenCalled();
  });
});
