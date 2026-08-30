// routes/characters.ts — CRUD de characters + character_stats
//
// BUG CORRIGIDO: o PUT /api/characters/:id antes apagava TODOS os stats
// (DELETE FROM character_stats WHERE character_id = ?) e recriava apenas
// os enviados. Stats de rule sets não eram reenviados pelo frontend →
// eram apagados silenciosamente. Agora o PUT faz UPSERT seletivo:
// só atualiza/inclui stats que vieram no payload, preservando os demais.
//
// NOVO: suporte a fórmulas dinâmicas (type='formula' com {Referência}).

import { Hono } from "hono";
import type { Env } from "../env";
import type { JwtPayload } from "../lib/crypto";
import { audit, queryAll, queryFirst, queryRun } from "../lib/db";
import { validateFormula, evaluateFormula, extractReferences } from "../lib/stat-formula";

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

// ---------- GET /api/characters ----------
characterRoutes.get("/", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const scope = c.req.query("scope");
  const userRow = await queryFirst<{ role: string; active: number }>(c.env.DB, `SELECT role, active FROM users WHERE id = ?`, user.sub);
  if (!userRow || userRow.active !== 1) return c.json({ error: "Conta inativa." }, 403);
  const canSeeAll = scope === "all" && userRow.role === "admin";
  const rows = await queryAll<any>(
    c.env.DB,
    `SELECT c.*, u.username AS owner_username
     FROM characters c JOIN users u ON u.id = c.owner_user_id
     ${canSeeAll ? "" : "WHERE c.owner_user_id = ?"}
     ORDER BY c.owner_user_id ASC, c.is_active DESC, c.updated_at DESC`,
    ...(canSeeAll ? [] : [user.sub])
  );
  const out = [];
  for (const r of rows) {
    const stats = await queryAll<any>(
      c.env.DB, `SELECT * FROM character_stats WHERE character_id = ? ORDER BY display_order ASC, id ASC`, r.id
    );
    out.push({
      id: r.id, ownerUserId: r.owner_user_id, ownerUsername: r.owner_username,
      pageId: r.page_id, name: r.name, photoUrl: r.photo_url, symbolUrl: r.symbol_url || null,
      isActive: r.is_active === 1,
      inventory: safeJson(r.inventory_json, []), statusEffects: safeJson(r.status_effects_json, []),
      createdAt: r.created_at, updatedAt: r.updated_at,
      stats: stats.map(mapStat),
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
    `SELECT c.*, u.username AS owner_username FROM characters c JOIN users u ON u.id = c.owner_user_id WHERE c.id = ?`, id
  );
  if (!r) return c.json({ error: "Personagem não encontrado." }, 404);
  const userRow = await queryFirst<{ role: string }>(c.env.DB, `SELECT role FROM users WHERE id = ?`, user.sub);
  if (r.owner_user_id !== user.sub && userRow?.role !== "admin") {
    return c.json({ error: "Você só pode consultar seus próprios personagens." }, 403);
  }
  const stats = await queryAll<any>(c.env.DB, `SELECT * FROM character_stats WHERE character_id = ? ORDER BY display_order ASC, id ASC`, id);
  return c.json({
    id: r.id, ownerUserId: r.owner_user_id, ownerUsername: r.owner_username,
    pageId: r.page_id, name: r.name, photoUrl: r.photo_url, symbolUrl: r.symbol_url || null,
    isActive: r.is_active === 1,
    inventory: safeJson(r.inventory_json, []), statusEffects: safeJson(r.status_effects_json, []),
    createdAt: r.created_at, updatedAt: r.updated_at,
    stats: stats.map(mapStat),
  });
});

// ---------- POST /api/characters ----------
characterRoutes.post("/", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const name = String(body?.name ?? "").trim();
  if (!name || name.length > 100) return c.json({ error: "Nome é obrigatório (máx 100 chars)." }, 400);
  const pageId = body.pageId ? Number(body.pageId) : null;
  const photoUrl = body.photoUrl ? String(body.photoUrl).slice(0, 500) : null;
  const symbolUrl = body.symbolUrl ? String(body.symbolUrl).slice(0, 500) : null;
  const inventory = JSON.stringify((Array.isArray(body.inventory) ? body.inventory : []).slice(0, 100));
  const statsArr = Array.isArray(body.stats) ? body.stats : [];
  const ruleSetIds: number[] = Array.isArray(body.ruleSetIds) ? body.ruleSetIds.map((n: number) => Number(n)).filter((n: number) => Number.isInteger(n)) : [];

  const result = await c.env.DB.prepare(
    `INSERT INTO characters (owner_user_id, page_id, name, photo_url, symbol_url, inventory_json, status_effects_json) VALUES (?, ?, ?, ?, ?, ?, '[]')`
  ).bind(user.sub, pageId, name, photoUrl, symbolUrl, inventory).run();
  const newId = result.meta.last_row_id as number;

  const seenTemplateIds = new Set<number>();
  let order = 0;
  for (const rsId of ruleSetIds) {
    const tplRows = await queryAll<any>(
      c.env.DB,
      `SELECT st.id, st.name, st.type, st.default_max, st.color FROM rule_set_stats rs JOIN stat_templates st ON st.id = rs.stat_template_id WHERE rs.rule_set_id = ? AND st.active = 1 ORDER BY rs.display_order ASC`, rsId
    );
    for (const t of tplRows) {
      if (seenTemplateIds.has(t.id)) continue;
      seenTemplateIds.add(t.id);
      await insertStat(c.env.DB, newId, { statTemplateId: t.id, name: t.name, type: t.type, valueMax: t.default_max ?? 0, valueCurrent: t.default_max ?? 0, color: t.color }, order++, rsId);
    }
    await c.env.DB.prepare(`INSERT OR IGNORE INTO character_rule_sets (character_id, rule_set_id) VALUES (?, ?)`).bind(newId, rsId).run();
  }
  for (const s of statsArr) {
    if (s.statTemplateId && seenTemplateIds.has(Number(s.statTemplateId))) continue;
    await insertStat(c.env.DB, newId, s, order++);
  }
  await replaceInventoryItems(c.env.DB, newId, Array.isArray(body.inventory) ? body.inventory : []);
  await syncLegacyInventory(c.env.DB, newId);
  await audit(c.env.DB, user.sub, "character.create", name, `stats=${statsArr.length}, ruleSets=${ruleSetIds.length}`);
  return c.json({ ok: true, id: newId }, 201);
});

