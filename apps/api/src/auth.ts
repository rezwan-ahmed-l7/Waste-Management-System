import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import type { Pool } from "pg";

type AuthDatabase = Pick<Pool, "query">;
type AuthenticatedUser = {
  userId: string;
  fullName: string;
  email: string;
  roles: string[];
};

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthenticatedUser;
  }
}

function sessionTokenFromRequest(request: import("express").Request): string | null {
  const cookieHeader = request.header("cookie");
  if (!cookieHeader) return null;
  const item = cookieHeader.split(";").map(value => value.trim()).find(value => value.startsWith("wm_session="));
  if (!item) return null;
  const value = item.slice("wm_session=".length);
  return value.length > 20 ? value : null;
}

export function authenticate(database: AuthDatabase): RequestHandler {
  return async (req, res, next) => {
    const token = sessionTokenFromRequest(req);
    if (!token) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
      return;
    }
    try {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const result = await database.query<{
        user_id: string;
        full_name: string;
        normalized_email: string;
        roles: string[];
      }>(
        `SELECT u.user_id, u.full_name, u.normalized_email,
          COALESCE(array_agg(DISTINCT r.role_key) FILTER (WHERE r.role_key IS NOT NULL), ARRAY[]::text[]) AS roles
         FROM waste_mgmt.sessions s
         JOIN waste_mgmt.users u ON u.user_id=s.user_id
         LEFT JOIN waste_mgmt.user_roles ur ON ur.user_id=u.user_id
         LEFT JOIN waste_mgmt.roles r ON r.role_id=ur.role_id
         WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
           AND u.status='active'
         GROUP BY u.user_id`,
        [tokenHash]
      );
      const row = result.rows[0];
      if (!row) {
        res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Your session is invalid or expired." } });
        return;
      }
      req.auth = { userId: row.user_id, fullName: row.full_name, email: row.normalized_email, roles: row.roles };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requirePermission(database: AuthDatabase, permissionKey: string): RequestHandler {
  return async (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
      return;
    }
    try {
      const result = await database.query(
        `SELECT 1
         FROM waste_mgmt.user_roles ur
         JOIN waste_mgmt.role_permissions rp ON rp.role_id=ur.role_id
         JOIN waste_mgmt.permissions p ON p.permission_id=rp.permission_id
         WHERE ur.user_id=$1 AND p.permission_key=$2
         LIMIT 1`,
        [req.auth.userId, permissionKey]
      );
      if (result.rowCount !== 1) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function readSessionToken(request: import("express").Request): string | null {
  return sessionTokenFromRequest(request);
}
