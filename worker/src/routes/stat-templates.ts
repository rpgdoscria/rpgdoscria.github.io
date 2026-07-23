// routes/stat-templates.ts — CRUD de stat_templates (mestre only)
//
// stat_templates são os status BASE da campanha, definidos pelo mestre e
// compartilhados por todos os personagens. Jogadores escolhem quais usar
// ao criar personagem.

import { Hono } from "hono";
import type { Env } from "../env";
import type { JwtPayload } from "../lib/crypto";
import { audit, queryAll, queryFirst, queryRun } from "../lib/db";

export const statTemplateRoutes = new Hono<{ Bindings: Env; Variables: { user?: JwtPayload } }>();

// Middleware: só admin pode mexer em stat_templates (status base do jogo).
// Desde a migration 0005, mestre e admin são o mesmo cargo.
async function requireMaster(c: any, next: any) {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const row = await queryFirst<{ role: string; active: number }>(
    c.env.DB,
    `SELECT role, active FROM users WHERE id = ?`,
    user.sub
  );
  if (!row || row.active !== 1) return c.json({ error: "Conta inativa." }, 403);
  if (row.role !== "admin") {
    return c.json({ error: "Apenas administradores podem gerenciar status base." }, 403);
  }
  await next();
}

const VALID_TYPES = new Set(["bar", "number", "text", "tag_list", "checkbox", "formula"]);

// GET /api/stat-templates — qualquer autenticado pode listar (jogador precisa ver pra escolher)
statTemplateRoutes.get("/", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const includeInactive = c.req.query("includeInactive") === "1";
  const rows = await queryAll<any>(
    c.env.DB,
    includeInactive
      ? `SELECT * FROM stat_templates ORDER BY active DESC, name ASC`
      : `SELECT * FROM stat_templates WHERE active = 1 ORDER BY name ASC`
  );
  return c.json({ templates: rows });
});

// POST /api/stat-templates — mestre+
statTemplateRoutes.post("/", requireMaster, async (c) => {
  const user = c.get("user") as JwtPayload;
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const name = String(body?.name ?? "").trim();
  const type = String(body?.type ?? "").trim();
  if (!name || name.length > 50) return c.json({ error: "Nome é obrigatório (máx 50 chars)." }, 400);
  if (!VALID_TYPES.has(type)) return c.json({ error: `Tipo inválido: ${type}` }, 400);
  const defaultMax = type === "bar" ? Number(body.defaultMax ?? 0) : null;
  const color = body.color && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : null;
  const description = body.description ? String(body.description).slice(0, 200) : null;
  const isPrimaryHealth = body.isPrimaryHealth ? 1 : 0;
  const result = await c.env.DB.prepare(
    `INSERT INTO stat_templates (name, type, default_max, color, description, created_by, is_primary_health)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(name, type, defaultMax, color, description, user.sub, isPrimaryHealth).run();
  const newId = result.meta.last_row_id as number;
  await audit(c.env.DB, user.sub, "stat_template.create", name, `type=${type}`);
  return c.json({ ok: true, id: newId }, 201);
});

// PUT /api/stat-templates/:id — mestre+
statTemplateRoutes.put("/:id", requireMaster, async (c) => {
  const user = c.get("user") as JwtPayload;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id inválido." }, 400);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }

  const existing = await queryFirst<any>(c.env.DB, `SELECT * FROM stat_templates WHERE id = ?`, id);
  if (!existing) return c.json({ error: "Status base não encontrado." }, 404);

  const name = body.name ? String(body.name).trim().slice(0, 50) : existing.name;
  const type = body.type && VALID_TYPES.has(body.type) ? body.type : existing.type;
  const defaultMax = body.defaultMax !== undefined ? (type === "bar" ? Number(body.defaultMax) : null) : existing.default_max;
  const color = body.color !== undefined ? (body.color && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : null) : existing.color;
  const description = body.description !== undefined ? (body.description ? String(body.description).slice(0, 200) : null) : existing.description;
  const isPrimaryHealth = body.isPrimaryHealth !== undefined ? (body.isPrimaryHealth ? 1 : 0) : existing.is_primary_health;

  await c.env.DB.prepare(
    `UPDATE stat_templates SET name = ?, type = ?, default_max = ?, color = ?, description = ?, is_primary_health = ? WHERE id = ?`
  ).bind(name, type, defaultMax, color, description, isPrimaryHealth, id).run();
  await audit(c.env.DB, user.sub, "stat_template.update", name, `id=${id}`);
  return c.json({ ok: true });
});

// POST /api/stat-templates/:id/deactivate — soft delete
statTemplateRoutes.post("/:id/deactivate", requireMaster, async (c) => {
  const user = c.get("user") as JwtPayload;
  const id = Number(c.req.param("id"));
  // Checa se está em uso por algum personagem
  const inUse = await queryFirst<{ c: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS c FROM character_stats WHERE stat_template_id = ?`,
    id
  );
  // Mesmo que não esteja em uso agora, desativar (não apagar) é mais seguro.
  await c.env.DB.prepare(`UPDATE stat_templates SET active = 0 WHERE id = ?`).bind(id).run();
  await audit(c.env.DB, user.sub, "stat_template.deactivate", String(id), `in_use=${inUse?.c ?? 0}`);
  return c.json({ ok: true, wasInUse: (inUse?.c ?? 0) > 0 });
});

// POST /api/stat-templates/:id/reactivate
statTemplateRoutes.post("/:id/reactivate", requireMaster, async (c) => {
  const user = c.get("user") as JwtPayload;
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(`UPDATE stat_templates SET active = 1 WHERE id = ?`).bind(id).run();
  await audit(c.env.DB, user.sub, "stat_template.reactivate", String(id), null);
  return c.json({ ok: true });
});