// ---------- PUT /api/characters/:id — CORRIGIDO ----------
// NÃO apaga stats que não foram enviados. Faz UPSERT seletivo.
characterRoutes.put("/:id", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const own = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!own) return c.json({ error: "Personagem não encontrado." }, 404);
  const userRow = await queryFirst<{ role: string }>(c.env.DB, `SELECT role FROM users WHERE id = ?`, user.sub);
  const isMaster = userRow?.role === "admin";
  if (own.owner !== user.sub && !isMaster) return c.json({ error: "Você só pode editar seus próprios personagens." }, 403);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }

  // Atualiza campos do personagem (name, photo, inventory)
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (typeof body.name === "string" && body.name.trim()) { fields.push("name = ?"); values.push(body.name.trim().slice(0, 100)); }
  if (body.pageId !== undefined) { fields.push("page_id = ?"); values.push(body.pageId ? Number(body.pageId) : null); }
  if (typeof body.photoUrl !== "undefined") { fields.push("photo_url = ?"); values.push(body.photoUrl ? String(body.photoUrl).slice(0, 500) : null); }
  if (typeof body.symbolUrl !== "undefined") { fields.push("symbol_url = ?"); values.push(body.symbolUrl ? String(body.symbolUrl).slice(0, 500) : null); }
  if (Array.isArray(body.inventory)) { fields.push("inventory_json = ?"); values.push(JSON.stringify(body.inventory.slice(0, 100))); }
  if (fields.length > 0) {
    fields.push("updated_at = datetime('now')");
    values.push(id);
    await c.env.DB.prepare(`UPDATE characters SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  }
  if (Array.isArray(body.inventory)) {
    await replaceInventoryItems(c.env.DB, id, body.inventory);
    await syncLegacyInventory(c.env.DB, id);
  }

  // ===== CORREÇÃO DO BUG =====
  // Se body.stats foi enviado, faz UPSERT (não DELETE + INSERT).
  // Stats que NÃO estão no payload são preservados.
  if (Array.isArray(body.stats)) {
    for (const s of body.stats) {
      // Se o stat tem ID, é uma atualização de um stat existente
      if (s.id) {
        await updateExistingStat(c.env.DB, Number(s.id), id, s);
      } else {
        // Stat novo (avulso ou customizado) — insere
        await insertStat(c.env.DB, id, s, s.displayOrder ?? 99);
      }
    }
  }

  await audit(c.env.DB, user.sub, "character.update", String(id), null);
  return c.json({ ok: true });
});

// ---------- POST /api/characters/:id/activate ----------
characterRoutes.post("/:id/activate", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const own = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!own) return c.json({ error: "Personagem não encontrado." }, 404);
  if (own.owner !== user.sub) return c.json({ error: "Sem permissão." }, 403);
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
  if (own.owner !== user.sub) return c.json({ error: "Sem permissão." }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM character_stats WHERE character_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM character_rule_sets WHERE character_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM characters WHERE id = ?`).bind(id),
  ]);
  await audit(c.env.DB, user.sub, "character.delete", String(id), null);
  return c.json({ ok: true });
});

