import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { publicWasteReportSchema } from "@waste/contracts";
import type { Pool } from "pg";
import { env } from "./config.js";
import argon2 from "argon2";
import { authenticate, readSessionToken, requirePermission } from "./auth.js";

type Database = Pick<Pool, "query" | "connect">;

export function createApp(database: Database, verifyPassword: (hash: string, password: string) => Promise<boolean> = argon2.verify) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    const requestId = randomUUID();
    res.setHeader("x-request-id", requestId);
    res.locals.requestId = requestId;
    next();
  });
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "64kb" }));
  app.use((req, res, next) => {
    const origin = req.header("origin");
    const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
    if (isMutation && origin && origin !== env.WEB_ORIGIN) {
      res.status(403).json({ error: { code: "UNTRUSTED_ORIGIN", message: "Request origin is not allowed." } });
      return;
    }
    next();
  });


  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many sign-in attempts. Try again later." } });
    }
  });

  const publicReportLimiter = rateLimit({
    windowMs: env.PUBLIC_REPORT_RATE_LIMIT_WINDOW_MS,
    limit: env.PUBLIC_REPORT_RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many reports. Please try again later." } });
    }
  });


  app.post("/api/v1/auth/login", loginLimiter, async (req, res, next) => {
    const body = z.object({
      email: z.string().trim().email().max(254),
      password: z.string().min(1).max(128)
    }).strict().safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid email and password." } });
      return;
    }
    try {
      const result = await database.query<{
        user_id: string;
        full_name: string;
        normalized_email: string;
        password_hash: string;
        roles: string[];
      }>(
        "SELECT u.user_id, u.full_name, u.normalized_email, u.password_hash, " +
        "COALESCE(array_agg(DISTINCT r.role_key) FILTER (WHERE r.role_key IS NOT NULL), ARRAY[]::text[]) AS roles " +
        "FROM waste_mgmt.users u " +
        "LEFT JOIN waste_mgmt.user_roles ur ON ur.user_id=u.user_id " +
        "LEFT JOIN waste_mgmt.roles r ON r.role_id=ur.role_id " +
        "WHERE u.normalized_email=$1 AND u.status='active' GROUP BY u.user_id",
        [body.data.email.toLowerCase()]
      );
      const user = result.rows[0];
      if (!user || !(await verifyPassword(user.password_hash, body.data.password))) {
        res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } });
        return;
      }

      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO waste_mgmt.sessions(user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '8 hours')",
          [user.user_id, tokenHash]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      const secure = env.NODE_ENV === "production" ? "; Secure" : "";
      res.setHeader("Set-Cookie", "wm_session=" + token + "; Path=/api/v1; HttpOnly; SameSite=Lax; Max-Age=28800" + secure);
      res.status(200).json({
        data: {
          user: { userId: user.user_id, fullName: user.full_name, email: user.normalized_email, roles: user.roles },
          expiresInSeconds: 28800
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/auth/logout", async (req, res, next) => {
    const token = readSessionToken(req);
    try {
      if (token) {
        const tokenHash = createHash("sha256").update(token).digest("hex");
        await database.query(
          "UPDATE waste_mgmt.sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL",
          [tokenHash]
        );
      }
      const secure = env.NODE_ENV === "production" ? "; Secure" : "";
      res.setHeader("Set-Cookie", "wm_session=; Path=/api/v1; HttpOnly; SameSite=Lax; Max-Age=0" + secure);
      res.status(200).json({ data: { signedOut: true } });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/auth/me", authenticate(database), (req, res) => {
    if (!req.auth) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
      return;
    }
    res.status(200).json({ data: { user: req.auth } });
  });


  const reportRead = [authenticate(database), requirePermission(database, "reports.read")];

  app.get("/api/v1/reports", ...reportRead, async (req, res, next) => {
    const filters = z.object({
      status: z.enum(["submitted","under_review","accepted","in_progress","resolved","rejected","duplicate","cancelled"]).optional(),
      areaId: z.string().uuid().optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20)
    }).safeParse(req.query);
    if (!filters.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid report filters." } });
      return;
    }
    try {
      const conditions = ["r.fest_id=1"];
      const values: (string | number)[] = [];
      if (filters.data.status) {
        values.push(filters.data.status);
        conditions.push("r.status=$" + values.length);
      }
      if (filters.data.areaId) {
        values.push(filters.data.areaId);
        conditions.push("r.area_id=$" + values.length);
      }
      if (filters.data.categoryId) {
        values.push(filters.data.categoryId);
        conditions.push("r.category_id=$" + values.length);
      }
      const where = conditions.join(" AND ");
      const count = await database.query(
        "SELECT COUNT(*)::int AS total FROM waste_mgmt.waste_reports r WHERE " + where,
        values
      );
      const offset = (filters.data.page - 1) * filters.data.pageSize;
      const pageValues = [...values, filters.data.pageSize, offset];
      const result = await database.query(
        "SELECT r.report_id AS \"reportId\", r.status, r.priority, r.is_anonymous AS \"isAnonymous\", " +
        "r.submitted_at AS \"submittedAt\", r.updated_at AS \"updatedAt\", r.description, " +
        "a.name AS \"areaName\", z.name AS \"zoneName\", wc.name AS \"categoryName\" " +
        "FROM waste_mgmt.waste_reports r " +
        "JOIN waste_mgmt.areas a ON a.area_id=r.area_id " +
        "JOIN waste_mgmt.zones z ON z.zone_id=a.zone_id " +
        "JOIN waste_mgmt.waste_categories wc ON wc.category_id=r.category_id " +
        "WHERE " + where + " ORDER BY r.submitted_at DESC LIMIT $" + (values.length + 1) +
        " OFFSET $" + (values.length + 2),
        pageValues
      );
      res.status(200).json({
        data: result.rows,
        meta: {
          page: filters.data.page,
          pageSize: filters.data.pageSize,
          total: count.rows[0]?.total ?? 0
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/reports/:reportId", ...reportRead, async (req, res, next) => {
    const reportId = z.string().uuid().safeParse(req.params.reportId);
    if (!reportId.success) {
      res.status(404).json({ error: { code: "REPORT_NOT_FOUND", message: "Report not found." } });
      return;
    }
    try {
      const result = await database.query(
        "SELECT r.report_id AS \"reportId\", r.status, r.priority, r.is_anonymous AS \"isAnonymous\", " +
        "r.reporter_name AS \"reporterName\", r.reporter_contact AS \"reporterContact\", " +
        "r.description, r.submitted_at AS \"submittedAt\", r.updated_at AS \"updatedAt\", " +
        "r.review_reason AS \"reviewReason\", r.canonical_report_id AS \"canonicalReportId\", " +
        "a.area_id AS \"areaId\", a.name AS \"areaName\", z.name AS \"zoneName\", " +
        "wc.name AS \"categoryName\" " +
        "FROM waste_mgmt.waste_reports r " +
        "JOIN waste_mgmt.areas a ON a.area_id=r.area_id " +
        "JOIN waste_mgmt.zones z ON z.zone_id=a.zone_id " +
        "JOIN waste_mgmt.waste_categories wc ON wc.category_id=r.category_id " +
        "WHERE r.report_id=$1 AND r.fest_id=1",
        [reportId.data]
      );
      const report = result.rows[0];
      if (!report) {
        res.status(404).json({ error: { code: "REPORT_NOT_FOUND", message: "Report not found." } });
        return;
      }
      const canReview = req.auth?.roles.some(role => ["administrator","waste_manager"].includes(role)) ?? false;
      if (!canReview) {
        delete report.reporterName;
        delete report.reporterContact;
        delete report.reviewReason;
      }
      const [history, notes] = await Promise.all([
        database.query(
          "SELECT from_status AS \"fromStatus\", to_status AS \"toStatus\", reason, changed_at AS \"changedAt\" " +
          "FROM waste_mgmt.report_status_history WHERE report_id=$1 " +
          (canReview ? "" : "AND is_public=TRUE ") + "ORDER BY changed_at",
          [reportId.data]
        ),
        database.query(
          "SELECT body, visibility, created_at AS \"createdAt\" FROM waste_mgmt.report_notes " +
          "WHERE report_id=$1 " + (canReview ? "" : "AND visibility='public' ") + "ORDER BY created_at",
          [reportId.data]
        )
      ]);
      res.status(200).json({ data: { ...report, history: history.rows, notes: notes.rows } });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/reports/:reportId/review", authenticate(database), requirePermission(database, "reports.review"), async (req, res, next) => {
    const reportId = z.string().uuid().safeParse(req.params.reportId);
    const body = z.object({
      action: z.enum(["accept","reject","duplicate"]),
      reason: z.string().trim().max(1000).optional(),
      canonicalReportId: z.string().uuid().optional()
    }).strict().safeParse(req.body);
    if (!reportId.success || !body.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid report review request." } });
      return;
    }

    if (body.data.action !== "duplicate" && body.data.canonicalReportId) {
      res.status(422).json({ error: { code: "UNEXPECTED_CANONICAL_REPORT", message: "Only duplicate decisions can reference a canonical report." } });
      return;
    }
    if ((body.data.action === "reject" || body.data.action === "duplicate") && !body.data.reason) {
      res.status(422).json({ error: { code: "REASON_REQUIRED", message: "A reason is required for this review action." } });
      return;
    }
    if (body.data.action === "duplicate" && !body.data.canonicalReportId) {
      res.status(422).json({ error: { code: "CANONICAL_REPORT_REQUIRED", message: "Choose the original report this report duplicates." } });
      return;
    }
    try {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.actor_user_id',$1,true)", [req.auth?.userId ?? ""]);
        const current = await client.query(
          "SELECT report_id,status FROM waste_mgmt.waste_reports WHERE report_id=$1 AND fest_id=1 FOR UPDATE",
          [reportId.data]
        );
        const row = current.rows[0];
        if (!row) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: { code: "REPORT_NOT_FOUND", message: "Report not found." } });
          return;
        }
        if (row.status !== "under_review") {
          await client.query("ROLLBACK");
          res.status(409).json({ error: { code: "INVALID_REPORT_STATE", message: "Only reports under review can receive a review decision." } });
          return;
        }
        if (body.data.canonicalReportId) {
          const canonical = await client.query(
            "SELECT report_id FROM waste_mgmt.waste_reports WHERE report_id=$1 AND status NOT IN ('duplicate','rejected','cancelled')",
            [body.data.canonicalReportId]
          );
          if (canonical.rowCount !== 1 || body.data.canonicalReportId === reportId.data) {
            await client.query("ROLLBACK");
            res.status(422).json({ error: { code: "INVALID_CANONICAL_REPORT", message: "The selected original report is not valid." } });
            return;
          }
        }
        const nextStatus = body.data.action === "accept" ? "accepted" : body.data.action === "reject" ? "rejected" : "duplicate";
        const updated = await client.query(
          "UPDATE waste_mgmt.waste_reports SET status=$1, reviewed_by=$2, reviewed_at=now(), review_reason=$3, canonical_report_id=$4 " +
          "WHERE report_id=$5 RETURNING report_id AS \"reportId\", status, reviewed_at AS \"reviewedAt\"",
          [nextStatus, req.auth?.userId, body.data.reason ?? null, body.data.canonicalReportId ?? null, reportId.data]
        );
        await client.query("COMMIT");
        res.status(200).json({ data: updated.rows[0] });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  });


  const taskRead = [authenticate(database), requirePermission(database, "tasks.read")];
  const taskScope = (userId: string, roles: string[]) => {
    if (roles.some(role => ["administrator","waste_manager"].includes(role))) return { sql: "TRUE", values: [] as string[] };
    if (roles.includes("team_lead")) {
      return {
        sql: "EXISTS (SELECT 1 FROM waste_mgmt.task_assignments ta LEFT JOIN waste_mgmt.teams tm ON tm.team_id=ta.team_id WHERE ta.task_id=t.task_id AND ta.unassigned_at IS NULL AND (ta.user_id=$1 OR tm.team_lead_user_id=$1))",
        values: [userId]
      };
    }
    return {
      sql: "EXISTS (SELECT 1 FROM waste_mgmt.task_assignments ta LEFT JOIN waste_mgmt.team_memberships tm ON tm.team_id=ta.team_id AND tm.user_id=$1 AND tm.ends_at IS NULL WHERE ta.task_id=t.task_id AND ta.unassigned_at IS NULL AND (ta.user_id=$1 OR tm.user_id=$1))",
      values: [userId]
    };
  };

  app.get("/api/v1/tasks", ...taskRead, async (req, res, next) => {
    const filters = z.object({
      status: z.enum(["draft","open","assigned","in_progress","submitted_for_verification","verified","cancelled"]).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20)
    }).safeParse(req.query);
    if (!filters.success || !req.auth) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid task filters." } });
      return;
    }
    try {
      const scope = taskScope(req.auth.userId, req.auth.roles);
      const conditions = ["t.fest_id=1", scope.sql];
      const values: (string | number)[] = [...scope.values];
      if (filters.data.status) {
        values.push(filters.data.status);
        conditions.push("t.status=$" + values.length);
      }
      const where = conditions.join(" AND ");
      const count = await database.query(
        "SELECT COUNT(*)::int AS total FROM waste_mgmt.collection_tasks t WHERE " + where,
        values
      );
      const pageValues = [...values, filters.data.pageSize, (filters.data.page-1)*filters.data.pageSize];
      const result = await database.query(
        "SELECT t.task_id AS \"taskId\", t.title, t.priority, t.status, t.due_at AS \"dueAt\", " +
        "t.created_at AS \"createdAt\", a.name AS \"areaName\", z.name AS \"zoneName\" " +
        "FROM waste_mgmt.collection_tasks t JOIN waste_mgmt.areas a ON a.area_id=t.area_id " +
        "JOIN waste_mgmt.zones z ON z.zone_id=a.zone_id WHERE " + where +
        " ORDER BY t.due_at NULLS LAST, t.created_at DESC LIMIT $" + (values.length+1) +
        " OFFSET $" + (values.length+2),
        pageValues
      );
      res.status(200).json({ data: result.rows, meta: { page: filters.data.page, pageSize: filters.data.pageSize, total: count.rows[0]?.total ?? 0 } });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/tasks/:taskId", ...taskRead, async (req, res, next) => {
    const id = z.string().uuid().safeParse(req.params.taskId);
    if (!id.success || !req.auth) {
      res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found." } });
      return;
    }
    try {
      const scope = taskScope(req.auth.userId, req.auth.roles);
      const result = await database.query(
        "SELECT t.task_id AS \"taskId\", t.title, t.instructions, t.priority, t.status, t.due_at AS \"dueAt\", " +
        "t.created_at AS \"createdAt\", t.started_at AS \"startedAt\", t.completed_at AS \"completedAt\", " +
        "a.name AS \"areaName\", z.name AS \"zoneName\" " +
        "FROM waste_mgmt.collection_tasks t JOIN waste_mgmt.areas a ON a.area_id=t.area_id " +
        "JOIN waste_mgmt.zones z ON z.zone_id=a.zone_id WHERE t.task_id=$1 AND t.fest_id=1 AND " + scope.sql,
        [id.data, ...scope.values]
      );
      if (!result.rows[0]) {
        res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found." } });
        return;
      }
      res.status(200).json({ data: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/tasks", authenticate(database), requirePermission(database, "tasks.manage"), async (req, res, next) => {
    const body = z.object({
      areaId: z.string().uuid(),
      title: z.string().trim().min(3).max(160),
      instructions: z.string().trim().max(3000).optional(),
      priority: z.enum(["low","normal","high","urgent"]).default("normal"),
      dueAt: z.string().datetime().optional(),
      reportId: z.string().uuid().optional(),
      assignedUserId: z.string().uuid().optional(),
      assignedTeamId: z.string().uuid().optional()
    }).strict().safeParse(req.body);
    if (!body.success || !req.auth) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid task details." } });
      return;
    }
    if (body.data.assignedUserId && body.data.assignedTeamId) {
      res.status(422).json({ error: { code: "INVALID_ASSIGNMENT", message: "Assign a task to one user or one team, not both." } });
      return;
    }
    try {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.actor_user_id',$1,true)", [req.auth.userId]);
        const area = await client.query(
          "SELECT area_id FROM waste_mgmt.areas WHERE area_id=$1 AND fest_id=1 AND is_active=TRUE FOR SHARE",
          [body.data.areaId]
        );
        if (area.rowCount !== 1) {
          await client.query("ROLLBACK");
          res.status(422).json({ error: { code: "INVALID_AREA", message: "The selected area is not active." } });
          return;
        }
        if (body.data.reportId) {
          const report = await client.query(
            "SELECT report_id,status,area_id FROM waste_mgmt.waste_reports WHERE report_id=$1 AND fest_id=1 FOR UPDATE",
            [body.data.reportId]
          );
          const row = report.rows[0];
          if (!row || row.status !== "accepted" || row.area_id !== body.data.areaId) {
            await client.query("ROLLBACK");
            res.status(409).json({ error: { code: "REPORT_NOT_ACTIONABLE", message: "Only an accepted report in the same area can create a primary collection task." } });
            return;
          }
        }
        if (body.data.assignedUserId) {
          const user = await client.query("SELECT user_id FROM waste_mgmt.users WHERE user_id=$1 AND status='active'",[body.data.assignedUserId]);
          if (user.rowCount !== 1) {
            await client.query("ROLLBACK");
            res.status(422).json({ error: { code: "INVALID_ASSIGNEE", message: "The selected user is not active." } });
            return;
          }
        }
        if (body.data.assignedTeamId) {
          const team = await client.query("SELECT team_id FROM waste_mgmt.teams WHERE team_id=$1 AND is_active=TRUE",[body.data.assignedTeamId]);
          if (team.rowCount !== 1) {
            await client.query("ROLLBACK");
            res.status(422).json({ error: { code: "INVALID_TEAM", message: "The selected team is not active." } });
            return;
          }
        }
        const inserted = await client.query(
          "INSERT INTO waste_mgmt.collection_tasks(fest_id,area_id,title,instructions,priority,due_at,created_by) " +
          "VALUES (1,$1,$2,$3,$4,$5,$6) RETURNING task_id AS \"taskId\", status",
          [body.data.areaId,body.data.title,body.data.instructions ?? null,body.data.priority,body.data.dueAt ?? null,req.auth.userId]
        );
        const task = inserted.rows[0];
        if (!task) throw new Error("Task creation returned no row.");
        await client.query(
          "INSERT INTO waste_mgmt.task_status_history(task_id,from_status,to_status,changed_by) VALUES ($1,NULL,'open',$2)",
          [task.taskId,req.auth.userId]
        );
        if (body.data.reportId) {
          await client.query(
            "INSERT INTO waste_mgmt.report_task_links(report_id,task_id,link_type,linked_by) VALUES ($1,$2,'primary',$3)",
            [body.data.reportId,task.taskId,req.auth.userId]
          );
          await client.query(
            "UPDATE waste_mgmt.waste_reports SET status='in_progress' WHERE report_id=$1",
            [body.data.reportId]
          );
        }
        if (body.data.assignedUserId || body.data.assignedTeamId) {
          await client.query(
            "INSERT INTO waste_mgmt.task_assignments(task_id,user_id,team_id,assigned_by) VALUES ($1,$2,$3,$4)",
            [task.taskId,body.data.assignedUserId ?? null,body.data.assignedTeamId ?? null,req.auth.userId]
          );
          await client.query("UPDATE waste_mgmt.collection_tasks SET status='assigned' WHERE task_id=$1",[task.taskId]);
          if (body.data.assignedUserId) {
            await client.query(
              "INSERT INTO waste_mgmt.notifications(user_id,type,title,body,resource_type,resource_id) VALUES ($1,'task_assignment','New collection task',$2,'task',$3)",
              [body.data.assignedUserId,body.data.title,task.taskId]
            );
          } else if (body.data.assignedTeamId) {
            await client.query(
              "INSERT INTO waste_mgmt.notifications(user_id,type,title,body,resource_type,resource_id) " +
              "SELECT user_id,'task_assignment','New team collection task',$2,'task',$3 " +
              "FROM waste_mgmt.team_memberships WHERE team_id=$1 AND ends_at IS NULL",
              [body.data.assignedTeamId,body.data.title,task.taskId]
            );
          }
        }
        await client.query("COMMIT");
        res.status(201).json({ data: task });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/public/form-options", async (_req, res, next) => {
    try {
      const [areas, categories] = await Promise.all([
        database.query(
          `SELECT a.area_id AS "areaId", a.name AS "areaName", z.name AS "zoneName"
           FROM waste_mgmt.areas a
           JOIN waste_mgmt.zones z ON z.zone_id=a.zone_id
           WHERE a.fest_id=1 AND a.is_active=TRUE AND z.is_active=TRUE
           ORDER BY z.name, a.name`
        ),
        database.query(
          `SELECT category_id AS "categoryId", name
           FROM waste_mgmt.waste_categories
           WHERE is_active=TRUE ORDER BY name`
        )
      ]);
      res.status(200).json({ data: { areas: areas.rows, categories: categories.rows } });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/health", (_req, res) => {
    res.status(200).json({ data: { status: "ok" } });
  });

  app.get("/api/v1/ready", async (_req, res, next) => {
    try {
      await database.query("SELECT 1");
      res.status(200).json({ data: { status: "ready", database: "reachable" } });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/public/reports", publicReportLimiter, async (req, res, next) => {
    const parsed = publicWasteReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "The report contains invalid fields.", details: parsed.error.flatten() }
      });
      return;
    }

    const client = await database.connect();
    try {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await client.query("BEGIN");

      const area = await client.query(
        "SELECT area_id FROM waste_mgmt.areas WHERE area_id=$1 AND fest_id=1 AND is_active=TRUE",
        [parsed.data.areaId]
      );
      if (area.rowCount !== 1) {
        await client.query("ROLLBACK");
        res.status(422).json({ error: { code: "INVALID_AREA", message: "The selected area is not active for this fest." } });
        return;
      }

      const category = await client.query(
        "SELECT category_id FROM waste_mgmt.waste_categories WHERE category_id=$1 AND is_active=TRUE",
        [parsed.data.categoryId]
      );
      if (category.rowCount !== 1) {
        await client.query("ROLLBACK");
        res.status(422).json({ error: { code: "INVALID_CATEGORY", message: "The selected waste category is not active." } });
        return;
      }

      if (parsed.data.binId) {
        const bin = await client.query(
          "SELECT bin_id FROM waste_mgmt.bins WHERE bin_id=$1 AND area_id=$2 AND fest_id=1 AND is_active=TRUE",
          [parsed.data.binId, parsed.data.areaId]
        );
        if (bin.rowCount !== 1) {
          await client.query("ROLLBACK");
          res.status(422).json({ error: { code: "INVALID_BIN", message: "The selected bin does not belong to the selected area." } });
          return;
        }
      }

      const inserted = await client.query<{ report_id: string; submitted_at: Date }>(
        `INSERT INTO waste_mgmt.waste_reports
          (area_id, bin_id, category_id, is_anonymous, reporter_name, reporter_contact, description, estimated_weight_kg)
         VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7)
         RETURNING report_id, submitted_at`,
        [
          parsed.data.areaId,
          parsed.data.binId ?? null,
          parsed.data.categoryId,
          parsed.data.reporterName ?? null,
          parsed.data.reporterContact ?? null,
          parsed.data.description,
          parsed.data.estimatedWeightKg ?? null
        ]
      );

      const report = inserted.rows[0];
      if (!report) throw new Error("Report insert returned no row.");

      await client.query(
        "INSERT INTO waste_mgmt.report_tracking_tokens (report_id, token_hash, expires_at) VALUES ($1,$2,now()+interval '180 days')",
        [report.report_id, tokenHash]
      );
      await client.query(
        "INSERT INTO waste_mgmt.report_status_history (report_id, from_status, to_status, is_public) VALUES ($1,NULL,'submitted',TRUE)",
        [report.report_id]
      );
      await client.query("COMMIT");

      res.status(201).json({
        data: {
          reportId: report.report_id,
          submittedAt: report.submitted_at,
          trackingToken: token,
          message: "Save this tracking token. It is shown only once."
        }
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(error);
    } finally {
      client.release();
    }
  });

  app.get("/api/v1/public/reports/:reportId/status", async (req, res, next) => {
    const id = z.string().uuid().safeParse(req.params.reportId);
    const token = z.string().min(40).max(100).safeParse(req.header("x-report-tracking-token"));
    if (!id.success || !token.success) {
      res.status(404).json({ error: { code: "REPORT_NOT_FOUND", message: "Report not found." } });
      return;
    }
    try {
      const tokenHash = createHash("sha256").update(token.data).digest("hex");
      const result = await database.query(
        `SELECT r.report_id, r.status, r.submitted_at, r.updated_at
         FROM waste_mgmt.waste_reports r
         JOIN waste_mgmt.report_tracking_tokens t ON t.report_id=r.report_id
         WHERE r.report_id=$1 AND t.token_hash=$2
           AND t.revoked_at IS NULL AND t.expires_at > now() AND r.is_anonymous=TRUE`,
        [id.data, tokenHash]
      );
      const report = result.rows[0];
      if (!report) {
        res.status(404).json({ error: { code: "REPORT_NOT_FOUND", message: "Report not found." } });
        return;
      }
      res.status(200).json({ data: report });
    } catch (error) {
      next(error);
    }
  });

  const notFound = (_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found." } });
  };
  app.use(notFound);

  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) return;
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : 500;
    if (status === 400) {
      res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body contains invalid JSON." } });
      return;
    }
    console.error("API request failed", { requestId: res.locals.requestId });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", requestId: res.locals.requestId } });
  };
  app.use(errors);

  return app;
}
