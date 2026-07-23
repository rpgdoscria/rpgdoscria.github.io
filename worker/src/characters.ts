// routes/characters.ts — CRUD de characters + character_stats
//
// Refatoração do que estava em rooms.ts. Agora:
//  - characters têm photo_url, is_active
//  - stats são flexíveis (stat_templates + character_stats)
//  - migratei endpoints pra /api/characters (mais limpo que /api/rooms/characters)

import { Hono } from "hono";
import type { Env } from "../env";
import type { JwtPayload } from "../lib/crypto";
import { audit, queryAll, queryFirst, queryRun } from "../lib/db";

export const characterRoutes = new Hono<{ Bindings: Env; Variables: { user?: JwtPayload } }>();

const VALID_TYPES = new Set(["bar", "number", "text", "tag_list", "checkbox", "formula"]);

function safeJson(s: string | null, fallback: any): any {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function clampNum(v: any, min: number, max: number): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

// ---------- GET /api/characters — lista do usuário ----------
characterRoutes.get("/", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const rows = await queryAll<any>(
    c.env.DB,
    `SELECT c.*, u.username AS owner_username
     FROM characters c JOIN users u ON u.id = c.owner_user_id
     WHERE c.owner_user_id = ?
     ORDER BY c.is_active DESC, c.updated_at DESC`,
    user.sub
  );
  // Carrega stats de cada personagem
  const out = [];
  for (const r of rows) {
    const stats = await queryAll<any>(
      c.env.DB,
      `SELECT * FROM character_stats WHERE character_id = ? ORDER BY display_order ASC, id ASC`,
      r.id
    );
    out.push({
      id: r.id,
      ownerUserId: r.owner_user_id,
      ownerUsername: r.owner_username,
      pageId: r.page_id,
      name: r.name,
      photoUrl: r.photo_url,
      isActive: r.is_active === 1,
      inventory: safeJson(r.inventory_json, []),
      statusEffects: safeJson(r.status_effects_json, []),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      stats: stats.map(s => ({
        id: s.id,
        statTemplateId: s.stat_template_id,
        isCustom: s.is_custom === 1,
        name: s.name,
        type: s.type,
        valueCurrent: s.value_current,
        valueMax: s.value_max,
        valueText: s.value_text,
        valueBool: s.value_bool,
        color: s.color,
        displayOrder: s.display_order,
      })),
    });
  }
  return c.json({ characters: out });
});

// ---------- GET /api/characters/:id ----------
characterRoutes.get("/:id", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const r = await queryFirst<any>(
    c.env.DB,
    `SELECT c.*, u.username AS owner_username
     FROM characters c JOIN users u ON u.id = c.owner_user_id
     WHERE c.id = ?`,
    id
  );
  if (!r) return c.json({ error: "Personagem não encontrado." }, 404);
  const stats = await queryAll<any>(
    c.env.DB,
    `SELECT * FROM character_stats WHERE character_id = ? ORDER BY display_order ASC, id ASC`,
    id
  );
  return c.json({
    id: r.id,
    ownerUserId: r.owner_user_id,
    ownerUsername: r.owner_username,
    pageId: r.page_id,
    name: r.name,
    photoUrl: r.photo_url,
    isActive: r.is_active === 1,
    inventory: safeJson(r.inventory_json, []),
    statusEffects: safeJson(r.status_effects_json, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    stats: stats.map(s => ({
      id: s.id,
      statTemplateId: s.stat_template_id,
      isCustom: s.is_custom === 1,
      name: s.name,
      type: s.type,
      valueCurrent: s.value_current,
      valueMax: s.value_max,
      valueText: s.value_text,
      valueBool: s.value_bool,
      color: s.color,
      displayOrder: s.display_order,
    })),
  });
});