// ---------- PATCH /api/characters/:id/stat/:statId ----------
characterRoutes.patch("/:id/stat/:statId", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const statId = Number(c.req.param("statId"));
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }

  const ch = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!ch) return c.json({ error: "Personagem não encontrado." }, 404);
  const userRow = await queryFirst<{ role: string }>(c.env.DB, `SELECT role FROM users WHERE id = ?`, user.sub);
  const isMaster = userRow && userRow.role === "admin";
  if (!isMaster && ch.owner !== user.sub) return c.json({ error: "Sem permissão." }, 403);

  const stat = await queryFirst<any>(c.env.DB, `SELECT * FROM character_stats WHERE id = ? AND character_id = ?`, statId, id);
  if (!stat) return c.json({ error: "Status não encontrado." }, 404);

  // Stats do tipo formula são calculados — não podem ser editados diretamente
  if (stat.type === "formula") {
    return c.json({ error: "Status calculado por fórmula não pode ser editado diretamente. Edite a fórmula ou os stats base." }, 403);
  }

  await updateExistingStat(c.env.DB, statId, id, body);

  // Recalcula fórmulas dependentes
  const updatedStats = await recalculateFormulas(c.env.DB, id);
  return c.json({ ok: true, updatedStats });
});

// ---------- DELETE /api/characters/:id/stats/:statId ----------
// Remove um stat da ficha do personagem (mestre only, ou dono se stat custom).
characterRoutes.delete("/:id/stats/:statId", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const statId = Number(c.req.param("statId"));

  const ch = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!ch) return c.json({ error: "Personagem não encontrado." }, 404);
  const userRow = await queryFirst<{ role: string }>(c.env.DB, `SELECT role FROM users WHERE id = ?`, user.sub);
  const isMaster = userRow && userRow.role === "admin";

  const stat = await queryFirst<any>(c.env.DB, `SELECT * FROM character_stats WHERE id = ? AND character_id = ?`, statId, id);
  if (!stat) return c.json({ error: "Status não encontrado." }, 404);

  // Permissão: mestre sempre; dono só se for customizado (criado por ele)
  if (!isMaster && !(ch.owner === user.sub && stat.is_custom === 1)) {
    return c.json({ error: "Sem permissão para remover este status." }, 403);
  }

  await c.env.DB.prepare(`DELETE FROM character_stats WHERE id = ? AND character_id = ?`).bind(statId, id).run();
  await audit(c.env.DB, user.sub, "character.stat.delete", `char=${id} stat=${statId} name=${stat.name}`, null);
  return c.json({ ok: true });
});

