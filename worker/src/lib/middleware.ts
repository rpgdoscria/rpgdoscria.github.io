// lib/middleware.ts — CORS, auth guard, rate limit
// Middleware central: tudo que protege rotas passa aqui.

import type { Context, Next } from "hono";
import type { Env } from "../env";
import { verifyJwt, type JwtPayload } from "./crypto";
import { queryFirst, queryRun } from "./db";

// ----- CORS -----
// Origins permitidas: variável de ambiente CORS_ORIGIN + PAGES_ORIGIN (lista
// separada por vírgula). Em `wrangler dev` pode-se usar localhost.
function allowedOrigins(env: Env): string[] {
  const raw = `${env.CORS_ORIGIN ?? ""},${env.PAGES_ORIGIN ?? ""}`;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsMiddleware() {
  return async (c: Context, next: Next) => {
    const origin = c.req.header("Origin");
    const allowed = allowedOrigins(c.env as Env);

    if (origin && allowed.includes(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }
    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    c.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Bootstrap-Key"
    );
    c.header("Access-Control-Max-Age", "86400");

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  };
}

// ----- Auth guard -----
// Decodifica o JWT e injeta c.set("user", payload). Não aborta se faltar token;
// quem decide se exige auth é o `requireRole`.
export async function authParser(c: Context, next: Next) {
  const auth = c.req.header("Authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match) {
    const payload = await verifyJwt(match[1], (c.env as Env).JWT_SECRET);
    if (payload) c.set("user", payload);
  }
  await next();
}

// Exige papel mínimo. Passar roles em ordem crescente de privilégio:
// 'viewer' < 'editor' < 'admin'.
const ROLE_RANK: Record<string, number> = { viewer: 1, editor: 2, admin: 3 };

export function requireRole(minRole: "viewer" | "editor" | "admin") {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as JwtPayload | undefined;
    if (!user) return c.json({ error: "Não autenticado." }, 401);
    if (ROLE_RANK[user.role] < ROLE_RANK[minRole]) {
      return c.json({ error: "Permissão insuficiente." }, 403);
    }
    // Re-checa o usuário no banco para garantir que ainda está ativo.
    const row = await queryFirst<{ active: number; role: string }>(
      (c.env as Env).DB,
      `SELECT active, role FROM users WHERE id = ?`,
      user.sub
    );
    if (!row || row.active !== 1) return c.json({ error: "Conta inativa." }, 403);
    if (ROLE_RANK[row.role] < ROLE_RANK[minRole]) {
      return c.json({ error: "Permissão revogada." }, 403);
    }
    await next();
  };
}

// ----- Rate limit (login) -----
// Conta tentativas falhas recentes (username OU ip) na tabela login_attempts.
//
// BUG CORRIGIDO: antes comparávamos `created_at > ?` onde `?` era um timestamp
// ISO do JS (`2026-07-23T03:20:00.000Z`) enquanto `created_at` é salvo pela
// migration com `DEFAULT (datetime('now'))` que produz `2026-07-23 03:20:00`
// (sem T, sem Z, sem ms). Como o caractere espaço (0x20) é menor que 'T' (0x54),
// a comparação lexicográfica sempre dava false — o rate limit NUNCA disparava.
// Agora usamos `datetime('now', '-N minutes')` no SQL, garantindo mesmo formato.
export async function isLoginBlocked(
  env: Env,
  username: string,
  ip: string | null
): Promise<boolean> {
  const maxFails = Number(env.RATE_LIMIT_MAX_FAILS ?? "5");
  const windowMin = Number(env.RATE_LIMIT_WINDOW_MIN ?? "15");

  // Soma falhas por username E por IP — bloqueia se qualquer um dos dois passar.
  const byUsername = await queryFirst<{ c: number }>(
    env.DB,
    `SELECT COUNT(*) AS c FROM login_attempts
     WHERE username = ? AND success = 0
       AND created_at > datetime('now', ?)`,
    username.toLowerCase(),
    `-${windowMin} minutes`
  );
  if (byUsername && byUsername.c >= maxFails) return true;

  if (ip) {
    const byIp = await queryFirst<{ c: number }>(
      env.DB,
      `SELECT COUNT(*) AS c FROM login_attempts
       WHERE ip = ? AND success = 0
         AND created_at > datetime('now', ?)`,
      ip,
      `-${windowMin} minutes`
    );
    if (byIp && byIp.c >= maxFails) return true;
  }
  return false;
}

export async function recordLoginAttempt(
  env: Env,
  username: string,
  ip: string | null,
  success: boolean
): Promise<void> {
  // Best-effort: se falhar (ex. DB indisponível), não pode quebrar o fluxo de login.
  try {
    await queryRun(
      env.DB,
      `INSERT INTO login_attempts (username, ip, success) VALUES (?, ?, ?)`,
      username.toLowerCase(),
      ip,
      success ? 1 : 0
    );
  } catch (err) {
    console.error("recordLoginAttempt failed", err);
  }
}

// Limpa tentativas antigas (chamar periodicamente no login bem-sucedido).
export async function pruneLoginAttempts(env: Env, username: string): Promise<void> {
  await queryRun(
    env.DB,
    `DELETE FROM login_attempts WHERE username = ? AND created_at < datetime('now', '-1 day')`,
    username.toLowerCase()
  );
}

// ----- util: IP do cliente -----
export function clientIp(c: Context): string | null {
  const fwd = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For");
  if (!fwd) return null;
  return fwd.split(",")[0].trim();
}
