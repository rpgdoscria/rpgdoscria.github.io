// routes/ai-context.ts — contexto READ ONLY para agentes de IA autorizados.
// O segredo chega apenas pelo header X-Wiki-Context-Key e nunca é aceito na URL.

import { Hono } from "hono";
import type { Env } from "../env";
import { queryAll } from "../lib/db";

export const aiContextRoutes = new Hono<{ Bindings: Env }>();

function constantTimeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = aa.length ^ bb.length;
  const size = Math.max(aa.length, bb.length);
  for (let i = 0; i < size; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function requireContextKey(c: any): Response | null {
  const configured = c.env.AI_CONTEXT_KEY;
  const provided = c.req.header("X-Wiki-Context-Key") || "";
  if (!configured) return c.json({ error: "Endpoint de contexto não configurado." }, 503);
  if (!provided || !constantTimeEqual(provided, configured)) return c.json({ error: "Chave de contexto inválida." }, 401);
  return null;
}

aiContextRoutes.get("/context", async (c) => {
  const denied = requireContextKey(c);
  if (denied) return denied;

  const [pages, chronicles, templates, ruleSets, characters, rooms] = await Promise.all([
    queryAll<any>(c.env.DB, `SELECT p.id, p.slug, p.title, p.category, p.content_md, p.created_by, p.created_at, p.updated_at, u.username AS author, p.secret, p.revealed FROM pages p JOIN users u ON u.id = p.created_by ORDER BY p.category COLLATE NOCASE, p.title COLLATE NOCASE`),
    queryAll<any>(c.env.DB, `SELECT cr.id, cr.character_id, c.name AS character_name, cr.title, cr.slug, cr.excerpt, cr.content_md, cr.cover_image_url, cr.created_at, cr.updated_at, u.username AS created_by_username FROM chronicles cr JOIN characters c ON c.id = cr.character_id JOIN users u ON u.id = cr.created_by ORDER BY cr.updated_at DESC, cr.id DESC`),
    queryAll<any>(c.env.DB, `SELECT id, name, type, default_max, color, description, active, is_primary_health FROM stat_templates ORDER BY active DESC, name COLLATE NOCASE`),
    queryAll<any>(c.env.DB, `SELECT id, name, description, active, created_at FROM rule_sets ORDER BY active DESC, name COLLATE NOCASE`),
    queryAll<any>(c.env.DB, `SELECT c.id, c.owner_user_id, u.username AS owner_username, c.page_id, c.name, c.photo_url, c.symbol_url, c.inventory_json, c.status_effects_json, c.is_active, c.created_at, c.updated_at FROM characters c JOIN users u ON u.id = c.owner_user_id ORDER BY c.name COLLATE NOCASE`),
    queryAll<any>(c.env.DB, `SELECT code, name, master_user_id, is_active, created_at, ended_at, last_activity FROM rooms ORDER BY created_at DESC LIMIT 100`),
  ]);

  const characterIds = characters.map(c => Number(c.id));
  const statRows = characterIds.length
    ? await queryAll<any>(c.env.DB, `SELECT character_id, id, stat_template_id, is_custom, name, type, value_current, value_max, value_text, value_bool, color, display_order, player_editable FROM character_stats WHERE character_id IN (${characterIds.map(() => "?").join(",")}) ORDER BY character_id, display_order, id`, ...characterIds)
    : [];
  const statsByCharacter: Record<string, any[]> = {};
  for (const row of statRows) (statsByCharacter[row.character_id] ||= []).push(row);
  const ruleSetIds = ruleSets.map(r => Number(r.id));
  const ruleSetStats = ruleSetIds.length
    ? await queryAll<any>(c.env.DB, `SELECT rs.rule_set_id, rs.display_order, st.id, st.name, st.type, st.default_max, st.color, st.description FROM rule_set_stats rs JOIN stat_templates st ON st.id = rs.stat_template_id WHERE rs.rule_set_id IN (${ruleSetIds.map(() => "?").join(",")}) ORDER BY rs.rule_set_id, rs.display_order`, ...ruleSetIds)
    : [];
  const ruleStatsBySet: Record<string, any[]> = {};
  for (const row of ruleSetStats) (ruleStatsBySet[row.rule_set_id] ||= []).push(row);

  const snapshotRows = await queryAll<any>(c.env.DB, `SELECT rs.room_code, rs.state_json, rs.created_at FROM room_snapshots rs JOIN (SELECT room_code, MAX(id) AS max_id FROM room_snapshots GROUP BY room_code) latest ON latest.max_id = rs.id`);
  const snapshots = snapshotRows.map(row => {
    try {
      const state = JSON.parse(row.state_json);
      return { roomCode: row.room_code, createdAt: row.created_at, characters: state.characters || {}, npcs: state.npcs || {}, enemies: state.enemies || {}, soundboard: state.soundboard || [] };
    } catch { return { roomCode: row.room_code, createdAt: row.created_at, characters: {}, npcs: {}, enemies: {}, soundboard: [] }; }
  });

  return c.json({
    readOnly: true,
    generatedAt: new Date().toISOString(),
    instructions: "Use este material somente para leitura e planejamento. Não há operações de escrita neste endpoint.",
    wiki: {
      categories: [...new Set(pages.map(p => p.category))].sort(),
      pages: pages.map(p => ({ id: p.id, slug: p.slug, title: p.title, category: p.category, contentMd: p.content_md, author: p.author, secret: p.secret === 1, revealed: p.revealed === 1, createdAt: p.created_at, updatedAt: p.updated_at })),
    },
    chronicles: chronicles.map(cr => ({
      id: cr.id,
      characterId: cr.character_id,
      characterName: cr.character_name,
      title: cr.title,
      slug: cr.slug,
      excerpt: cr.excerpt ?? "",
      contentMd: cr.content_md ?? "",
      coverImageUrl: cr.cover_image_url ?? null,
      createdAt: cr.created_at,
      updatedAt: cr.updated_at,
      createdByUsername: cr.created_by_username,
    })),
    rpg: {
      statTemplates: templates,
      ruleSets: ruleSets.map(r => ({ ...r, stats: ruleStatsBySet[r.id] || [] })),
      characters: characters.map(ch => ({ ...ch, inventory: safeJson(ch.inventory_json), statusEffects: safeJson(ch.status_effects_json), stats: statsByCharacter[ch.id] || [] })),
      rooms,
      latestRoomSnapshots: snapshots,
    },
  }, 200, { "Cache-Control": "no-store" });
});

function safeJson(value: string | null | undefined): any[] {
  if (!value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
