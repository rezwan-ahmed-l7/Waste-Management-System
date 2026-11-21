import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

const userId = "d5c70e5b-77e1-4f0e-9f48-2a0d90b2c901";
const taskId = "e6f9b8b0-7f1b-4d5f-ae83-5e4d20c0a1a2";
const cookie = "wm_session=" + "x".repeat(43);

function databaseForAuditedWrites() {
  const authQuery = vi.fn(async (sql: string) => {
    if (sql.includes("FROM waste_mgmt.sessions s")) {
      return { rows: [{ user_id: userId, full_name: "Test Manager", normalized_email: "manager@example.invalid", roles: ["waste_manager"] }], rowCount: 1 };
    }
    if (sql.includes("FROM waste_mgmt.user_roles ur")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const clientQuery = vi.fn(async (sql: string) => {
    if (sql.includes("INSERT INTO waste_mgmt.zones")) {
      return { rows: [{ zoneId: "f2b5ef43-26d5-4d15-a849-cd4c3f0c3a11", code: "AUDIT", name: "Audit Test Zone" }], rowCount: 1 };
    }
    if (sql.includes("SELECT t.task_id,t.status")) return { rows: [{ task_id: taskId, status: "assigned" }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const client = { query: clientQuery, release: vi.fn() };
  const connect = vi.fn(async () => client);
  return { db: { query: authQuery, connect }, clientQuery, connect, client };
}

describe("audited mutation transaction helper", () => {
  it("writes location changes with actor and request IDs in the same transaction", async () => {
    const fake = databaseForAuditedWrites();
    const response = await request(createApp(fake.db as never))
      .post("/api/v1/zones")
      .set("Cookie", cookie)
      .send({ code: "audit-zone", name: "Audit Test Zone" });
    expect(response.status).toBe(201);
    const calls = fake.clientQuery.mock.calls.map(([sql, values]) => ({ sql: String(sql), values }));
    const begin = calls.findIndex(x => x.sql === "BEGIN");
    const context = calls.findIndex(x => x.sql.includes("set_config('app.actor_user_id'") && x.sql.includes("app.request_id"));
    const insert = calls.findIndex(x => x.sql.includes("INSERT INTO waste_mgmt.zones"));
    const commit = calls.findIndex(x => x.sql === "COMMIT");
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(context).toBeGreaterThan(begin);
    expect(insert).toBeGreaterThan(context);
    expect(commit).toBeGreaterThan(insert);
    expect(calls[context].values).toEqual([userId, expect.any(String)]);
    expect(fake.client.release).toHaveBeenCalledOnce();
  });

  it("locks the assigned task before starting it and audits the state transition", async () => {
    const fake = databaseForAuditedWrites();
    const response = await request(createApp(fake.db as never))
      .post("/api/v1/tasks/" + taskId + "/start")
      .set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("in_progress");
    const calls = fake.clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(calls.some(sql => sql.includes("app.request_id"))).toBe(true);
    expect(calls.some(sql => sql.includes("FOR UPDATE"))).toBe(true);
    expect(calls.some(sql => sql.includes("UPDATE waste_mgmt.collection_tasks SET status='in_progress'"))).toBe(true);
    expect(calls.indexOf("COMMIT")).toBeGreaterThan(calls.findIndex(sql => sql.includes("UPDATE waste_mgmt.collection_tasks SET status='in_progress'")));
    expect(fake.client.release).toHaveBeenCalledOnce();
  });
});
