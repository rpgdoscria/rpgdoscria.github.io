// routes/admin.ts — painel administrativo (admin only)
// CRUD de usuários + audit log

import { Hono } from "hono";
import type { Env } from "../env";
import type { JwtPayload } from "../lib/crypto";
import { hashPassword } from "../lib/crypto";
import { audit, queryAll, queryFirst } from "../lib/db";
import { requireRole } from "../lib/middleware";

export const adminRoutes = new Hono<{ Bindings: Env; Variables: { user?: JwtPayload } }>();

// Todas as rotas deste router exigem admin.
adminRoutes.use("*", requireRole("admin"));

// ---------- GET /api/admin/users ----------
adminRoutes.get("/users", async (c) => {
  const rows = await queryAll<{
    id: number;
    username: string;
    role: string;
    active: number;
    must_change_password: number;
    last_login: string | null;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT id, username, role, active, must_change_password, last_login, created_at
     FROM users ORDER BY created_at ASC`
  );
  return c.json({ users: rows });
});

// ---------- POST /api/admin/users ----------
adminRoutes.post("/users", async (c) => {
  const user = c.get("user") as JwtPayload;
  let body: { username?: string; password?: string; role?: string; must_change_password?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON inválido." }, 400);
  }
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  const role = (body.role ?? "viewer").toLowerCase();
  if (username.length < 3) return c.json({ error: "Username deve ter ao menos 3 caracteres." }, 400);
  if (password.length < 8) return c.json({ error: "Senha deve ter ao menos 8 caracteres." }, 400);
  if (!["admin", "editor", "viewer"].includes(role)) {
    return c.json({ error: "Papel inválido." }, 400);
  }

  const clash = await queryFirst<{ id: number }>(
    c.env.DB,
    `SELECT id FROM users WHERE username = ? COLLATE NOCASE`,
    username
  );
  if (clash) return c.json({ error: "Username já existe." }, 409);

  const { hash, salt } = await hashPassword(password);
  const mustChange = body.must_change_password ? 1 : 0;
  const result = await c.env.DB.prepare(
    `INSERT INTO users (username, password_hash, salt, role, active, must_change_password)
     VALUES (?, ?, ?, ?, 1, ?)`
  )
    .bind(username, hash, salt, role, mustChange)
    .run();
  const newId = result.meta.last_row_id as number;
  await audit(c.env.DB, user.sub, "user.create", username, `role=${role}`);

  return c.json({ ok: true, id: newId, username, role }, 201);
});

// ---------- PATCH /api/admin/users/:id ----------
adminRoutes.patch("/users/:id", async (c) => {
  const user = c.get("user") as JwtPayload;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id inválido." }, 400);

  let body: { role?: string; active?: boolean; password?: string; must_change_password?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON inválido." }, 400);
  }

  const target = await queryFirst<{ id: number; username: string; role: string }>(
    c.env.DB,
    `SELECT id, username, role FROM users WHERE id = ?`,
    id
  );
  if (!target) return c.json({ error: "Usuário não encontrado." }, 404);

  // Não permite que o último admin se rebaixe/desative.
  if (target.role === "admin") {
    const adminCount = await queryFirst<{ c: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS c FROM users WHERE role='admin' AND active=1`
    );
    if (adminCount && adminCount.c <= 1 && (body.role !== undefined && body.role !== "admin" || body.active === false)) {
      return c.json({ error: "Não é possível rebaixar ou desativar o último administrador ativo." }, 400);
    }
  }

  if (body.role !== undefined) {
    if (!["admin", "editor", "viewer"].includes(body.role)) {
      return c.json({ error: "Papel inválido." }, 400);
    }
    await c.env.DB.prepare(`UPDATE users SET role = ? WHERE id = ?`).bind(body.role, id).run();
  }
  if (body.active !== undefined) {
    await c.env.DB.prepare(`UPDATE users SET active = ? WHERE id = ?`).bind(body.active ? 1 : 0, id).run();
  }
  if (body.must_change_password !== undefined) {
    await c.env.DB.prepare(`UPDATE users SET must_change_password = ? WHERE id = ?`)
      .bind(body.must_change_password ? 1 : 0, id)
      .run();
  }
  if (typeof body.password === "string" && body.password.length >= 8) {
    const { hash, salt } = await hashPassword(body.password);
    await c.env.DB.prepare(`UPDATE users SET password_hash = ?, salt = ?, must_change_password = 1 WHERE id = ?`)
      .bind(hash, salt, id)
      .run();
  }

  await audit(c.env.DB, user.sub, "user.update", target.username, JSON.stringify(body));
  return c.json({ ok: true });
});

// ---------- DELETE /api/admin/users/:id ----------
// Soft-delete: marca como inativo. Nunca apaga o histórico de edições.
adminRoutes.delete("/users/:id", async (c) => {
  const user = c.get("user") as JwtPayload;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id inválido." }, 400);
  if (id === user.sub) return c.json({ error: "Não é possível excluir a si mesmo." }, 400);

  const target = await queryFirst<{ id: number; username: string; role: string }>(
    c.env.DB,
    `SELECT id, username, role FROM users WHERE id = ?`,
    id
  );
  if (!target) return c.json({ error: "Usuário não encontrado." }, 404);

  if (target.role === "admin") {
    const adminCount = await queryFirst<{ c: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS c FROM users WHERE role='admin' AND active=1`
    );
    if (adminCount && adminCount.c <= 1) {
      return c.json({ error: "Não é possível excluir o último administrador ativo." }, 400);
    }
  }

  await c.env.DB.prepare(`UPDATE users SET active = 0 WHERE id = ?`).bind(id).run();
  await audit(c.env.DB, user.sub, "user.deactivate", target.username, null);
  return c.json({ ok: true });
});

// ---------- GET /api/admin/audit-log ----------
adminRoutes.get("/audit-log", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "100"), 500);
  const rows = await queryAll<{
    id: number;
    user_id: number | null;
    username: string | null;
    action: string;
    target: string | null;
    details: string | null;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT a.id, a.user_id, u.username, a.action, a.target, a.details, a.created_at
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC
     LIMIT ?`,
    limit
  );
  return c.json({ entries: rows });
});
