// routes/rule-sets.ts — CRUD de Sets de Regras (mestre/admin only)
//
// Um "Set de Regras" é um pacote nomeado de stat_templates que o mestre monta
// previamente. Ao criar um personagem, o jogador escolhe pelo menos 1 set,
// que aplica automaticamente todos os status do set na ficha.

import { Hono } from "hono";
import type { Env } from "../env";
import type { JwtPayload } from "../lib/crypto";
import { audit, queryAll, queryFirst } from "../lib/db";

export const ruleSetRoutes = new Hono<{ Bindings: Env; Variables: { user?: JwtPayload } }>();

// Middleware: só admin (mestre === admin desde a migration 0005)
async function requireAdmin(c: any, next: any) {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const row = await queryFirst<{ role: string; active: number }>(
    c.env.DB, `SELECT role, active FROM users WHERE id = ?`, user.sub
  );
  if (!row || row.active !== 1) return c.json({ error: "Conta inativa." }, 403);
  if (row.role !== "admin") {
    return c.json({ error: "Apenas administradores podem gerenciar sets de regras." }, 403);
  }
  await next();
}

// GET /api/rule-sets — qualquer autenticado lista (jogador precisa ver pra escolher)
ruleSetRoutes.get("/", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const includeInactive = c.req.query("includeInactive") === "1";
  const rows = await queryAll<any>(
    c.env.DB,
    includeInactive
      ? `SELECT * FROM rule_sets ORDER BY active DESC, name ASC`
      : `SELECT * FROM rule_sets WHERE active = 1 ORDER BY name ASC`
  );
  // Para cada set, carrega os stat_templates associados
  const out = [];
  for (const r of rows) {
    const stats = await queryAll<any>(
      c.env.DB,
      `SELECT rs.display_order, st.id, st.name, st.type, st.default_max, st.color, st.description, st.is_primary_health
       FROM rule_set_stats rs
       JOIN stat_templates st ON st.id = rs.stat_template_id
       WHERE rs.rule_set_id = ?
       ORDER BY rs.display_order ASC`,
      r.id
    );
    out.push({
      id: r.id,
      name: r.name,
      description: r.description,
      active: r.active === 1,
      createdAt: r.created_at,
      stats: stats.map(s => ({
        displayOrder: s.display_order,
        id: s.id,
        name: s.name,
        type: s.type,
        defaultMax: s.default_max,
        color: s.color,
        description: s.description,
        isPrimaryHealth: s.is_primary_health === 1,
      })),
    });
  }
  return c.json({ ruleSets: out });
});

// POST /api/rule-sets — admin only
ruleSetRoutes.post("/", requireAdmin, async (c) => {
  const user = c.get("user") as JwtPayload;
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const name = String(body?.name ?? "").trim();
  const description = body.description ? String(body.description).slice(0, 500) : null;
  if (!name || name.length > 80) return c.json({ error: "Nome é obrigatório (máx 80 chars)." }, 400);
  const statIds: number[] = Array.isArray(body.statIds) ? body.statIds.map((n: number) => Number(n)).filter((n: number) => Number.isInteger(n)) : [];
  const result = await c.env.DB.prepare(
    `INSERT INTO rule_sets (name, description, created_by) VALUES (?, ?, ?)`
  ).bind(name, description, user.sub).run();
  const newId = result.meta.last_row_id as number;
  // Associa stats (com display_order = índice no array)
  for (let i = 0; i < statIds.length; i++) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO rule_set_stats (rule_set_id, stat_template_id, display_order) VALUES (?, ?, ?)`
    ).bind(newId, statIds[i], i).run();
  }
  await audit(c.env.DB, user.sub, "rule_set.create", name, `stats=${statIds.length}`);
  return c.json({ ok: true, id: newId }, 201);
});

// PUT /api/rule-sets/:id — admin only
ruleSetRoutes.put("/:id", requireAdmin, async (c) => {
  const user = c.get("user") as JwtPayload;
  const id = Number(c.req.param("id"));
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const existing = await queryFirst<any>(c.env.DB, `SELECT * FROM rule_sets WHERE id = ?`, id);
  if (!existing) return c.json({ error: "Set de regras não encontrado." }, 404);
  const name = body.name ? String(body.name).trim().slice(0, 80) : existing.name;
  const description = body.description !== undefined ? (body.description ? String(body.description).slice(0, 500) : null) : existing.description;
  await c.env.DB.prepare(
    `UPDATE rule_sets SET name = ?, description = ? WHERE id = ?`
  ).bind(name, description, id).run();
  // Se statIds foi enviado, recria associações
  if (Array.isArray(body.statIds)) {
    await c.env.DB.prepare(`DELETE FROM rule_set_stats WHERE rule_set_id = ?`).bind(id).run();
    const statIds: number[] = body.statIds.map((n: number) => Number(n)).filter((n: number) => Number.isInteger(n));
    for (let i = 0; i < statIds.length; i++) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO rule_set_stats (rule_set_id, stat_template_id, display_order) VALUES (?, ?, ?)`
      ).bind(id, statIds[i], i).run();
    }
  }
  await audit(c.env.DB, user.sub, "rule_set.update", name, `id=${id}`);
  return c.json({ ok: true });
});

// POST /api/rule-sets/:id/deactivate — admin only (soft delete)
ruleSetRoutes.post("/:id/deactivate", requireAdmin, async (c) => {
  const user = c.get("user") as JwtPayload;
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(`UPDATE rule_sets SET active = 0 WHERE id = ?`).bind(id).run();
  await audit(c.env.DB, user.sub, "rule_set.deactivate", String(id), null);
  return c.json({ ok: true });
});

// POST /api/rule-sets/:id/reactivate
ruleSetRoutes.post("/:id/reactivate", requireAdmin, async (c) => {
  const user = c.get("user") as JwtPayload;
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(`UPDATE rule_sets SET active = 1 WHERE id = ?`).bind(id).run();
  await audit(c.env.DB, user.sub, "rule_set.reactivate", String(id), null);
  return c.json({ ok: true });
});
