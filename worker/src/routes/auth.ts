// routes/auth.ts — autenticação
// POST /api/auth/login           — login com username + senha (com rate limit)
// GET  /api/auth/me              — dados do usuário a partir do token
// POST /api/auth/change-password — usuário troca a própria senha (quando must_change_password=1)
// POST /api/admin/bootstrap      — cria o PRIMEIRO admin (recusa se já existe)

import { Hono } from "hono";
import type { Env } from "../env";
import type { JwtPayload } from "../lib/crypto";
import { hashPassword, signJwt, verifyPassword } from "../lib/crypto";
import { audit, queryFirst } from "../lib/db";
import {
  clientIp,
  isLoginBlocked,
  pruneLoginAttempts,
  recordLoginAttempt,
} from "../lib/middleware";

export const authRoutes = new Hono<{ Bindings: Env; Variables: { user?: JwtPayload } }>();

// ---------- POST /api/auth/login ----------
authRoutes.post("/login", async (c) => {
  const env = c.env;
  let body: { username?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON inválido." }, 400);
  }
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!username || !password) return c.json({ error: "Usuário e senha são obrigatórios." }, 400);

  const ip = clientIp(c);

  // Rate limit por username/ip antes de fazer qualquer lookup.
  if (await isLoginBlocked(env, username, ip)) {
    return c.json(
      { error: "Muitas tentativas falhas. Tente novamente em alguns minutos." },
      429
    );
  }

  const user = await queryFirst<{
    id: number;
    username: string;
    password_hash: string;
    salt: string;
    role: "admin" | "editor" | "viewer";
    active: number;
    must_change_password: number;
  }>(
    env.DB,
    `SELECT id, username, password_hash, salt, role, active, must_change_password
     FROM users WHERE username = ? COLLATE NOCASE`,
    username
  );

  const ok = user && user.active === 1 && await verifyPassword(password, user.password_hash);
  await recordLoginAttempt(env, username, ip, !!ok);

  if (!ok) {
    // Mensagem genérica para não vazar se usuário existe ou não.
    return c.json({ error: "Usuário ou senha inválidos." }, 401);
  }

  // Login OK — limpa tentativas antigas e atualiza last_login.
  await pruneLoginAttempts(env, username);
  await c.env.DB.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`)
    .bind(user!.id)
    .run();
  await audit(env.DB, user!.id, "login", user!.username, null);

  const ttlDays = Number(env.JWT_TTL_DAYS ?? "7");
  const { token, expiresAt } = await signJwt(
    { sub: user!.id, username: user!.username, role: user!.role },
    env.JWT_SECRET,
    ttlDays
  );

  return c.json({
    token,
    role: user!.role,
    username: user!.username,
    // Mestre e admin são o mesmo cargo desde a migration 0005 — o frontend
    // continua recebendo isGameMaster pra compat, mas agora é só role === 'admin'.
    isGameMaster: user!.role === "admin",
    mustChangePassword: user!.must_change_password === 1,
    expiresAt,
  });
});

// ---------- GET /api/auth/me ----------
authRoutes.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Não autenticado." }, 401);

  const row = await queryFirst<{
    id: number;
    username: string;
    role: string;
    active: number;
    last_login: string | null;
    created_at: string;
    must_change_password: number;
  }>(
    c.env.DB,
    `SELECT id, username, role, active, last_login, created_at, must_change_password FROM users WHERE id = ?`,
    user.sub
  );
  if (!row || row.active !== 1) return c.json({ error: "Conta inativa." }, 403);

  return c.json({
    id: row.id,
    username: row.username,
    role: row.role,
    isGameMaster: row.role === "admin",
    lastLogin: row.last_login,
    createdAt: row.created_at,
    mustChangePassword: row.must_change_password === 1,
  });
});

// ---------- POST /api/auth/change-password ----------
// Permite que o usuário logado troque a própria senha. Necessário porque o
// fluxo `must_change_password=1` (setado pelo admin ao resetar senha de alguém)
// não tinha como ser satisfeito pelo usuário antes — só o admin podia mudar.
authRoutes.post("/change-password", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);

  let body: { currentPassword?: string; newPassword?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";
  if (newPassword.length < 8) {
    return c.json({ error: "Nova senha deve ter ao menos 8 caracteres." }, 400);
  }

  const row = await queryFirst<{ password_hash: string; active: number }>(
    c.env.DB,
    `SELECT password_hash, active FROM users WHERE id = ?`,
    user.sub
  );
  if (!row || row.active !== 1) return c.json({ error: "Conta inativa." }, 403);

  // Confere senha atual para evitar session hijack → troca silenciosa.
  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    return c.json({ error: "Senha atual incorreta." }, 401);
  }

  const { hash, salt } = await hashPassword(newPassword);
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, salt = ?, must_change_password = 0 WHERE id = ?`
  ).bind(hash, salt, user.sub).run();
  await audit(c.env.DB, user.sub, "password.change", user.username, null);
  return c.json({ ok: true });
});