// ---------- POST /api/characters — cria com stats + rule sets ----------
characterRoutes.post("/", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const name = String(body?.name ?? "").trim();
  if (!name || name.length > 100) return c.json({ error: "Nome é obrigatório (máx 100 chars)." }, 400);
  const pageId = body.pageId ? Number(body.pageId) : null;
  const photoUrl = body.photoUrl ? String(body.photoUrl).slice(0, 500) : null;
  const inventory = JSON.stringify((Array.isArray(body.inventory) ? body.inventory : []).slice(0, 100));
  const statsArr = Array.isArray(body.stats) ? body.stats : [];
  const ruleSetIds: number[] = Array.isArray(body.ruleSetIds) ? body.ruleSetIds.map((n: number) => Number(n)).filter((n: number) => Number.isInteger(n)) : [];

  // Cria o character
  const result = await c.env.DB.prepare(
    `INSERT INTO characters (owner_user_id, page_id, name, photo_url, inventory_json, status_effects_json)
     VALUES (?, ?, ?, ?, ?, '[]')`
  ).bind(user.sub, pageId, name, photoUrl, inventory).run();
  const newId = result.meta.last_row_id as number;

  // Aplica stats dos rule sets escolhidos — coleta stat_template_id de cada set
  // e insere como character_stats (sem duplicar o mesmo template entre sets).
  const seenTemplateIds = new Set<number>();
  let order = 0;
  for (const rsId of ruleSetIds) {
    const tplRows = await queryAll<{ id: number; name: string; type: string; default_max: number | null; color: string | null; is_primary_health: number }>(
      c.env.DB,
      `SELECT st.id, st.name, st.type, st.default_max, st.color, st.is_primary_health
       FROM rule_set_stats rs
       JOIN stat_templates st ON st.id = rs.stat_template_id
       WHERE rs.rule_set_id = ? AND st.active = 1
       ORDER BY rs.display_order ASC`,
      rsId
    );
    for (const t of tplRows) {
      if (seenTemplateIds.has(t.id)) continue; // evita duplicar entre sets
      seenTemplateIds.add(t.id);
      await insertStat(c.env.DB, newId, {
        statTemplateId: t.id,
        name: t.name,
        type: t.type,
        valueMax: t.default_max ?? 0,
        valueCurrent: t.default_max ?? 0,
        color: t.color,
      }, order++, rsId);
    }
    // Associa character ↔ rule_set
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO character_rule_sets (character_id, rule_set_id) VALUES (?, ?)`
    ).bind(newId, rsId).run();
  }

  // Cria stats avulsos (fora de rule sets) enviados pelo cliente
  for (const s of statsArr) {
    // Pula se já veio de um rule set (mesmo statTemplateId)
    if (s.statTemplateId && seenTemplateIds.has(Number(s.statTemplateId))) continue;
    await insertStat(c.env.DB, newId, s, order++);
  }

  await audit(c.env.DB, user.sub, "character.create", name, `stats=${statsArr.length}, ruleSets=${ruleSetIds.length}`);
  return c.json({ ok: true, id: newId }, 201);
});

// ---------- PUT /api/characters/:id — atualiza (dono only) ----------
characterRoutes.put("/:id", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const own = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!own) return c.json({ error: "Personagem não encontrado." }, 404);
  if (own.owner !== user.sub) return c.json({ error: "Você só pode editar seus próprios personagens." }, 403);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (typeof body.name === "string" && body.name.trim()) { fields.push("name = ?"); values.push(body.name.trim().slice(0, 100)); }
  if (body.pageId !== undefined) { fields.push("page_id = ?"); values.push(body.pageId ? Number(body.pageId) : null); }
  if (typeof body.photoUrl !== "undefined") { fields.push("photo_url = ?"); values.push(body.photoUrl ? String(body.photoUrl).slice(0, 500) : null); }
  if (Array.isArray(body.inventory)) { fields.push("inventory_json = ?"); values.push(JSON.stringify(body.inventory.slice(0, 100))); }
  if (fields.length > 0) {
    fields.push("updated_at = datetime('now')");
    values.push(id);
    await c.env.DB.prepare(`UPDATE characters SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  }

  // Substitui stats integralmente se body.stats foi enviado
  if (Array.isArray(body.stats)) {
    await c.env.DB.prepare(`DELETE FROM character_stats WHERE character_id = ?`).bind(id).run();
    let order = 0;
    for (const s of body.stats) {
      await insertStat(c.env.DB, id, s, order++);
    }
  }

  await audit(c.env.DB, user.sub, "character.update", String(id), null);
  return c.json({ ok: true });
});

// ---------- POST /api/characters/:id/activate — marca como ativo ----------
characterRoutes.post("/:id/activate", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const own = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!own) return c.json({ error: "Personagem não encontrado." }, 404);
  if (own.owner !== user.sub) return c.json({ error: "Você só pode ativar seus próprios personagens." }, 403);
  // Desativa todos os outros do mesmo user
  await c.env.DB.prepare(`UPDATE characters SET is_active = 0 WHERE owner_user_id = ?`).bind(user.sub).run();
  await c.env.DB.prepare(`UPDATE characters SET is_active = 1 WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

// ---------- DELETE /api/characters/:id ----------
characterRoutes.delete("/:id", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const own = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!own) return c.json({ error: "Personagem não encontrado." }, 404);
  if (own.owner !== user.sub) return c.json({ error: "Você só pode apagar seus próprios personagens." }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM character_stats WHERE character_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM characters WHERE id = ?`).bind(id),
  ]);
  await audit(c.env.DB, user.sub, "character.delete", String(id), null);
  return c.json({ ok: true });
});

