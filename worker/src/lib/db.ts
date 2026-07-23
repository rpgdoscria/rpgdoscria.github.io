// lib/db.ts — helpers de query no D1
// Mantém o acesso ao banco tipado e centraliza padrões (prepare + bind).

import type { D1Database } from "@cloudflare/workers-types";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  salt: string;
  role: "admin" | "editor" | "viewer";
  active: number;
  must_change_password: number;
  created_at: string;
  last_login: string | null;
}

export interface PageRow {
  id: number;
  slug: string;
  title: string;
  category: string;
  content_md: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface RevisionRow {
  id: number;
  page_id: number;
  content_md: string;
  editor_id: number;
  comment: string | null;
  created_at: string;
}

export interface AuditRow {
  id: number;
  user_id: number | null;
  action: string;
  target: string | null;
  details: string | null;
  created_at: string;
}

export interface LoginAttemptRow {
  id: number;
  username: string;
  ip: string | null;
  success: number;
  created_at: string;
}

// Helper genérico: prepare + bind + all/first/run
export type BindValue = string | number | null | undefined;

export async function queryAll<T = unknown>(
  db: D1Database,
  sql: string,
  ...params: BindValue[]
): Promise<T[]> {
  const ps = db.prepare(sql).bind(...params);
  const result = await ps.all<T>();
  return result.results ?? [];
}

export async function queryFirst<T = unknown>(
  db: D1Database,
  sql: string,
  ...params: BindValue[]
): Promise<T | null> {
  const ps = db.prepare(sql).bind(...params);
  const result = await ps.first<T>();
  return result ?? null;
}

export async function queryRun(
  db: D1Database,
  sql: string,
  ...params: BindValue[]
): Promise<{ meta: D1Result["meta"] }> {
  const ps = db.prepare(sql).bind(...params);
  const result = await ps.run();
  return { meta: result.meta };
}

// Log de auditoria (não lança — auditoria é best-effort)
export async function audit(
  db: D1Database,
  userId: number | null,
  action: string,
  target: string | null = null,
  details: string | null = null
): Promise<void> {
  try {
    await queryRun(
      db,
      `INSERT INTO audit_log (user_id, action, target, details) VALUES (?, ?, ?, ?)`,
      userId,
      action,
      target,
      details
    );
  } catch (err) {
    // Não quebra a rota se o log falhar; apenas registra no console.
    console.error("audit log failed", err);
  }
}