// ---------- POST /api/admin/bootstrap ----------
// Cria o PRIMEIRO admin. Refuse se já existir qualquer admin.
// Requer header X-Bootstrap-Key igual ao secret ADMIN_BOOTSTRAP_KEY.
//
// IMPORTANTE: este handler é EXPORTADO como `bootstrapHandler` e registrado
// DIRETO em index.ts no caminho `/api/admin/bootstrap`, ANTES do middleware
// `requireRole("admin")` que protege todo o restante de /api/admin/*. Sem
// isso, o bootstrap nunca funcionaria — ele é a única rota de admin que
// precisa funcionar SEM admin autenticado (afinal, é como o primeiro admin
// é criado).
export async function bootstrapHandler(c: any) {
  const env = c.env as Env;
  const provided = c.req.header("X-Bootstrap-Key");
  if (!provided || provided !== env.ADMIN_BOOTSTRAP_KEY) {
    return c.json({ error: "Bootstrap key inválida." }, 401);
  }

  // Bloqueia reuso — se já existe admin, este endpoint morre.
  const existing = await queryFirst<{ c: number }>(
    env.DB,
    `SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`
  );
  if (existing && existing.c > 0) {
    return c.json({ error: "Já existe um administrador. Bootstrap desativado." }, 409);
  }

  let body: { username?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON inválido." }, 400);
  }
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (username.length < 3) return c.json({ error: "Username deve ter ao menos 3 caracteres." }, 400);
  if (password.length < 8) return c.json({ error: "Senha deve ter ao menos 8 caracteres." }, 400);

  const clash = await queryFirst<{ id: number }>(
    env.DB,
    `SELECT id FROM users WHERE username = ? COLLATE NOCASE`,
    username
  );
  if (clash) return c.json({ error: "Username já existe." }, 409);

  const { hash, salt } = await hashPassword(password);

  // Race condition corrigida: INSERT atômico com WHERE NOT EXISTS.
  const result = await env.DB.prepare(
    `INSERT INTO users (username, password_hash, salt, role, active, must_change_password)
     SELECT ?, ?, ?, 'admin', 1, 0
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')`
  )
    .bind(username, hash, salt)
    .run();

  if (!result.meta.last_row_id || result.meta.changes === 0) {
    return c.json({ error: "Já existe um administrador. Bootstrap desativado." }, 409);
  }

  const newId = result.meta.last_row_id as number;
  await audit(env.DB, newId, "admin.bootstrap", username, "Primeiro admin criado");

  return c.json({ ok: true, id: newId, username, role: "admin" }, 201);
}

// Rota legada em /api/auth/admin/bootstrap mantida por compatibilidade (aponta
// pro mesmo handler). O caminho canônico agora é /api/admin/bootstrap.
authRoutes.post("/admin/bootstrap", bootstrapHandler);