// ---------- PATCH /api/characters/:id/stat/:statId — atualiza um stat ----------
// Usado pela sala em tempo real (via REST fallback) e por edição inline na ficha.
characterRoutes.patch("/:id/stat/:statId", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const statId = Number(c.req.param("statId"));
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }

  const ch = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!ch) return c.json({ error: "Personagem não encontrado." }, 404);

  // Admin (mestre) pode editar qualquer um; jogador só o próprio.
  // Desde a migration 0005, mestre === admin (não há mais is_game_master).
  const userRow = await queryFirst<{ role: string }>(
    c.env.DB, `SELECT role FROM users WHERE id = ?`, user.sub
  );
  const isMaster = userRow && userRow.role === "admin";
  if (!isMaster && ch.owner !== user.sub) {
    return c.json({ error: "Sem permissão." }, 403);
  }

  const stat = await queryFirst<any>(c.env.DB, `SELECT * FROM character_stats WHERE id = ? AND character_id = ?`, statId, id);
  if (!stat) return c.json({ error: "Status não encontrado." }, 404);

  // Atualiza campos conforme tipo
  const updates: string[] = [];
  const vals: (string | number | null)[] = [];
  if (body.valueCurrent !== undefined && (stat.type === "bar" || stat.type === "number")) {
    const v = clampNum(body.valueCurrent, -1e9, 1e9);
    if (v === null) return c.json({ error: "valueCurrent inválido." }, 400);
    // Bar: não pode passar de valueMax
    if (stat.type === "bar" && stat.value_max !== null && v > stat.value_max) {
      updates.push("value_current = ?"); vals.push(stat.value_max);
    } else if (stat.type === "bar" && stat.value_max !== null && v < 0) {
      updates.push("value_current = ?"); vals.push(0);
    } else {
      updates.push("value_current = ?"); vals.push(v);
    }
  }
  if (body.valueMax !== undefined && stat.type === "bar") {
    const v = clampNum(body.valueMax, 0, 1e9);
    if (v === null) return c.json({ error: "valueMax inválido." }, 400);
    updates.push("value_max = ?"); vals.push(v);
  }
  if (body.valueText !== undefined && (stat.type === "text" || stat.type === "tag_list" || stat.type === "formula")) {
    updates.push("value_text = ?"); vals.push(String(body.valueText).slice(0, 2000));
  }
  if (body.valueBool !== undefined && stat.type === "checkbox") {
    updates.push("value_bool = ?"); vals.push(body.valueBool ? 1 : 0);
  }
  if (updates.length === 0) return c.json({ ok: true, noChange: true });
  updates.push("updated_at = datetime('now')");
  vals.push(statId);
  await c.env.DB.prepare(`UPDATE character_stats SET ${updates.join(", ")} WHERE id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

// ---------- helper: insere um stat ----------
async function insertStat(db: D1Database, characterId: number, s: any, order: number, ruleSetId: number | null = null) {
  const name = String(s?.name ?? "").trim();
  const type = String(s?.type ?? "").trim();
  if (!name || !VALID_TYPES.has(type)) return; // pula inválido silenciosamente
  const statTemplateId = s.statTemplateId ? Number(s.statTemplateId) : null;
  const isCustom = statTemplateId ? 0 : 1;
  const color = s.color && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : null;
  let valueCurrent: number | null = null;
  let valueMax: number | null = null;
  let valueText: string | null = null;
  let valueBool: number | null = null;
  if (type === "bar") {
    valueMax = clampNum(s.valueMax ?? 0, 0, 1e9);
    valueCurrent = clampNum(s.valueCurrent ?? valueMax, 0, 1e9);
  } else if (type === "number") {
    valueCurrent = clampNum(s.valueCurrent ?? 0, -1e9, 1e9);
  } else if (type === "text" || type === "tag_list" || type === "formula") {
    valueText = s.valueText ? String(s.valueText).slice(0, 2000) : (type === "tag_list" ? "[]" : "");
  } else if (type === "checkbox") {
    valueBool = s.valueBool ? 1 : 0;
  }
  await db.prepare(
    `INSERT INTO character_stats (character_id, stat_template_id, is_custom, name, type, value_current, value_max, value_text, value_bool, color, display_order, added_via_rule_set_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(characterId, statTemplateId, isCustom, name.slice(0, 50), type, valueCurrent, valueMax, valueText, valueBool, color, order, ruleSetId).run();
}
