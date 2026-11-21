import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

const userId = "d5c70e5b-77e1-4f0e-9f48-2a0d90b2c901";
const reportId = "e6f9b8b0-7f1b-4d5f-ae83-5e4d20c0a1a2";
const cookie = "wm_session=" + "x".repeat(43);

function authenticatedDatabase(options: { permitted?: boolean; reportNote?: boolean } = {}) {
  const statements: { sql: string; values?: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values });
    if (sql.includes("FROM waste_mgmt.sessions s")) {
      return { rows: [{ user_id: userId, full_name: "Test Manager", normalized_email: "manager@example.invalid", roles: ["waste_manager"] }], rowCount: 1 };
    }
    if (sql.includes("FROM waste_mgmt.user_roles ur")) {
      return { rows: options.permitted === false ? [] : [{ "?column?": 1 }], rowCount: options.permitted === false ? 0 : 1 };
    }
    if (sql.includes("FROM waste_mgmt.fest f WHERE fest_id=1")) return { rows: [{ name: "Test Fest", timezone: "Asia/Dhaka" }], rowCount: 1 };
    if (sql.includes("GROUP BY r.status")) return { rows: [{ status: "resolved", count: 4 }], rowCount: 1 };
    if (sql.includes("GROUP BY t.status")) return { rows: [{ status: "verified", count: 3 }], rowCount: 1 };
    if (sql.includes("GROUP BY wc.category_id,wc.name")) return { rows: [{ categoryName: "Plastic", verifiedWeightKg: "12.500", verifiedRecords: 2 }], rowCount: 1 };
    if (sql.includes("GROUP BY md.destination_type")) return { rows: [{ destinationType: "recycling", allocatedWeightKg: "8.000" }], rowCount: 1 };
    if (sql.includes("currentAwaitingProcessingKg")) return { rows: [{ currentAwaitingProcessingKg: "4.500" }], rowCount: 1 };
    if (sql.includes("SELECT report_id FROM waste_mgmt.waste_reports")) return { rows: [{ report_id: reportId }], rowCount: 1 };
    if (sql.includes("INSERT INTO waste_mgmt.report_notes")) return { rows: [{ noteId: "note-1", body: "Team update", visibility: "public" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const clientQuery = vi.fn(async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
    if (sql.includes("SELECT report_id FROM waste_mgmt.waste_reports")) return { rows: [{ report_id: reportId }], rowCount: 1 };
    if (sql.includes("INSERT INTO waste_mgmt.report_notes")) return { rows: [{ noteId: "note-1", body: "Team update", visibility: "public" }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const client = { query: clientQuery, release: vi.fn() };
  const connect = vi.fn(async () => client);
  return { db: { query, connect }, query, connect, client, statements };
}

describe("final fest report endpoint", () => {
  it("rejects malformed or reversed dates before running report queries", async () => {
    const fake = authenticatedDatabase();
    const app = createApp(fake.db as never);
    const malformed = await request(app).get("/api/v1/analytics/final-report?from=2026-13-50&to=2026-11-21").set("Cookie", cookie);
    expect(malformed.status).toBe(422);
    const reversed = await request(app).get("/api/v1/analytics/final-report?from=2026-11-22&to=2026-11-21").set("Cookie", cookie);
    expect(reversed.status).toBe(422);
    expect(fake.query).toHaveBeenCalledTimes(4); // session + permission for each request only
  });

  it("requires analytics permission", async () => {
    const fake = authenticatedDatabase({ permitted: false });
    const response = await request(createApp(fake.db as never))
      .get("/api/v1/analytics/final-report?from=2026-11-01&to=2026-11-21")
      .set("Cookie", cookie);
    expect(response.status).toBe(403);
    expect(fake.query).toHaveBeenCalledTimes(2);
  });

  it("returns date-scoped verified metrics, fest timezone and explicit metric definitions", async () => {
    const fake = authenticatedDatabase();
    const response = await request(createApp(fake.db as never))
      .get("/api/v1/analytics/final-report?from=2026-11-01&to=2026-11-21")
      .set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body.data.festName).toBe("Test Fest");
    expect(response.body.data.timezone).toBe("Asia/Dhaka");
    expect(response.body.data.verifiedCollections[0].verifiedWeightKg).toBe("12.500");
    expect(response.body.data.currentAwaitingProcessingKg).toBe("4.500");
    expect(response.body.data.metricDefinitions.currentAwaitingProcessingKg).toContain("not historical");
    const reportQueries = fake.statements.filter(x => x.sql.includes("AT TIME ZONE"));
    expect(reportQueries.length).toBeGreaterThanOrEqual(4);
    expect(reportQueries.every(x => x.values?.[0] === "2026-11-01" && x.values?.[1] === "2026-11-21")).toBe(true);
  });
});

describe("report note persistence", () => {
  it("writes the author to the column defined by the PostgreSQL schema", async () => {
    const fake = authenticatedDatabase();
    const response = await request(createApp(fake.db as never))
      .post("/api/v1/reports/" + reportId + "/notes")
      .set("Cookie", cookie)
      .send({ body: "Team update", visibility: "public" });
    expect(response.status).toBe(201);
    const insert = fake.statements.find(x => x.sql.includes("INSERT INTO waste_mgmt.report_notes"));
    expect(insert?.sql).toContain("report_id,author_id,body,visibility");
    expect(insert?.sql).not.toContain("author_user_id");
    expect(fake.client.release).toHaveBeenCalledOnce();
  });
});