// ---------- PATCH /api/characters/:id/stats/:statId/permission ----------
// Mestre alterna permissão de edição pelo jogador (player_editable).
characterRoutes.patch("/:id/stats/:statId/permission", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const statId = Number(c.req.param("statId"));

  const userRow = await queryFirst<{ role: string }>(c.env.DB, `SELECT role FROM users WHERE id = ?`, user.sub);
  if (!userRow || userRow.role !== "admin") {
    return c.json({ error: "Apenas o mestre pode alterar permissões de status." }, 403);
  }

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const playerEditable = body?.playerEditable ? 1 : 0;

  await c.env.DB.prepare(
    `UPDATE character_stats SET player_editable = ?, updated_at = datetime('now') WHERE id = ? AND character_id = ?`
  ).bind(playerEditable, statId, id).run();
  await audit(c.env.DB, user.sub, "character.stat.permission", `char=${id} stat=${statId} editable=${playerEditable}`, null);
  return c.json({ ok: true, playerEditable: playerEditable === 1 });
});

// ---------- GET /api/characters/:id/inventory ----------
// Lista itens do inventário (tabela nova character_inventory_items).
characterRoutes.get("/:id/inventory", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const ch = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!ch) return c.json({ error: "Personagem não encontrado." }, 404);
  const userRow = await queryFirst<{ role: string }>(c.env.DB, `SELECT role FROM users WHERE id = ?`, user.sub);
  if (ch.owner !== user.sub && userRow?.role !== "admin") return c.json({ error: "Sem permissão." }, 403);
  let items = await queryAll<any>(
    c.env.DB,
    `SELECT id, name, qty, description, equipped, icon_url, sort_order FROM character_inventory_items WHERE character_id = ? ORDER BY sort_order ASC, id ASC`,
    id
  );
  // Migra automaticamente personagens antigos que ainda só possuem JSON.
  if (items.length === 0) {
    const legacy = await queryFirst<{ inventory_json: string | null }>(c.env.DB, `SELECT inventory_json FROM characters WHERE id = ?`, id);
    const parsed = safeJson(legacy?.inventory_json ?? null, []);
    if (Array.isArray(parsed) && parsed.length > 0) {
      await replaceInventoryItems(c.env.DB, id, parsed);
      items = await queryAll<any>(c.env.DB, `SELECT id, name, qty, description, equipped, icon_url, sort_order FROM character_inventory_items WHERE character_id = ? ORDER BY sort_order ASC, id ASC`, id);
    }
  }
  return c.json({
    items: items.map(it => ({
      id: it.id, name: it.name, qty: it.qty, description: it.description,
      equipped: it.equipped === 1, iconUrl: it.icon_url, sortOrder: it.sort_order,
    })),
  });
});

