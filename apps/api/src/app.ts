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
        "r.submitted_at AS \"submittedAt\", r.updated_at AS \"updatedAt\", r.description, a.area_id AS \"areaId\", " +
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


  app.post("/api/v1/reports/:reportId/start-review", authenticate(database), requirePermission(database, "reports.review"), async (req, res, next) => {
    const id = z.string().uuid().safeParse(req.params.reportId);
    const auth = req.auth;
    if (!id.success || !auth) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid report ID." } });
      return;
    }
    try {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.actor_user_id',$1,true)",[auth.userId]);
        const current = await client.query(
          "SELECT report_id,status FROM waste_mgmt.waste_reports WHERE report_id=$1 AND fest_id=1 FOR UPDATE",
          [id.data]
        );
        if (!current.rows[0]) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: { code: "REPORT_NOT_FOUND", message: "Report not found." } });
          return;
        }
        if (current.rows[0].status !== "submitted") {
          await client.query("ROLLBACK");
          res.status(409).json({ error: { code: "INVALID_REPORT_STATE", message: "Only newly submitted reports can enter review." } });
          return;
        }
        const updated = await client.query(
          "UPDATE waste_mgmt.waste_reports SET status='under_review',reviewed_by=$1,reviewed_at=now() " +
          "WHERE report_id=$2 RETURNING report_id AS \"reportId\",status,reviewed_at AS \"reviewedAt\"",
          [auth.userId,id.data]
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
  const taskScope = (userId: string, roles: string[], parameterIndex = 1) => {
    const userParameter = "$" + parameterIndex;
    if (roles.some(role => ["administrator","waste_manager"].includes(role))) return { sql: "TRUE", values: [] as string[] };
    if (roles.includes("team_lead")) {
      return {
        sql: "EXISTS (SELECT 1 FROM waste_mgmt.task_assignments ta LEFT JOIN waste_mgmt.teams tm ON tm.team_id=ta.team_id WHERE ta.task_id=t.task_id AND ta.unassigned_at IS NULL AND (ta.user_id=" + userParameter + " OR tm.team_lead_user_id=" + userParameter + "))",
        values: [userId]
      };
    }
    return {
      sql: "EXISTS (SELECT 1 FROM waste_mgmt.task_assignments ta LEFT JOIN waste_mgmt.team_memberships tm ON tm.team_id=ta.team_id AND tm.user_id=" + userParameter + " AND tm.ends_at IS NULL AND tm.starts_at<=now() WHERE ta.task_id=t.task_id AND ta.unassigned_at IS NULL AND (ta.user_id=" + userParameter + " OR tm.user_id=" + userParameter + "))",
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
        "t.created_at AS \"createdAt\", a.name AS \"areaName\", z.name AS \"zoneName\", " +
        "latest.submission_id AS \"latestSubmissionId\", latest.status AS \"latestSubmissionStatus\" " +
        "FROM waste_mgmt.collection_tasks t JOIN waste_mgmt.areas a ON a.area_id=t.area_id " +
        "JOIN waste_mgmt.zones z ON z.zone_id=a.zone_id " +
        "LEFT JOIN LATERAL (SELECT cs.submission_id,cs.status FROM waste_mgmt.collection_submissions cs WHERE cs.task_id=t.task_id ORDER BY cs.submitted_at DESC LIMIT 1) latest ON TRUE " +
        "WHERE " + where + " ORDER BY t.due_at NULLS LAST, t.created_at DESC LIMIT $" + (values.length+1) +
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
      const scope = taskScope(req.auth.userId, req.auth.roles, 2);
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







  app.get("/api/v1/roles", authenticate(database), requirePermission(database, "users.manage"), async (_req,res,next)=>{
    try{
      const result=await database.query("SELECT role_id AS \"roleId\",role_key AS \"roleKey\",display_name AS \"displayName\",description FROM waste_mgmt.roles ORDER BY role_id");
      res.status(200).json({data:result.rows});
    }catch(error){next(error);}
  });

  app.get("/api/v1/users", authenticate(database), requirePermission(database, "users.manage"), async (_req,res,next)=>{
    try{
      const result=await database.query(
        "SELECT u.user_id AS \"userId\",u.full_name AS \"fullName\",u.normalized_email AS email,u.phone_number AS \"phoneNumber\",u.status,u.created_at AS \"createdAt\", " +
        "COALESCE(array_agg(DISTINCT r.role_key) FILTER (WHERE r.role_key IS NOT NULL),ARRAY[]::text[]) AS roles " +
        "FROM waste_mgmt.users u LEFT JOIN waste_mgmt.user_roles ur ON ur.user_id=u.user_id " +
        "LEFT JOIN waste_mgmt.roles r ON r.role_id=ur.role_id GROUP BY u.user_id ORDER BY u.created_at DESC LIMIT 500"
      );
      res.status(200).json({data:result.rows});
    }catch(error){next(error);}
  });

  app.post("/api/v1/users", authenticate(database), requirePermission(database, "users.manage"), async (req,res,next)=>{
    const body=z.object({
      fullName:z.string().trim().min(2).max(120),
      email:z.string().trim().email().max(254),
      password:z.string().min(14).max(128),
      roleIds:z.array(z.coerce.number().int().positive()).min(1).max(10)
    }).strict().safeParse(req.body);
    if(!body.success){res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Invalid user details. Password must be at least 14 characters."}});return;}
    try{
      const client=await database.connect();
      try{
        await client.query("BEGIN");
        const roles=await client.query("SELECT role_id FROM waste_mgmt.roles WHERE role_id=ANY($1::smallint[])",[body.data.roleIds]);
        if(roles.rowCount!==new Set(body.data.roleIds).size){
          await client.query("ROLLBACK");
          res.status(422).json({error:{code:"INVALID_ROLES",message:"One or more selected roles do not exist."}});
          return;
        }
        const passwordHash=await argon2.hash(body.data.password,{type:argon2.argon2id});
        const user=await client.query(
          "INSERT INTO waste_mgmt.users(full_name,email,password_hash) VALUES ($1,$2,$3) RETURNING user_id AS \"userId\",full_name AS \"fullName\",normalized_email AS email,status",
          [body.data.fullName,body.data.email,passwordHash]
        );
        const userId=user.rows[0]?.userId;
        if(!userId)throw new Error("User account could not be created.");
        for(const roleId of new Set(body.data.roleIds)){
          await client.query("INSERT INTO waste_mgmt.user_roles(user_id,role_id,assigned_by) VALUES ($1,$2,$3)",[userId,roleId,req.auth?.userId]);
        }
        await client.query("COMMIT");
        res.status(201).json({data:user.rows[0]});
      }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
      finally{client.release();}
    }catch(error){next(error);}
  });

  app.patch("/api/v1/users/:userId/status", authenticate(database), requirePermission(database, "users.manage"), async (req,res,next)=>{
    const id=z.string().uuid().safeParse(req.params.userId);
    const body=z.object({status:z.enum(["active","suspended","disabled"])}).strict().safeParse(req.body);
    if(!id.success||!body.success){res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Invalid account status update."}});return;}
    try{
      const auth=req.auth;
      const client=await database.connect();
      try{
        await client.query("BEGIN");
        if(body.data.status!=="active"){
          const isAdmin=await client.query(
            "SELECT EXISTS(SELECT 1 FROM waste_mgmt.user_roles ur JOIN waste_mgmt.roles r ON r.role_id=ur.role_id WHERE ur.user_id=$1 AND r.role_key='administrator') AS is_admin",
            [id.data]
          );
          if(isAdmin.rows[0]?.is_admin){
            const count=await client.query(
              "SELECT COUNT(*)::int AS total FROM waste_mgmt.user_roles ur JOIN waste_mgmt.roles r ON r.role_id=ur.role_id JOIN waste_mgmt.users u ON u.user_id=ur.user_id WHERE r.role_key='administrator' AND u.status='active'"
            );
            if(Number(count.rows[0]?.total??0)<=1){
              await client.query("ROLLBACK");
              res.status(409).json({error:{code:"LAST_ADMIN_PROTECTED",message:"The last active Administrator account cannot be suspended or disabled."}});
              return;
            }
          }
          if(auth?.userId===id.data && isAdmin.rows[0]?.is_admin){
            await client.query("ROLLBACK");
            res.status(409).json({error:{code:"SELF_LOCKOUT_PREVENTED",message:"You cannot suspend or disable your own Administrator account."}});
            return;
          }
        }
        if(auth)await client.query("SELECT set_config('app.actor_user_id',$1,true)",[auth.userId]);
        const updated=await client.query(
          "UPDATE waste_mgmt.users SET status=$1 WHERE user_id=$2 RETURNING user_id AS \"userId\",status",
          [body.data.status,id.data]
        );
        if(!updated.rows[0]){
          await client.query("ROLLBACK");
          res.status(404).json({error:{code:"USER_NOT_FOUND",message:"User not found."}});
          return;
        }
        if(body.data.status!=="active")await client.query("UPDATE waste_mgmt.sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",[id.data]);
        await client.query("COMMIT");
        res.status(200).json({data:updated.rows[0]});
      }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
      finally{client.release();}
    }catch(error){next(error);}
  });

  app.put("/api/v1/users/:userId/roles", authenticate(database), requirePermission(database, "users.manage"), async (req,res,next)=>{
    const id=z.string().uuid().safeParse(req.params.userId);
    const body=z.object({roleIds:z.array(z.coerce.number().int().positive()).min(1).max(10)}).strict().safeParse(req.body);
    const auth=req.auth;
    if(!id.success||!body.success||!auth){res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Invalid role assignment."}});return;}
    try{
      const client=await database.connect();
      try{
        await client.query("BEGIN");
        const roleRows=await client.query("SELECT role_id,role_key FROM waste_mgmt.roles WHERE role_id=ANY($1::smallint[])",[body.data.roleIds]);
        if(roleRows.rowCount!==new Set(body.data.roleIds).size){
          await client.query("ROLLBACK");
          res.status(422).json({error:{code:"INVALID_ROLES",message:"One or more selected roles do not exist."}});
          return;
        }
        const hasAdmin=roleRows.rows.some((role:{role_id:number;role_key:string})=>role.role_key==="administrator");
        if(id.data===auth.userId&&!hasAdmin){
          await client.query("ROLLBACK");
          res.status(409).json({error:{code:"SELF_LOCKOUT_PREVENTED",message:"You cannot remove your own Administrator role."}});
          return;
        }
        const currentAdmin=await client.query(
          "SELECT EXISTS(SELECT 1 FROM waste_mgmt.user_roles ur JOIN waste_mgmt.roles r ON r.role_id=ur.role_id WHERE ur.user_id=$1 AND r.role_key='administrator') AS is_admin",
          [id.data]
        );
        if(currentAdmin.rows[0]?.is_admin&&!hasAdmin){
          const count=await client.query("SELECT COUNT(*)::int AS total FROM waste_mgmt.user_roles ur JOIN waste_mgmt.roles r ON r.role_id=ur.role_id WHERE r.role_key='administrator'");
          if(Number(count.rows[0]?.total??0)<=1){
            await client.query("ROLLBACK");
            res.status(409).json({error:{code:"LAST_ADMIN_PROTECTED",message:"The last Administrator account cannot lose its role."}});
            return;
          }
        }
        await client.query("DELETE FROM waste_mgmt.user_roles WHERE user_id=$1",[id.data]);
        for(const roleId of new Set(body.data.roleIds)){
          await client.query("INSERT INTO waste_mgmt.user_roles(user_id,role_id,assigned_by) VALUES ($1,$2,$3)",[id.data,roleId,auth.userId]);
        }
        await client.query("UPDATE waste_mgmt.sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",[id.data]);
        await client.query("COMMIT");
        res.status(200).json({data:{userId:id.data,roleIds:[...new Set(body.data.roleIds)]}});
      }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
      finally{client.release();}
    }catch(error){next(error);}
  });

  app.get("/api/v1/locations", authenticate(database), requirePermission(database, "locations.manage"), async (_req,res,next)=>{
    try {
      const [zones,areas,bins] = await Promise.all([
        database.query("SELECT zone_id AS \"zoneId\",code,name,description,is_active AS \"isActive\" FROM waste_mgmt.zones WHERE fest_id=1 ORDER BY name"),
        database.query("SELECT area_id AS \"areaId\",zone_id AS \"zoneId\",parent_area_id AS \"parentAreaId\",code,name,is_active AS \"isActive\" FROM waste_mgmt.areas WHERE fest_id=1 ORDER BY name"),
        database.query("SELECT b.bin_id AS \"binId\",b.area_id AS \"areaId\",b.code,b.capacity_kg AS \"capacityKg\",b.is_active AS \"isActive\",wc.name AS \"categoryName\" FROM waste_mgmt.bins b LEFT JOIN waste_mgmt.waste_categories wc ON wc.category_id=b.category_id WHERE b.fest_id=1 ORDER BY b.code")
      ]);
      res.status(200).json({data:{zones:zones.rows,areas:areas.rows,bins:bins.rows}});
    } catch(error){next(error);}
  });

  app.post("/api/v1/zones", authenticate(database), requirePermission(database, "locations.manage"), async (req,res,next)=>{
    const body=z.object({code:z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),name:z.string().trim().min(2).max(100),description:z.string().trim().max(1000).optional()}).strict().safeParse(req.body);
    if(!body.success){res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Invalid zone details."}});return;}
    try{
      const result=await database.query(
        "INSERT INTO waste_mgmt.zones(fest_id,code,name,description) VALUES (1,$1,$2,$3) RETURNING zone_id AS \"zoneId\",code,name",
        [body.data.code.toUpperCase(),body.data.name,body.data.description??null]
      );
      res.status(201).json({data:result.rows[0]});
    }catch(error){next(error);}
  });

  app.post("/api/v1/areas", authenticate(database), requirePermission(database, "locations.manage"), async (req,res,next)=>{
    const body=z.object({zoneId:z.string().uuid(),parentAreaId:z.string().uuid().optional(),code:z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),name:z.string().trim().min(2).max(120),description:z.string().trim().max(1000).optional()}).strict().safeParse(req.body);
    if(!body.success){res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Invalid area details."}});return;}
    try{
      const zone=await database.query("SELECT zone_id FROM waste_mgmt.zones WHERE zone_id=$1 AND fest_id=1 AND is_active=TRUE",[body.data.zoneId]);
      if(zone.rowCount!==1){res.status(422).json({error:{code:"INVALID_ZONE",message:"The selected zone is not active."}});return;}
      if(body.data.parentAreaId){
        const parent=await database.query("SELECT area_id FROM waste_mgmt.areas WHERE area_id=$1 AND zone_id=$2 AND is_active=TRUE",[body.data.parentAreaId,body.data.zoneId]);
        if(parent.rowCount!==1){res.status(422).json({error:{code:"INVALID_PARENT_AREA",message:"Parent area must be active and belong to the selected zone."}});return;}
      }
      const result=await database.query(
        "INSERT INTO waste_mgmt.areas(fest_id,zone_id,parent_area_id,code,name,description) VALUES (1,$1,$2,$3,$4,$5) RETURNING area_id AS \"areaId\",zone_id AS \"zoneId\",code,name",
        [body.data.zoneId,body.data.parentAreaId??null,body.data.code.toUpperCase(),body.data.name,body.data.description??null]
      );
      res.status(201).json({data:result.rows[0]});
    }catch(error){next(error);}
  });

  app.post("/api/v1/bins", authenticate(database), requirePermission(database, "locations.manage"), async (req,res,next)=>{
    const body=z.object({areaId:z.string().uuid(),code:z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),categoryId:z.coerce.number().int().positive().optional(),capacityKg:z.coerce.number().positive().max(100000).optional()}).strict().safeParse(req.body);
    if(!body.success){res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Invalid bin details."}});return;}
    try{
      const area=await database.query("SELECT area_id FROM waste_mgmt.areas WHERE area_id=$1 AND fest_id=1 AND is_active=TRUE",[body.data.areaId]);
      if(area.rowCount!==1){res.status(422).json({error:{code:"INVALID_AREA",message:"The selected area is not active."}});return;}
      if(body.data.categoryId){
        const category=await database.query("SELECT category_id FROM waste_mgmt.waste_categories WHERE category_id=$1 AND is_active=TRUE",[body.data.categoryId]);
        if(category.rowCount!==1){res.status(422).json({error:{code:"INVALID_CATEGORY",message:"The selected waste category is not active."}});return;}
      }
      const result=await database.query(
        "INSERT INTO waste_mgmt.bins(fest_id,area_id,code,category_id,capacity_kg) VALUES (1,$1,$2,$3,$4) RETURNING bin_id AS \"binId\",area_id AS \"areaId\",code,capacity_kg AS \"capacityKg\"",
        [body.data.areaId,body.data.code.toUpperCase(),body.data.categoryId??null,body.data.capacityKg??null]
      );
      res.status(201).json({data:result.rows[0]});
    }catch(error){next(error);}
  });

  app.post("/api/v1/waste-categories", authenticate(database), requirePermission(database, "locations.manage"), async (req,res,next)=>{
    const body=z.object({code:z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),name:z.string().trim().min(2).max(80),description:z.string().trim().max(1000).optional(),isRecyclable:z.boolean().default(false)}).strict().safeParse(req.body);
    if(!body.success){res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Invalid waste category details."}});return;}
    try{
      const result=await database.query(
        "INSERT INTO waste_mgmt.waste_categories(code,name,description,is_recyclable) VALUES ($1,$2,$3,$4) RETURNING category_id AS \"categoryId\",code,name,is_recyclable AS \"isRecyclable\"",
        [body.data.code.toLowerCase(),body.data.name,body.data.description??null,body.data.isRecyclable]
      );
      res.status(201).json({data:result.rows[0]});
    }catch(error){next(error);}
  });

  app.patch("/api/v1/zones/:zoneId/status", authenticate(database), requirePermission(database, "locations.manage"), async (req,res,next)=>{
    const id=z.string().uuid().safeParse(req.params.zoneId);
    const body=z.object({isActive:z.boolean()}).strict().safeParse(req.body);
    if(!id.success||!body.success){res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Invalid zone status update."}});return;}
    try{
      const client=await database.connect();
      try{
        await client.query("BEGIN");
        const updated = await client.query("UPDATE waste_mgmt.zones SET is_active=$1 WHERE zone_id=$2 AND fest_id=1",[body.data.isActive,id.data]);
        if (updated.rowCount !== 1) { await client.query("ROLLBACK"); res.status(404).json({error:{code:"ZONE_NOT_FOUND",message:"Zone not found."}}); return; }
        if(!body.data.isActive){
          await client.query("UPDATE waste_mgmt.areas SET is_active=FALSE WHERE zone_id=$1",[id.data]);
          await client.query("UPDATE waste_mgmt.bins SET is_active=FALSE WHERE area_id IN (SELECT area_id FROM waste_mgmt.areas WHERE zone_id=$1)",[id.data]);
        }
        await client.query("COMMIT");
        res.status(200).json({data:{zoneId:id.data,isActive:body.data.isActive}});
      }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
      finally{client.release();}
    }catch(error){next(error);}
  });

  app.patch("/api/v1/areas/:areaId/status", authenticate(database), requirePermission(database, "locations.manage"), async (req,res,next)=>{
    const id=z.string().uuid().safeParse(req.params.areaId);
    const body=z.object({isActive:z.boolean()}).strict().safeParse(req.body);
    if(!id.success||!body.success){res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Invalid area status update."}});return;}
    try{
      const client=await database.connect();
      try{
        await client.query("BEGIN");
        const updated = await client.query("UPDATE waste_mgmt.areas SET is_active=$1 WHERE area_id=$2 AND fest_id=1",[body.data.isActive,id.data]);
        if (updated.rowCount !== 1) { await client.query("ROLLBACK"); res.status(404).json({error:{code:"AREA_NOT_FOUND",message:"Area not found."}}); return; }
        if(!body.data.isActive){
          await client.query(
            "WITH RECURSIVE descendants(area_id) AS (SELECT area_id FROM waste_mgmt.areas WHERE area_id=$1 " +
            "UNION ALL SELECT child.area_id FROM waste_mgmt.areas child JOIN descendants parent ON child.parent_area_id=parent.area_id) " +
            "UPDATE waste_mgmt.areas SET is_active=FALSE WHERE area_id IN (SELECT area_id FROM descendants)",
            [id.data]
          );
          await client.query(
            "UPDATE waste_mgmt.bins SET is_active=FALSE WHERE area_id IN " +
            "(WITH RECURSIVE descendants(area_id) AS (SELECT area_id FROM waste_mgmt.areas WHERE area_id=$1 " +
            "UNION ALL SELECT child.area_id FROM waste_mgmt.areas child JOIN descendants parent ON child.parent_area_id=parent.area_id) " +
            "SELECT area_id FROM descendants)",
            [id.data]
          );
        }
        await client.query("COMMIT");
        res.status(200).json({data:{areaId:id.data,isActive:body.data.isActive}});
      }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
      finally{client.release();}
    }catch(error){next(error);}
  });

  app.patch("/api/v1/bins/:binId/status", authenticate(database), requirePermission(database, "locations.manage"), async (req,res,next)=>{
    const id=z.string().uuid().safeParse(req.params.binId);
    const body=z.object({isActive:z.boolean()}).strict().safeParse(req.body);
    if(!id.success||!body.success){res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Invalid bin status update."}});return;}
    try{
      const result=await database.query("UPDATE waste_mgmt.bins SET is_active=$1 WHERE bin_id=$2 AND fest_id=1 RETURNING bin_id AS \"binId\",is_active AS \"isActive\"",[body.data.isActive,id.data]);
      if(!result.rows[0]){res.status(404).json({error:{code:"BIN_NOT_FOUND",message:"Bin not found."}});return;}
      res.status(200).json({data:result.rows[0]});
    }catch(error){next(error);}
  });

  app.patch("/api/v1/waste-categories/:categoryId/status", authenticate(database), requirePermission(database, "locations.manage"), async (req,res,next)=>{
    const id=z.coerce.number().int().positive().safeParse(req.params.categoryId);
    const body=z.object({isActive:z.boolean()}).strict().safeParse(req.body);
    if(!id.success||!body.success){res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Invalid category status update."}});return;}
    try{
      const result=await database.query("UPDATE waste_mgmt.waste_categories SET is_active=$1 WHERE category_id=$2 RETURNING category_id AS \"categoryId\",is_active AS \"isActive\"",[body.data.isActive,id.data]);
      if(!result.rows[0]){res.status(404).json({error:{code:"CATEGORY_NOT_FOUND",message:"Waste category not found."}});return;}
      res.status(200).json({data:result.rows[0]});
    }catch(error){next(error);}
  });

  app.get("/api/v1/users/assignable", authenticate(database), requirePermission(database, "tasks.manage"), async (_req, res, next) => {
    try {
      const result = await database.query(
        "SELECT user_id AS \"userId\",full_name AS \"fullName\",normalized_email AS email " +
        "FROM waste_mgmt.users WHERE status='active' ORDER BY full_name"
      );
      res.status(200).json({ data: result.rows });
    } catch (error) { next(error); }
  });

  app.get("/api/v1/teams", authenticate(database), requirePermission(database, "tasks.manage"), async (_req, res, next) => {
    try {
      const result = await database.query(
        "SELECT t.team_id AS \"teamId\",t.name,t.code,t.team_lead_user_id AS \"teamLeadUserId\", " +
        "COUNT(tm.membership_id)::int AS \"activeMemberCount\" " +
        "FROM waste_mgmt.teams t LEFT JOIN waste_mgmt.team_memberships tm ON tm.team_id=t.team_id AND tm.ends_at IS NULL " +
        "WHERE t.is_active=TRUE GROUP BY t.team_id ORDER BY t.name"
      );
      res.status(200).json({ data: result.rows });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/teams", authenticate(database), requirePermission(database, "tasks.manage"), async (req, res, next) => {
    const body = z.object({
      name: z.string().trim().min(2).max(100),
      code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),
      teamLeadUserId: z.string().uuid().optional()
    }).strict().safeParse(req.body);
    if (!body.success || !req.auth) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid team details." } });
      return;
    }
    try {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        if (body.data.teamLeadUserId) {
          const lead = await client.query("SELECT user_id FROM waste_mgmt.users WHERE user_id=$1 AND status='active'",[body.data.teamLeadUserId]);
          if (lead.rowCount !== 1) {
            await client.query("ROLLBACK");
            res.status(422).json({ error: { code: "INVALID_TEAM_LEAD", message: "The selected team lead is not active." } });
            return;
          }
        }
        const result = await client.query(
          "INSERT INTO waste_mgmt.teams(name,code,team_lead_user_id) VALUES ($1,$2,$3) RETURNING team_id AS \"teamId\",name,code,team_lead_user_id AS \"teamLeadUserId\"",
          [body.data.name,body.data.code.toUpperCase(),body.data.teamLeadUserId ?? null]
        );
        const team = result.rows[0];
        if (body.data.teamLeadUserId && team) {
          await client.query(
            "INSERT INTO waste_mgmt.team_memberships(team_id,user_id,member_role) VALUES ($1,$2,'team_lead') ON CONFLICT DO NOTHING",
            [team.teamId,body.data.teamLeadUserId]
          );
        }
        await client.query("COMMIT");
        res.status(201).json({ data: team });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    } catch (error) { next(error); }
  });

  app.post("/api/v1/teams/:teamId/members", authenticate(database), requirePermission(database, "tasks.manage"), async (req, res, next) => {
    const teamId = z.string().uuid().safeParse(req.params.teamId);
    const body = z.object({ userId: z.string().uuid(), memberRole: z.enum(["team_lead","volunteer"]).default("volunteer") }).strict().safeParse(req.body);
    if (!teamId.success || !body.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid team membership." } });
      return;
    }
    try {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const team = await client.query("SELECT team_id FROM waste_mgmt.teams WHERE team_id=$1 AND is_active=TRUE FOR UPDATE",[teamId.data]);
        const user = await client.query("SELECT user_id FROM waste_mgmt.users WHERE user_id=$1 AND status='active'",[body.data.userId]);
        if (team.rowCount !== 1 || user.rowCount !== 1) {
          await client.query("ROLLBACK");
          res.status(422).json({ error: { code: "INVALID_MEMBERSHIP", message: "The team or user is not active." } });
          return;
        }
        const membership = await client.query(
          "INSERT INTO waste_mgmt.team_memberships(team_id,user_id,member_role) VALUES ($1,$2,$3) RETURNING membership_id AS \"membershipId\",team_id AS \"teamId\",user_id AS \"userId\",member_role AS \"memberRole\"",
          [teamId.data,body.data.userId,body.data.memberRole]
        );
        if (body.data.memberRole === "team_lead") {
          await client.query("UPDATE waste_mgmt.teams SET team_lead_user_id=$1 WHERE team_id=$2",[body.data.userId,teamId.data]);
        }
        await client.query("COMMIT");
        res.status(201).json({ data: membership.rows[0] });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    } catch (error) { next(error); }
  });

  app.post("/api/v1/tasks/:taskId/assignments", authenticate(database), requirePermission(database, "tasks.manage"), async (req, res, next) => {
    const taskId = z.string().uuid().safeParse(req.params.taskId);
    const body = z.object({
      userId: z.string().uuid().optional(),
      teamId: z.string().uuid().optional(),
      replaceExisting: z.boolean().default(false)
    }).strict().safeParse(req.body);
    const auth = req.auth;
    if (!taskId.success || !body.success || !auth || Boolean(body.data.userId) === Boolean(body.data.teamId)) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Choose exactly one active user or team to assign." } });
      return;
    }
    try {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.actor_user_id',$1,true)",[auth.userId]);
        const task = await client.query("SELECT task_id,status FROM waste_mgmt.collection_tasks WHERE task_id=$1 AND fest_id=1 FOR UPDATE",[taskId.data]);
        if (!task.rows[0] || !["open","assigned"].includes(task.rows[0].status)) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: { code: "INVALID_TASK_STATE", message: "Only open or assigned tasks can receive assignments." } });
          return;
        }
        if (body.data.userId) {
          const user = await client.query("SELECT user_id FROM waste_mgmt.users WHERE user_id=$1 AND status='active'",[body.data.userId]);
          if (user.rowCount !== 1) {
            await client.query("ROLLBACK");
            res.status(422).json({ error: { code: "INVALID_ASSIGNEE", message: "The selected user is not active." } });
            return;
          }
        }
        if (body.data.teamId) {
          const team = await client.query("SELECT team_id FROM waste_mgmt.teams WHERE team_id=$1 AND is_active=TRUE",[body.data.teamId]);
          if (team.rowCount !== 1) {
            await client.query("ROLLBACK");
            res.status(422).json({ error: { code: "INVALID_TEAM", message: "The selected team is not active." } });
            return;
          }
        }
        if (body.data.replaceExisting) {
          await client.query("UPDATE waste_mgmt.task_assignments SET unassigned_at=now() WHERE task_id=$1 AND unassigned_at IS NULL",[taskId.data]);
        }
        const result = await client.query(
          "INSERT INTO waste_mgmt.task_assignments(task_id,user_id,team_id,assigned_by) VALUES ($1,$2,$3,$4) " +
          "RETURNING assignment_id AS \"assignmentId\",task_id AS \"taskId\",user_id AS \"userId\",team_id AS \"teamId\",assigned_at AS \"assignedAt\"",
          [taskId.data,body.data.userId ?? null,body.data.teamId ?? null,auth.userId]
        );
        if (task.rows[0].status === "open") {
          await client.query("UPDATE waste_mgmt.collection_tasks SET status='assigned' WHERE task_id=$1",[taskId.data]);
        }
        if (body.data.userId) {
          await client.query(
            "INSERT INTO waste_mgmt.notifications(user_id,type,title,body,resource_type,resource_id) VALUES ($1,'task_assignment','New collection task','A task has been assigned to you.','task',$2)",
            [body.data.userId,taskId.data]
          );
        } else if (body.data.teamId) {
          await client.query(
            "INSERT INTO waste_mgmt.notifications(user_id,type,title,body,resource_type,resource_id) " +
            "SELECT tm.user_id,'task_assignment','New team task','A task has been assigned to your team.','task',$2 " +
            "FROM waste_mgmt.team_memberships tm JOIN waste_mgmt.users u ON u.user_id=tm.user_id AND u.status='active' " +
            "WHERE tm.team_id=$1 AND tm.ends_at IS NULL AND tm.starts_at<=now()",
            [body.data.teamId,taskId.data]
          );
        }
        await client.query("COMMIT");
        res.status(201).json({ data: result.rows[0] });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    } catch (error) { next(error); }
  });

  app.post("/api/v1/tasks/:taskId/close-no-waste", authenticate(database), requirePermission(database, "tasks.manage"), async (req, res, next) => {
    const id = z.string().uuid().safeParse(req.params.taskId);
    const body = z.object({ reason: z.string().trim().min(5).max(1000) }).strict().safeParse(req.body);
    const auth = req.auth;
    if (!id.success || !body.success || !auth) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A task ID and closure reason are required." } });
      return;
    }
    try {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.actor_user_id',$1,true)",[auth.userId]);
        const task = await client.query(
          "SELECT task_id,status FROM waste_mgmt.collection_tasks WHERE task_id=$1 AND fest_id=1 FOR UPDATE",
          [id.data]
        );
        if (!task.rows[0]) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found." } });
          return;
        }
        if (task.rows[0].status !== "in_progress") {
          await client.query("ROLLBACK");
          res.status(409).json({ error: { code: "INVALID_TASK_STATE", message: "Only an in-progress task can be closed as no-waste." } });
          return;
        }
        await client.query(
          "UPDATE waste_mgmt.collection_tasks SET status='verified',verified_by=$1,verified_at=now(),completed_at=now(),closure_reason=$2 WHERE task_id=$3",
          [auth.userId,body.data.reason,id.data]
        );
        await client.query(
          "UPDATE waste_mgmt.waste_reports r SET status='resolved' FROM waste_mgmt.report_task_links rtl " +
          "WHERE rtl.task_id=$1 AND rtl.report_id=r.report_id AND rtl.link_type='primary' AND rtl.ended_at IS NULL AND r.status='in_progress'",
          [id.data]
        );
        await client.query(
          "UPDATE waste_mgmt.report_task_links SET ended_at=now() WHERE task_id=$1 AND link_type='primary' AND ended_at IS NULL",
          [id.data]
        );
        await client.query("COMMIT");
        res.status(200).json({ data: { taskId: id.data, status: "verified", closureReason: body.data.reason } });
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

  app.post("/api/v1/tasks/:taskId/cancel", authenticate(database), requirePermission(database, "tasks.manage"), async (req, res, next) => {
    const id = z.string().uuid().safeParse(req.params.taskId);
    const body = z.object({ reason: z.string().trim().min(5).max(1000) }).strict().safeParse(req.body);
    const auth = req.auth;
    if (!id.success || !body.success || !auth) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A task ID and cancellation reason are required." } });
      return;
    }
    try {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.actor_user_id',$1,true)",[auth.userId]);
        const task = await client.query(
          "SELECT task_id,status FROM waste_mgmt.collection_tasks WHERE task_id=$1 AND fest_id=1 FOR UPDATE",
          [id.data]
        );
        if (!task.rows[0]) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found." } });
          return;
        }
        if (["verified","cancelled"].includes(task.rows[0].status)) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: { code: "TERMINAL_TASK", message: "Verified or cancelled tasks cannot be cancelled again." } });
          return;
        }
        await client.query(
          "UPDATE waste_mgmt.collection_tasks SET status='cancelled',cancelled_at=now(),cancellation_reason=$1 WHERE task_id=$2",
          [body.data.reason,id.data]
        );
        await client.query(
          "UPDATE waste_mgmt.report_task_links SET ended_at=now() WHERE task_id=$1 AND link_type='primary' AND ended_at IS NULL",
          [id.data]
        );
        await client.query("COMMIT");
        res.status(200).json({ data: { taskId: id.data, status: "cancelled" } });
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

  app.post("/api/v1/collection-submissions/:submissionId/decision", authenticate(database), requirePermission(database, "collections.verify"), async (req, res, next) => {
    const id = z.string().uuid().safeParse(req.params.submissionId);
    const body = z.object({
      decision: z.enum(["verify","reject"]),
      reason: z.string().trim().max(1000).optional()
    }).strict().safeParse(req.body);
    const auth = req.auth;
    if (!id.success || !body.success || !auth) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid collection decision." } });
      return;
    }
    if (body.data.decision === "reject" && !body.data.reason) {
      res.status(422).json({ error: { code: "REASON_REQUIRED", message: "A reason is required when rejecting collection evidence." } });
      return;
    }
    try {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.actor_user_id',$1,true)",[auth.userId]);
        const found = await client.query(
          "SELECT submission_id,task_id,submitted_by,status FROM waste_mgmt.collection_submissions WHERE submission_id=$1 FOR UPDATE",
          [id.data]
        );
        const submission = found.rows[0];
        if (!submission) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: { code: "SUBMISSION_NOT_FOUND", message: "Collection submission not found." } });
          return;
        }
        if (submission.status !== "submitted") {
          await client.query("ROLLBACK");
          res.status(409).json({ error: { code: "SUBMISSION_ALREADY_DECIDED", message: "This collection submission has already been reviewed." } });
          return;
        }
        const task = await client.query(
          "SELECT task_id,status FROM waste_mgmt.collection_tasks WHERE task_id=$1 FOR UPDATE",
          [submission.task_id]
        );
        if (task.rows[0]?.status !== "submitted_for_verification") {
          await client.query("ROLLBACK");
          res.status(409).json({ error: { code: "INVALID_TASK_STATE", message: "The task is not waiting for verification." } });
          return;
        }
        const nextStatus = body.data.decision === "verify" ? "verified" : "rejected";
        await client.query(
          "UPDATE waste_mgmt.collection_submissions SET status=$1,verified_by=$2,verified_at=now(),verification_note=$3 WHERE submission_id=$4",
          [nextStatus,auth.userId,body.data.reason ?? null,id.data]
        );
        if (nextStatus === "verified") {
          await client.query(
            "UPDATE waste_mgmt.collection_tasks SET status='verified',verified_by=$1,verified_at=now(),completed_at=now() WHERE task_id=$2",
            [auth.userId,submission.task_id]
          );
          await client.query(
            "UPDATE waste_mgmt.waste_reports r SET status='resolved' " +
            "FROM waste_mgmt.report_task_links rtl " +
            "WHERE rtl.task_id=$1 AND rtl.report_id=r.report_id AND rtl.link_type='primary' " +
            "AND rtl.ended_at IS NULL AND r.status='in_progress'",
            [submission.task_id]
          );
          await client.query(
            "UPDATE waste_mgmt.report_task_links SET ended_at=now() WHERE task_id=$1 AND link_type='primary' AND ended_at IS NULL",
            [submission.task_id]
          );
        } else {
          await client.query(
            "UPDATE waste_mgmt.collection_tasks SET status='in_progress' WHERE task_id=$1",
            [submission.task_id]
          );
        }
        await client.query(
          "INSERT INTO waste_mgmt.notifications(user_id,type,title,body,resource_type,resource_id) " +
          "VALUES ($1,'task_update',$2,$3,'task',$4)",
          [
            submission.submitted_by,
            nextStatus === "verified" ? "Collection verified" : "Collection needs correction",
            nextStatus === "verified" ? "Your submitted collection evidence was verified." : (body.data.reason ?? "Please review the manager feedback and submit corrected evidence."),
            submission.task_id
          ]
        );
        await client.query("COMMIT");
        res.status(200).json({ data: { submissionId: id.data, taskId: submission.task_id, status: nextStatus } });
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

  app.post("/api/v1/tasks/:taskId/start", authenticate(database), requirePermission(database, "tasks.execute"), async (req, res, next) => {
    const id = z.string().uuid().safeParse(req.params.taskId);
    const auth = req.auth;
    if (!id.success || !auth) {
      res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found." } });
      return;
    }
    try {
      const scope = taskScope(auth.userId, auth.roles, 2);
      const current = await database.query(
        "SELECT t.task_id,t.status FROM waste_mgmt.collection_tasks t " +
        "WHERE t.task_id=$1 AND t.fest_id=1 AND " + scope.sql,
        [id.data,...scope.values]
      );
      const task = current.rows[0];
      if (!task) {
        res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found." } });
        return;
      }
      if (task.status === "in_progress") {
        res.status(200).json({ data: { taskId: id.data, status: "in_progress" } });
        return;
      }
      if (task.status !== "assigned") {
        res.status(409).json({ error: { code: "INVALID_TASK_STATE", message: "Only assigned tasks can be started." } });
        return;
      }
      await database.query(
        "UPDATE waste_mgmt.collection_tasks SET status='in_progress', started_at=COALESCE(started_at,now()) WHERE task_id=$1",
        [id.data]
      );
      res.status(200).json({ data: { taskId: id.data, status: "in_progress" } });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/tasks/:taskId/submissions", authenticate(database), requirePermission(database, "collections.submit"), async (req, res, next) => {
    const id = z.string().uuid().safeParse(req.params.taskId);
    const body = z.object({
      notes: z.string().trim().max(2000).optional(),
      records: z.array(z.object({
        categoryId: z.coerce.number().int().positive(),
        enteredWeight: z.coerce.number().positive().max(10000000),
        enteredUnit: z.enum(["kg","g"]),
        measurementMethod: z.enum(["weighing_scale","estimated","count_converted"]),
        notes: z.string().trim().max(500).optional()
      }).strict()).min(1).max(20)
    }).strict().safeParse(req.body);
    const auth = req.auth;
    if (!id.success || !body.success || !auth) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid collection submission." } });
      return;
    }
    if (body.data.records.some(record => record.enteredUnit === "g" && !Number.isInteger(record.enteredWeight))) {
      res.status(422).json({ error: { code: "INVALID_WEIGHT_PRECISION", message: "Gram measurements must be whole numbers; kilogram measurements may use up to three decimal places." } });
      return;
    }
    try {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.actor_user_id',$1,true)",[auth.userId]);
        const scope = taskScope(auth.userId,auth.roles,2);
        const taskResult = await client.query(
          "SELECT t.task_id,t.status FROM waste_mgmt.collection_tasks t WHERE t.task_id=$1 AND t.fest_id=1 AND " + scope.sql + " FOR UPDATE",
          [id.data,...scope.values]
        );
        const task = taskResult.rows[0];
        if (!task) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found." } });
          return;
        }
        if (task.status !== "in_progress") {
          await client.query("ROLLBACK");
          res.status(409).json({ error: { code: "INVALID_TASK_STATE", message: "Start the assigned task before submitting collection evidence." } });
          return;
        }
        const inserted = await client.query(
          "INSERT INTO waste_mgmt.collection_submissions(task_id,submitted_by,notes) VALUES ($1,$2,$3) RETURNING submission_id AS \"submissionId\"",
          [id.data,auth.userId,body.data.notes ?? null]
        );
        const submissionId = inserted.rows[0]?.submissionId;
        if (!submissionId) throw new Error("Collection submission could not be created.");
        for (const record of body.data.records) {
          const category = await client.query(
            "SELECT category_id FROM waste_mgmt.waste_categories WHERE category_id=$1 AND is_active=TRUE",
            [record.categoryId]
          );
          if (category.rowCount !== 1) {
            await client.query("ROLLBACK");
            res.status(422).json({ error: { code: "INVALID_CATEGORY", message: "A submitted waste category is not active." } });
            return;
          }
          const weightKg = record.enteredUnit === "kg" ? record.enteredWeight : record.enteredWeight / 1000;
          await client.query(
            "INSERT INTO waste_mgmt.collection_records(submission_id,category_id,entered_weight,entered_unit,weight_kg,measurement_method,notes) " +
            "VALUES ($1,$2,$3,$4,$5,$6,$7)",
            [submissionId,record.categoryId,record.enteredWeight,record.enteredUnit,weightKg.toFixed(3),record.measurementMethod,record.notes ?? null]
          );
        }
        await client.query(
          "UPDATE waste_mgmt.collection_tasks SET status='submitted_for_verification', submitted_at=now() WHERE task_id=$1",
          [id.data]
        );
        await client.query(
          "INSERT INTO waste_mgmt.notifications(user_id,type,title,body,resource_type,resource_id) " +
          "SELECT ur.user_id,'task_update','Collection awaiting verification',$2,'task',$3 " +
          "FROM waste_mgmt.user_roles ur JOIN waste_mgmt.roles r ON r.role_id=ur.role_id " +
          "JOIN waste_mgmt.users u ON u.user_id=ur.user_id AND u.status='active' " +
          "WHERE r.role_key IN ('administrator','waste_manager')",
          ["A volunteer submitted collection evidence for review.",id.data]
        );
        await client.query("COMMIT");
        res.status(201).json({ data: { submissionId, taskId: id.data, status: "submitted" } });
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
          if (!row || !["accepted","in_progress"].includes(row.status) || row.area_id !== body.data.areaId) {
            await client.query("ROLLBACK");
            res.status(409).json({ error: { code: "REPORT_NOT_ACTIONABLE", message: "Only an accepted report in the same area can create a primary collection task." } });
            return;
          }
        }
        if (body.data.reportId) {
          const activeLink = await client.query(
            "SELECT task_id FROM waste_mgmt.report_task_links WHERE report_id=$1 AND link_type='primary' AND ended_at IS NULL",
            [body.data.reportId]
          );
          if (activeLink.rowCount) {
            await client.query("ROLLBACK");
            res.status(409).json({ error: { code: "REPORT_ALREADY_ASSIGNED", message: "This report already has an active primary collection task." } });
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
          if (row.status === "accepted") {
            await client.query(
              "UPDATE waste_mgmt.waste_reports SET status='in_progress' WHERE report_id=$1",
              [body.data.reportId]
            );
          }
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
              "SELECT tm.user_id,'task_assignment','New team collection task',$2,'task',$3 " +
              "FROM waste_mgmt.team_memberships tm JOIN waste_mgmt.users u ON u.user_id=tm.user_id AND u.status='active' " +
              "WHERE tm.team_id=$1 AND tm.ends_at IS NULL AND tm.starts_at<=now()",
              [body.data.assignedTeamId,body.data.title,task.taskId]
            );
          }
        }
        await client.query("COMMIT");
        res.status(201).json({ data: { ...task, status: body.data.assignedUserId || body.data.assignedTeamId ? "assigned" : "open" } });
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



  app.get("/api/v1/analytics/overview", authenticate(database), requirePermission(database, "analytics.read"), async (_req, res, next) => {
    try {
      const [reportCounts,taskCounts,verifiedWeights,destinationWeights,remainingWeight,zoneReports] = await Promise.all([
        database.query("SELECT status,COUNT(*)::int AS count FROM waste_mgmt.waste_reports WHERE fest_id=1 GROUP BY status ORDER BY status"),
        database.query("SELECT status,COUNT(*)::int AS count FROM waste_mgmt.collection_tasks WHERE fest_id=1 GROUP BY status ORDER BY status"),
        database.query("SELECT category_name AS \"categoryName\",verified_weight_kg AS \"weightKg\",verified_record_count AS \"recordCount\" FROM waste_mgmt.v_verified_collection_totals ORDER BY verified_weight_kg DESC"),
        database.query("SELECT md.destination_type AS \"destinationType\",SUM(ma.weight_kg) AS \"weightKg\" " +
          "FROM waste_mgmt.material_allocations ma JOIN waste_mgmt.material_destinations md ON md.destination_id=ma.destination_id " +
          "GROUP BY md.destination_type ORDER BY md.destination_type"),
        database.query("SELECT COALESCE(SUM(remaining_weight_kg),0) AS \"remainingWeightKg\" FROM waste_mgmt.v_material_balance"),
        database.query("SELECT z.name AS \"zoneName\",COUNT(r.report_id)::int AS \"reportCount\" " +
          "FROM waste_mgmt.zones z LEFT JOIN waste_mgmt.areas a ON a.zone_id=z.zone_id " +
          "LEFT JOIN waste_mgmt.waste_reports r ON r.area_id=a.area_id " +
          "GROUP BY z.zone_id,z.name ORDER BY \"reportCount\" DESC")
      ]);
      res.status(200).json({
        data: {
          reportCounts: reportCounts.rows,
          taskCounts: taskCounts.rows,
          verifiedWeights: verifiedWeights.rows,
          destinationWeights: destinationWeights.rows,
          remainingWeightKg: remainingWeight.rows[0]?.remainingWeightKg ?? 0,
          reportsByZone: zoneReports.rows
        }
      });
    } catch (error) { next(error); }
  });

  app.get("/api/v1/analytics/export.csv", authenticate(database), requirePermission(database, "analytics.read"), async (req, res, next) => {
    const query = z.object({ type: z.enum(["reports","tasks","collections"]) }).safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: { code: "INVALID_EXPORT_TYPE", message: "Choose reports, tasks, or collections." } });
      return;
    }
    const csvCell = (value: unknown) => {
      let text = value === null || value === undefined ? "" : String(value);
      if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g,'""') + '"';
    };
    try {
      let headers: string[];
      let rows: Record<string,unknown>[];
      if (query.data.type === "reports") {
        headers = ["reportId","status","priority","submittedAt","zone","area","category","description"];
        const result = await database.query(
          "SELECT r.report_id AS \"reportId\",r.status,r.priority,r.submitted_at AS \"submittedAt\",z.name AS zone,a.name AS area,wc.name AS category,r.description " +
          "FROM waste_mgmt.waste_reports r JOIN waste_mgmt.areas a ON a.area_id=r.area_id " +
          "JOIN waste_mgmt.zones z ON z.zone_id=a.zone_id JOIN waste_mgmt.waste_categories wc ON wc.category_id=r.category_id " +
          "WHERE r.fest_id=1 ORDER BY r.submitted_at DESC LIMIT 10000"
        );
        rows = result.rows;
      } else if (query.data.type === "tasks") {
        headers = ["taskId","title","status","priority","dueAt","zone","area"];
        const result = await database.query(
          "SELECT t.task_id AS \"taskId\",t.title,t.status,t.priority,t.due_at AS \"dueAt\",z.name AS zone,a.name AS area " +
          "FROM waste_mgmt.collection_tasks t JOIN waste_mgmt.areas a ON a.area_id=t.area_id " +
          "JOIN waste_mgmt.zones z ON z.zone_id=a.zone_id WHERE t.fest_id=1 ORDER BY t.created_at DESC LIMIT 10000"
        );
        rows = result.rows;
      } else {
        headers = ["submissionId","taskId","category","weightKg","measurementMethod","measuredAt"];
        const result = await database.query(
          "SELECT cs.submission_id AS \"submissionId\",cs.task_id AS \"taskId\",wc.name AS category,cr.weight_kg AS \"weightKg\",cr.measurement_method AS \"measurementMethod\",cr.measured_at AS \"measuredAt\" " +
          "FROM waste_mgmt.collection_records cr JOIN waste_mgmt.collection_submissions cs ON cs.submission_id=cr.submission_id " +
          "JOIN waste_mgmt.waste_categories wc ON wc.category_id=cr.category_id WHERE cs.status='verified' " +
          "ORDER BY cr.measured_at DESC LIMIT 10000"
        );
        rows = result.rows;
      }
      const csv = [headers.map(csvCell).join(","),...rows.map(row=>headers.map(header=>csvCell(row[header])).join(","))].join("\r\n");
      res.setHeader("Content-Type","text/csv; charset=utf-8");
      res.setHeader("Content-Disposition",'attachment; filename="baust-cse-fest-'+query.data.type+'.csv"');
      res.status(200).send("\uFEFF"+csv);
    } catch (error) { next(error); }
  });

  app.get("/api/v1/notifications", authenticate(database), async (req, res, next) => {
    const auth = req.auth;
    if (!auth) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
      return;
    }
    try {
      const result = await database.query(
        "SELECT notification_id AS \"notificationId\",type,title,body,resource_type AS \"resourceType\", " +
        "resource_id AS \"resourceId\",read_at AS \"readAt\",created_at AS \"createdAt\" " +
        "FROM waste_mgmt.notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
        [auth.userId]
      );
      res.status(200).json({ data: result.rows });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/notifications/:notificationId/read", authenticate(database), async (req, res, next) => {
    const id = z.string().uuid().safeParse(req.params.notificationId);
    const auth = req.auth;
    if (!id.success || !auth) {
      res.status(404).json({ error: { code: "NOTIFICATION_NOT_FOUND", message: "Notification not found." } });
      return;
    }
    try {
      const result = await database.query(
        "UPDATE waste_mgmt.notifications SET read_at=COALESCE(read_at,now()) " +
        "WHERE notification_id=$1 AND user_id=$2 RETURNING notification_id AS \"notificationId\",read_at AS \"readAt\"",
        [id.data,auth.userId]
      );
      if (!result.rows[0]) {
        res.status(404).json({ error: { code: "NOTIFICATION_NOT_FOUND", message: "Notification not found." } });
        return;
      }
      res.status(200).json({ data: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/notifications/read-all", authenticate(database), async (req, res, next) => {
    const auth = req.auth;
    if (!auth) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
      return;
    }
    try {
      const result = await database.query(
        "UPDATE waste_mgmt.notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL",
        [auth.userId]
      );
      res.status(200).json({ data: { markedRead: result.rowCount ?? 0 } });
    } catch (error) { next(error); }
  });

  app.get("/api/v1/announcements", authenticate(database), async (req, res, next) => {
    const auth = req.auth;
    if (!auth) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
      return;
    }
    try {
      const result = await database.query(
        "SELECT DISTINCT an.announcement_id AS \"announcementId\",an.title,an.body,an.audience, " +
        "an.published_at AS \"publishedAt\",an.expires_at AS \"expiresAt\" " +
        "FROM waste_mgmt.announcements an " +
        "WHERE an.published_at IS NOT NULL AND an.published_at<=now() AND (an.expires_at IS NULL OR an.expires_at>now()) " +
        "AND (an.audience='all_users' " +
        "OR (an.audience='role' AND EXISTS (SELECT 1 FROM waste_mgmt.user_roles ur WHERE ur.user_id=$1 AND ur.role_id=an.target_role_id)) " +
        "OR (an.audience='zone' AND EXISTS (" +
        "SELECT 1 FROM waste_mgmt.task_assignments ta JOIN waste_mgmt.collection_tasks t ON t.task_id=ta.task_id " +
        "JOIN waste_mgmt.areas a ON a.area_id=t.area_id " +
        "LEFT JOIN waste_mgmt.team_memberships tm ON tm.team_id=ta.team_id AND tm.user_id=$1 AND tm.ends_at IS NULL AND tm.starts_at<=now() " +
        "WHERE a.zone_id=an.target_zone_id AND ta.unassigned_at IS NULL AND (ta.user_id=$1 OR tm.user_id=$1)))) " +
        "ORDER BY an.published_at DESC LIMIT 50",
        [auth.userId]
      );
      res.status(200).json({ data: result.rows });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/announcements", authenticate(database), requirePermission(database, "announcements.manage"), async (req, res, next) => {
    const body = z.object({
      title: z.string().trim().min(3).max(160),
      body: z.string().trim().min(3).max(5000),
      audience: z.enum(["all_users","role","zone"]).default("all_users"),
      targetRoleId: z.coerce.number().int().positive().optional(),
      targetZoneId: z.string().uuid().optional(),
      expiresAt: z.string().datetime().optional()
    }).strict().safeParse(req.body);
    const auth = req.auth;
    if (!body.success || !auth) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid announcement details." } });
      return;
    }
    if ((body.data.audience==="role" && !body.data.targetRoleId) ||
        (body.data.audience==="zone" && !body.data.targetZoneId) ||
        (body.data.audience==="all_users" && (body.data.targetRoleId || body.data.targetZoneId)) ||
        (body.data.audience==="role" && body.data.targetZoneId) ||
        (body.data.audience==="zone" && body.data.targetRoleId)) {
      res.status(422).json({ error: { code: "INVALID_AUDIENCE", message: "Choose exactly one matching audience target." } });
      return;
    }
    try {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        let audienceValid = true;
        if (body.data.targetRoleId) {
          const role = await client.query("SELECT role_id FROM waste_mgmt.roles WHERE role_id=$1",[body.data.targetRoleId]);
          audienceValid = role.rowCount===1;
        }
        if (body.data.targetZoneId) {
          const zone = await client.query("SELECT zone_id FROM waste_mgmt.zones WHERE zone_id=$1 AND is_active=TRUE",[body.data.targetZoneId]);
          audienceValid = zone.rowCount===1;
        }
        if (!audienceValid) {
          await client.query("ROLLBACK");
          res.status(422).json({ error: { code: "INVALID_AUDIENCE_TARGET", message: "The selected role or zone is not valid." } });
          return;
        }
        const inserted = await client.query(
          "INSERT INTO waste_mgmt.announcements(title,body,audience,target_role_id,target_zone_id,published_by,published_at,expires_at) " +
          "VALUES ($1,$2,$3,$4,$5,$6,now(),$7) RETURNING announcement_id AS \"announcementId\",title,audience,published_at AS \"publishedAt\"",
          [body.data.title,body.data.body,body.data.audience,body.data.targetRoleId ?? null,body.data.targetZoneId ?? null,auth.userId,body.data.expiresAt ?? null]
        );
        const announcement = inserted.rows[0];
        if (!announcement) throw new Error("Announcement could not be published.");
        await client.query(
          "INSERT INTO waste_mgmt.notifications(user_id,type,title,body,resource_type,resource_id) " +
          "SELECT DISTINCT u.user_id,'announcement',$1,$2,'announcement',$3 FROM waste_mgmt.users u " +
          "WHERE u.status='active' AND (" +
          "$4='all_users' " +
          "OR ($4='role' AND EXISTS (SELECT 1 FROM waste_mgmt.user_roles ur WHERE ur.user_id=u.user_id AND ur.role_id=$5)) " +
          "OR ($4='zone' AND EXISTS (SELECT 1 FROM waste_mgmt.task_assignments ta " +
          "JOIN waste_mgmt.collection_tasks t ON t.task_id=ta.task_id JOIN waste_mgmt.areas a ON a.area_id=t.area_id " +
          "LEFT JOIN waste_mgmt.team_memberships tm ON tm.team_id=ta.team_id AND tm.user_id=u.user_id AND tm.ends_at IS NULL AND tm.starts_at<=now() " +
          "WHERE a.zone_id=$6 AND ta.unassigned_at IS NULL AND (ta.user_id=u.user_id OR tm.user_id=u.user_id)))" +
          ")",
          [body.data.title,body.data.body,announcement.announcementId,body.data.audience,body.data.targetRoleId ?? null,body.data.targetZoneId ?? null]
        );
        await client.query("COMMIT");
        res.status(201).json({ data: announcement });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    } catch (error) { next(error); }
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