// ---------- POST /api/characters/:id/inventory ----------
// Adiciona um item ao inventário (dono ou mestre).
characterRoutes.post("/:id/inventory", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const ch = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!ch) return c.json({ error: "Personagem não encontrado." }, 404);
  const userRow = await queryFirst<{ role: string }>(c.env.DB, `SELECT role FROM users WHERE id = ?`, user.sub);
  const isMaster = userRow && userRow.role === "admin";
  if (!isMaster && ch.owner !== user.sub) return c.json({ error: "Sem permissão." }, 403);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const name = String(body?.name ?? "").trim();
  if (!name) return c.json({ error: "Nome do item é obrigatório." }, 400);
  const qty = Math.max(0, Math.min(9999, Number(body?.qty ?? 1) || 1));
  const description = body.description ? String(body.description).slice(0, 200) : null;
  const equipped = body.equipped ? 1 : 0;
  const iconUrl = body.iconUrl ? String(body.iconUrl).slice(0, 500) : null;

  // sort_order = max + 1
  const maxOrder = await queryFirst<{ m: number }>(c.env.DB, `SELECT COALESCE(MAX(sort_order), -1) AS m FROM character_inventory_items WHERE character_id = ?`, id);
  const sortOrder = (maxOrder?.m ?? -1) + 1;

  const res = await c.env.DB.prepare(
    `INSERT INTO character_inventory_items (character_id, name, qty, description, equipped, icon_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, name.slice(0, 80), qty, description, equipped, iconUrl, sortOrder).run();
  const newId = res.meta.last_row_id as number;
  await syncLegacyInventory(c.env.DB, id);
  await audit(c.env.DB, user.sub, "character.inventory.add", `char=${id} item=${name}`, null);
  return c.json({ ok: true, id: newId }, 201);
});

// ---------- PUT /api/characters/:id/inventory/:itemId ----------
characterRoutes.put("/:id/inventory/:itemId", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const itemId = Number(c.req.param("itemId"));
  const ch = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!ch) return c.json({ error: "Personagem não encontrado." }, 404);
  const userRow = await queryFirst<{ role: string }>(c.env.DB, `SELECT role FROM users WHERE id = ?`, user.sub);
  const isMaster = userRow && userRow.role === "admin";
  if (!isMaster && ch.owner !== user.sub) return c.json({ error: "Sem permissão." }, 403);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  if (typeof body.name === "string" && body.name.trim()) { fields.push("name = ?"); vals.push(body.name.trim().slice(0, 80)); }
  if (body.qty !== undefined) { fields.push("qty = ?"); vals.push(Math.max(0, Math.min(9999, Number(body.qty) || 0))); }
  if (body.description !== undefined) { fields.push("description = ?"); vals.push(body.description ? String(body.description).slice(0, 200) : null); }
  if (body.equipped !== undefined) { fields.push("equipped = ?"); vals.push(body.equipped ? 1 : 0); }
  if (body.iconUrl !== undefined) { fields.push("icon_url = ?"); vals.push(body.iconUrl ? String(body.iconUrl).slice(0, 500) : null); }
  if (fields.length === 0) return c.json({ error: "Nada para atualizar." }, 400);
  fields.push("updated_at = datetime('now')");
  vals.push(itemId, id);
  await c.env.DB.prepare(`UPDATE character_inventory_items SET ${fields.join(", ")} WHERE id = ? AND character_id = ?`).bind(...vals).run();
  await syncLegacyInventory(c.env.DB, id);
  await audit(c.env.DB, user.sub, "character.inventory.update", `char=${id} item=${itemId}`, null);
  return c.json({ ok: true });
});

// ---------- DELETE /api/characters/:id/inventory/:itemId ----------
characterRoutes.delete("/:id/inventory/:itemId", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const itemId = Number(c.req.param("itemId"));
  const ch = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!ch) return c.json({ error: "Personagem não encontrado." }, 404);
  const userRow = await queryFirst<{ role: string }>(c.env.DB, `SELECT role FROM users WHERE id = ?`, user.sub);
  const isMaster = userRow && userRow.role === "admin";
  if (!isMaster && ch.owner !== user.sub) return c.json({ error: "Sem permissão." }, 403);
  await c.env.DB.prepare(`DELETE FROM character_inventory_items WHERE id = ? AND character_id = ?`).bind(itemId, id).run();
  await syncLegacyInventory(c.env.DB, id);
  await audit(c.env.DB, user.sub, "character.inventory.delete", `char=${id} item=${itemId}`, null);
  return c.json({ ok: true });
});

async function syncLegacyInventory(db: D1Database, characterId: number): Promise<void> {
  const items = await queryAll<any>(db, `SELECT name, qty, description, equipped, icon_url AS iconUrl, sort_order AS sortOrder FROM character_inventory_items WHERE character_id = ? ORDER BY sort_order ASC, id ASC`, characterId);
  await db.prepare(`UPDATE characters SET inventory_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(JSON.stringify(items), characterId).run();
}

async function replaceInventoryItems(db: D1Database, characterId: number, rawItems: any[]): Promise<void> {
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .filter(it => it && typeof it.name === "string" && it.name.trim())
    .slice(0, 100)
    .map((it, index) => ({
      name: String(it.name).trim().slice(0, 80),
      qty: Math.max(0, Math.min(9999, Number(it.qty) || 0)),
      description: it.description ? String(it.description).slice(0, 200) : null,
      equipped: it.equipped ? 1 : 0,
      iconUrl: it.iconUrl ? String(it.iconUrl).slice(0, 500) : null,
      sortOrder: Number.isFinite(Number(it.sortOrder)) ? Number(it.sortOrder) : index,
    }));
  const statements = [db.prepare(`DELETE FROM character_inventory_items WHERE character_id = ?`).bind(characterId)];
  for (const it of items) {
    statements.push(db.prepare(`INSERT INTO character_inventory_items (character_id, name, qty, description, equipped, icon_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(characterId, it.name, it.qty, it.description, it.equipped, it.iconUrl, it.sortOrder));
  }
  for (let i = 0; i < statements.length; i += 90) {
    await db.batch(statements.slice(i, i + 90));
  }
}

// ---------- helpers ----------
function mapStat(s: any) {
  return {
    id: s.id, statTemplateId: s.stat_template_id, isCustom: s.is_custom === 1,
    name: s.name, type: s.type,
    valueCurrent: s.value_current, valueMax: s.value_max,
    valueText: s.value_text, valueBool: s.value_bool,
    color: s.color, displayOrder: s.display_order,
    addedViaRuleSetId: s.added_via_rule_set_id ?? null,
    playerEditable: s.player_editable === 1,
  };
}

async function insertStat(db: D1Database, characterId: number, s: any, order: number, ruleSetId: number | null = null) {
  const name = String(s?.name ?? "").trim();
  const type = String(s?.type ?? "").trim();
  if (!name || !VALID_TYPES.has(type)) return;
  const statTemplateId = s.statTemplateId ? Number(s.statTemplateId) : null;
  const isCustom = statTemplateId ? 0 : 1;
  const color = s.color && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : null;
  // Stats customizados (sem template) nascem editáveis pelo jogador.
  // Stats de template seguem o default do banco (player_editable=0).
  const playerEditable = isCustom === 1 ? 1 : (s.playerEditable ? 1 : 0);
  let valueCurrent: number | null = null, valueMax: number | null = null;
  let valueText: string | null = null, valueBool: number | null = null;
  if (type === "bar") { valueMax = clampNum(s.valueMax ?? 0, 0, 1e9); valueCurrent = clampNum(s.valueCurrent ?? valueMax, 0, 1e9); }
  else if (type === "number") { valueCurrent = clampNum(s.valueCurrent ?? 0, -1e9, 1e9); }
  else if (type === "text" || type === "tag_list" || type === "formula") { valueText = s.valueText ? String(s.valueText).slice(0, 2000) : (type === "tag_list" ? "[]" : ""); }
  else if (type === "checkbox") { valueBool = s.valueBool ? 1 : 0; }
  await db.prepare(
    `INSERT INTO character_stats (character_id, stat_template_id, is_custom, name, type, value_current, value_max, value_text, value_bool, color, display_order, added_via_rule_set_id, player_editable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(characterId, statTemplateId, isCustom, name.slice(0, 50), type, valueCurrent, valueMax, valueText, valueBool, color, order, ruleSetId, playerEditable).run();
}

// UPSERT: atualiza um stat existente preservando o que não foi enviado
async function updateExistingStat(db: D1Database, statId: number, characterId: number, s: any) {
  const stat = await queryFirst<any>(db, `SELECT * FROM character_stats WHERE id = ? AND character_id = ?`, statId, characterId);
  if (!stat) return;

  const updates: string[] = [];
  const vals: (string | number | null)[] = [];

  if (s.name !== undefined) { updates.push("name = ?"); vals.push(String(s.name).slice(0, 50)); }
  if (s.type !== undefined && VALID_TYPES.has(s.type)) { updates.push("type = ?"); vals.push(s.type); }
  if (s.valueCurrent !== undefined && (stat.type === "bar" || stat.type === "number" || s.type === "bar" || s.type === "number")) {
    const v = clampNum(s.valueCurrent, -1e9, 1e9);
    if (v !== null) { updates.push("value_current = ?"); vals.push(v); }
  }
  if (s.valueMax !== undefined && (stat.type === "bar" || s.type === "bar")) {
    const v = clampNum(s.valueMax, 0, 1e9);
    if (v !== null) { updates.push("value_max = ?"); vals.push(v); }
  }
  if (s.valueText !== undefined && (stat.type === "text" || stat.type === "tag_list" || stat.type === "formula" || s.type === "text" || s.type === "tag_list" || s.type === "formula")) {
    updates.push("value_text = ?"); vals.push(String(s.valueText).slice(0, 2000));
  }
  if (s.valueBool !== undefined && (stat.type === "checkbox" || s.type === "checkbox")) {
    updates.push("value_bool = ?"); vals.push(s.valueBool ? 1 : 0);
  }
  if (s.color !== undefined) {
    updates.push("color = ?"); vals.push(s.color && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : null);
  }

  // Bar: value_current não pode passar de value_max
  if (stat.type === "bar" || s.type === "bar") {
    const newMax = s.valueMax !== undefined ? Number(s.valueMax) : stat.value_max;
    const newCur = s.valueCurrent !== undefined ? Number(s.valueCurrent) : stat.value_current;
    if (newMax > 0 && newCur > newMax) {
      // já foi adicionado acima, mas precisamos corrigir
      // remove o value_current adicionado e adiciona corrigido
      const idx = updates.indexOf("value_current = ?");
      if (idx >= 0) { vals[idx] = newMax; }
    }
  }

  if (updates.length === 0) return;
  updates.push("updated_at = datetime('now')");
  vals.push(statId);
  await db.prepare(`UPDATE character_stats SET ${updates.join(", ")} WHERE id = ?`).bind(...vals).run();
}

// Recalcula todos os stats do tipo formula do personagem
async function recalculateFormulas(db: D1Database, characterId: number): Promise<any[]> {
  const allStats = await queryAll<any>(db, `SELECT * FROM character_stats WHERE character_id = ? ORDER BY display_order ASC, id ASC`, characterId);

  // Constrói mapa nome -> valor numérico (para referências em fórmulas)
  const statValues: Record<string, number> = {};
  for (const s of allStats) {
    if (s.type === "bar" || s.type === "number") {
      statValues[s.name] = Number(s.value_current ?? 0);
    }
  }

  // Coleta todas as fórmulas
  const formulaStats = allStats.filter(s => s.type === "formula" && s.value_text);

  // Detecta dependências circulares
  const formulasByStatName: Record<string, string> = {};
  formulaStats.forEach(s => { formulasByStatName[s.name] = s.value_text; });
  // (detecção de ciclo seria aqui, mas pra simplicidade, tentamos avaliar em ordem)

  const updated: any[] = [];
  for (const fs of formulaStats) {
    try {
      const result = evaluateFormula(fs.value_text, statValues);
      // Atualiza value_current com o resultado calculado
      await db.prepare(`UPDATE character_stats SET value_current = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(result, fs.id).run();
      statValues[fs.name] = result; // fórmulas podem referenciar outras fórmulas
      updated.push({ id: fs.id, name: fs.name, valueCurrent: result });
    } catch (e) {
      // Se a fórmula falhar (ex: referência inválida), mantém o valor anterior
      console.error(`Formula eval failed for stat ${fs.name}:`, e);
    }
  }
  return updated;
}
