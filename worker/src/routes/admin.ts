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
// ?includeDeleted=1 revela contas anonimizadas (deleted_at preenchido).
adminRoutes.get("/users", async (c) => {
  const includeDeleted = c.req.query("includeDeleted") === "1";
  const rows = await queryAll<{
    id: number;
    username: string;
    role: string;
    active: number;
    must_change_password: number;
    last_login: string | null;
    created_at: string;
    deleted_at: string | null;
  }>(
    c.env.DB,
    includeDeleted
      ? `SELECT id, username, role, active, must_change_password, last_login, created_at, deleted_at
         FROM users ORDER BY deleted_at IS NULL DESC, created_at ASC`
      : `SELECT id, username, role, active, must_change_password, last_login, created_at, deleted_at
         FROM users WHERE deleted_at IS NULL ORDER BY created_at ASC`
  );
  return c.json({ users: rows });
});

// ---------- GET /api/admin/users/:id/overview ----------
// Visão administrativa de tudo que está ligado a uma conta, sem retornar
// credenciais. A lista de personagens inclui apenas metadados e contagens;
// o conteúdo completo de cada ficha continua sendo acessível pelo endpoint
// de personagens, que já valida o papel de admin.
adminRoutes.get("/users/:id/overview", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id inválido." }, 400);

  const user = await queryFirst<{
    id: number; username: string; role: string; active: number;
    must_change_password: number; last_login: string | null;
    created_at: string; deleted_at: string | null;
  }>(c.env.DB, `
    SELECT id, username, role, active, must_change_password, last_login, created_at, deleted_at
    FROM users WHERE id = ?`, id);
  if (!user) return c.json({ error: "Usuário não encontrado." }, 404);

  const [characters, pages, chronicles, rooms, dicePresets, statTemplates, counts] = await Promise.all([
    queryAll<any>(c.env.DB, `
      SELECT c.id, c.name, c.page_id, c.photo_url, c.symbol_url, c.is_active,
             c.level, c.xp, c.hp_current, c.hp_max, c.money,
             c.bars_json, c.inventory_json, c.status_effects_json,
             c.created_at, c.updated_at,
             (SELECT COUNT(*) FROM character_stats cs WHERE cs.character_id = c.id) AS stats_count,
             (SELECT COUNT(*) FROM character_inventory_items ci WHERE ci.character_id = c.id) AS inventory_items_count
      FROM characters c WHERE c.owner_user_id = ?
      ORDER BY c.updated_at DESC, c.id DESC`, id),
    queryAll<any>(c.env.DB, `
      SELECT id, slug, title, category, secret, revealed, created_at, updated_at
      FROM pages WHERE created_by = ? ORDER BY updated_at DESC, id DESC LIMIT 200`, id),
    queryAll<any>(c.env.DB, `
      SELECT cr.id, cr.character_id, c.name AS character_name, cr.title, cr.slug,
             cr.excerpt, cr.created_at, cr.updated_at, u.username AS created_by_username
      FROM chronicles cr
      JOIN characters c ON c.id = cr.character_id
      JOIN users u ON u.id = cr.created_by
      WHERE c.owner_user_id = ? OR cr.created_by = ?
      ORDER BY cr.updated_at DESC, cr.id DESC LIMIT 300`, id, id),
    queryAll<any>(c.env.DB, `
      SELECT code, name, is_active, created_at, ended_at, last_activity
      FROM rooms WHERE master_user_id = ?
      ORDER BY created_at DESC LIMIT 100`, id),
    queryAll<any>(c.env.DB, `
      SELECT id, label, formula, is_public, created_at
      FROM dice_presets WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 200`, id),
    queryAll<any>(c.env.DB, `
      SELECT id, name, type, default_max, color, description, active, is_primary_health, created_at
      FROM stat_templates WHERE created_by = ? ORDER BY created_at DESC, id DESC LIMIT 200`, id),
    loadUserAssetCounts(c.env.DB, id),
  ]);

  const characterIds = characters.map(character => Number(character.id));
  const inventoryItems = characterIds.length
    ? await queryAll<any>(c.env.DB, `
        SELECT id, character_id, name, qty, description, equipped, icon_url, sort_order
        FROM character_inventory_items
        WHERE character_id IN (${characterIds.map(() => "?").join(",")})
        ORDER BY character_id, sort_order, id`, ...characterIds)
    : [];
  const statRows = characterIds.length
    ? await queryAll<any>(
        c.env.DB,
        "SELECT id, character_id, name, type, value_current, value_max, value_text, " +
        "value_bool, color, display_order FROM character_stats WHERE character_id IN (" +
        characterIds.map(() => "?").join(",") + ") ORDER BY character_id, display_order, id",
        ...characterIds
      )
    : [];
  const itemsByCharacter: Record<string, any[]> = {};
  for (const item of inventoryItems) (itemsByCharacter[item.character_id] ||= []).push({
    id: Number(item.id), name: item.name, qty: Number(item.qty),
    description: item.description ?? "", equipped: item.equipped === 1,
    iconUrl: item.icon_url ?? null, sortOrder: Number(item.sort_order ?? 0),
  });
  const statsByCharacter: Record<string, any[]> = {};
  for (const stat of statRows) (statsByCharacter[stat.character_id] ||= []).push({
    id: Number(stat.id), name: stat.name, type: stat.type,
    valueCurrent: stat.value_current, valueMax: stat.value_max,
    valueText: stat.value_text ?? "", valueBool: stat.value_bool === 1,
    color: stat.color ?? null, displayOrder: Number(stat.display_order ?? 0),
  });

  return c.json({
    user: {
      id: Number(user.id), username: user.username, role: user.role,
      active: user.active === 1, mustChangePassword: user.must_change_password === 1,
      lastLogin: user.last_login, createdAt: user.created_at, deletedAt: user.deleted_at,
    },
    summary: counts,
    characters: characters.map(character => ({
      id: Number(character.id), name: character.name,
      pageId: character.page_id == null ? null : Number(character.page_id),
      photoUrl: character.photo_url ?? null, symbolUrl: character.symbol_url ?? null,
      isActive: character.is_active === 1, level: Number(character.level ?? 1),
      xp: Number(character.xp ?? 0), statsCount: Number(character.stats_count ?? 0),
      hpCurrent: Number(character.hp_current ?? 0), hpMax: Number(character.hp_max ?? 0),
      money: Number(character.money ?? 0),
      bars: parseJson(character.bars_json, []),
      legacyInventory: parseJson(character.inventory_json, []),
      statusEffects: parseJson(character.status_effects_json, []),
      stats: statsByCharacter[character.id] || [],
      inventoryItems: itemsByCharacter[character.id] || [],
      inventoryItemsCount: Number(character.inventory_items_count ?? 0),
      createdAt: character.created_at, updatedAt: character.updated_at,
    })),
    pages: pages.map(page => ({
      id: Number(page.id), slug: page.slug, title: page.title, category: page.category,
      secret: page.secret === 1, revealed: page.revealed === 1,
      createdAt: page.created_at, updatedAt: page.updated_at,
    })),
    chronicles: chronicles.map(chronicle => ({
      id: Number(chronicle.id), characterId: Number(chronicle.character_id),
      characterName: chronicle.character_name, title: chronicle.title, slug: chronicle.slug,
      excerpt: chronicle.excerpt ?? "", createdByUsername: chronicle.created_by_username,
      createdAt: chronicle.created_at, updatedAt: chronicle.updated_at,
    })),
    rooms: rooms.map(room => ({
      code: room.code, name: room.name, isActive: room.is_active === 1,
      createdAt: room.created_at, endedAt: room.ended_at, lastActivity: room.last_activity,
    })),
    dicePresets: dicePresets.map(preset => ({
      id: Number(preset.id), label: preset.label, formula: preset.formula,
      isPublic: preset.is_public === 1, createdAt: preset.created_at,
    })),
    statTemplates: statTemplates.map(template => ({
      id: Number(template.id), name: template.name, type: template.type,
      defaultMax: template.default_max, color: template.color ?? null,
      description: template.description ?? "", active: template.active === 1,
      isPrimaryHealth: template.is_primary_health === 1, createdAt: template.created_at,
    })),
  });
});

// ---------- DELETE /api/admin/characters/:id ----------
// Exclusão administrativa explícita de uma ficha, usada para remover cópias
// repetidas. Exige confirmação do nome e bloqueia fichas presentes em salas
// ativas para não expulsar um jogador de uma sessão em andamento.
adminRoutes.delete("/characters/:id", async (c) => {
  const admin = c.get("user") as JwtPayload;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id inválido." }, 400);
  let body: { confirmName?: string } = {};
  try { body = await c.req.json(); } catch { return c.json({ error: "Confirmação inválida." }, 400); }

  const character = await queryFirst<{ id: number; name: string; owner_user_id: number }>(
    c.env.DB, `SELECT id, name, owner_user_id FROM characters WHERE id = ?`, id
  );
  if (!character) return c.json({ error: "Personagem não encontrado." }, 404);
  if (String(body.confirmName ?? "").trim() !== character.name) {
    return c.json({ error: "Digite o nome exato do personagem para confirmar a exclusão." }, 400);
  }

  const activeRoom = await queryFirst<{ c: number }>(c.env.DB, `
    SELECT COUNT(*) AS c
    FROM session_participants sp JOIN rooms r ON r.code = sp.room_code
    WHERE sp.character_id = ? AND r.is_active = 1`, id);
  if ((activeRoom?.c ?? 0) > 0) {
    return c.json({ error: "Este personagem está em uma sala ativa. Remova-o da sessão ou encerre a sala antes de excluir." }, 409);
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM session_participants WHERE character_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM character_inventory_items WHERE character_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM character_stats WHERE character_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM character_rule_sets WHERE character_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM chronicles WHERE character_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM characters WHERE id = ?`).bind(id),
  ]);
  await audit(c.env.DB, admin.sub, "admin.character.delete", String(id), `owner=${character.owner_user_id} name=${character.name}`);
  return c.json({ ok: true, id, name: character.name });
});

function parseJson(value: string | null | undefined, fallback: any): any {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

async function loadUserAssetCounts(db: D1Database, userId: number): Promise<Record<string, number>> {
  const definitions: Array<[string, string]> = [
    ["characters", "SELECT COUNT(*) AS c FROM characters WHERE owner_user_id = ?"],
    ["pages", "SELECT COUNT(*) AS c FROM pages WHERE created_by = ?"],
    ["revisions", "SELECT COUNT(*) AS c FROM revisions WHERE editor_id = ?"],
    ["chroniclesCreated", "SELECT COUNT(*) AS c FROM chronicles WHERE created_by = ?"],
    ["chroniclesOnCharacters", "SELECT COUNT(*) AS c FROM chronicles cr JOIN characters ch ON ch.id = cr.character_id WHERE ch.owner_user_id = ?"],
    ["rooms", "SELECT COUNT(*) AS c FROM rooms WHERE master_user_id = ?"],
    ["dicePresets", "SELECT COUNT(*) AS c FROM dice_presets WHERE owner_user_id = ?"],
    ["diceRolls", "SELECT COUNT(*) AS c FROM dice_log WHERE roller_user_id = ?"],
    ["statTemplates", "SELECT COUNT(*) AS c FROM stat_templates WHERE created_by = ?"],
    ["ruleSets", "SELECT COUNT(*) AS c FROM rule_sets WHERE created_by = ?"],
    ["sessions", "SELECT COUNT(*) AS c FROM session_participants WHERE user_id = ?"],
    ["trades", "SELECT COUNT(*) AS c FROM trades WHERE proposer_user_id = ? OR receiver_user_id = ?"],
    ["purchaseOffers", "SELECT COUNT(*) AS c FROM purchase_offers WHERE target_user_id = ?"],
    ["polls", "SELECT COUNT(*) AS c FROM polls WHERE created_by_user_id = ?"],
    ["pollVotes", "SELECT COUNT(*) AS c FROM poll_votes WHERE user_id = ?"],
    ["pollChatMessages", "SELECT COUNT(*) AS c FROM poll_chat_messages WHERE user_id = ?"],
    ["chatMessages", "SELECT COUNT(*) AS c FROM chat_log WHERE sender_user_id = ?"],
    ["masterPlanning", "SELECT COUNT(*) AS c FROM master_planning WHERE user_id = ?"],
    ["aiContextTokens", "SELECT COUNT(*) AS c FROM ai_context_tokens WHERE user_id = ?"],
    ["auditEntries", "SELECT COUNT(*) AS c FROM audit_log WHERE user_id = ?"],
  ];
  const results = await Promise.all(definitions.map(async ([key, sql]) => {
    const binds = key === "trades" ? [userId, userId] : [userId];
    const row = await queryFirst<{ c: number }>(db, sql, ...binds);
    return [key, Number(row?.c ?? 0)] as const;
  }));
  return Object.fromEntries(results);
}

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
// Exclusão de conta com preservação de integridade referencial.
//
// Lógica:
//   1. Não pode excluir a si mesmo.
//   2. Não pode excluir o último admin ativo do sistema.
//   3. Se o usuário NÃO tem nenhum conteúdo associado (páginas criadas,
//      revisões, personagens, presets, rolagens, stat_templates, audit_log):
//      → DELETE real da tabela users.
//   4. Se TEM qualquer conteúdo associado:
//      → Anonimiza e trava permanentemente (sem apagar a linha):
//        - username = "usuario-removido-{id}"
//        - password_hash e salt invalidados (login impossível)
//        - active = 0
//        - deleted_at = datetime('now')
//      → Conteúdo dele (páginas, revisões, personagens, etc.) permanece
//        intacto, referenciando o user_id anonimizado.
adminRoutes.delete("/users/:id", async (c) => {
  const user = c.get("user") as JwtPayload;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id inválido." }, 400);
  if (id === user.sub) return c.json({ error: "Não é possível excluir a si mesmo." }, 400);

  const target = await queryFirst<{ id: number; username: string; role: string; deleted_at: string | null }>(
    c.env.DB,
    `SELECT id, username, role, deleted_at FROM users WHERE id = ?`,
    id
  );
  if (!target) return c.json({ error: "Usuário não encontrado." }, 404);
  if (target.deleted_at) {
    return c.json({ error: "Esta conta já foi excluída/anonimizada." }, 400);
  }

  // Trava: nunca excluir/desativar o último admin ativo
  if (target.role === "admin") {
    const adminCount = await queryFirst<{ c: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS c FROM users WHERE role='admin' AND active=1 AND deleted_at IS NULL`
    );
    if (adminCount && adminCount.c <= 1) {
      return c.json({
        error: "Não é possível excluir o último administrador ativo do sistema. Promova outro usuário a admin antes de excluir este.",
      }, 400);
    }
  }

  // Verifica se existe QUALQUER conteúdo associado a esse user_id.
  // Se tudo estiver zerado, pode fazer DELETE real. Senão, anonimiza.
  const checks: Array<{ table: string; column: string }> = [
    { table: "pages",         column: "created_by" },
    { table: "revisions",     column: "editor_id" },
    { table: "characters",    column: "owner_user_id" },
    { table: "dice_presets",  column: "owner_user_id" },
    { table: "dice_log",      column: "roller_user_id" },
    { table: "stat_templates", column: "created_by" },
    { table: "audit_log",     column: "user_id" },
    { table: "ai_context_tokens", column: "user_id" },
    { table: "ai_context_access_log", column: "user_id" },
  ];
  let totalAssociated = 0;
  const details: Record<string, number> = {};
  for (const ck of checks) {
    const r = await queryFirst<{ c: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS c FROM ${ck.table} WHERE ${ck.column} = ?`,
      id
    );
    const cnt = r?.c ?? 0;
    details[ck.table] = cnt;
    totalAssociated += cnt;
  }

  if (totalAssociated === 0) {
    // Exclusão real — sem conteúdo associado, pode apagar a linha sem quebrar FK.
    await c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run();
    await audit(c.env.DB, user.sub, "user.delete.real", target.username, `id=${id} (nenhum conteúdo associado)`);
    return c.json({ ok: true, mode: "deleted", message: `Conta "${target.username}" excluída permanentemente (nenhum conteúdo associado).` });
  }

  // Anonimização — preserva integridade referencial
  // username vira usuario-removido-{id}; password_hash/salt viram strings
  // aleatórias que nunca vão passar em verifyPassword.
  const newUsername = `usuario-removido-${id}`;
  const fakeHash = `disabled$${Date.now()}$${Math.random().toString(36).slice(2)}`;
  const fakeSalt = `disabled$${Math.random().toString(36).slice(2)}`;
  await c.env.DB.prepare(
    `UPDATE users
     SET username = ?, password_hash = ?, salt = ?, active = 0, deleted_at = datetime('now')
     WHERE id = ?`
  ).bind(newUsername, fakeHash, fakeSalt, id).run();
  await audit(c.env.DB, user.sub, "user.delete.anonymize", target.username,
    `id=${id} anonimizado para "${newUsername}" (conteúdo associado: ${JSON.stringify(details)})`);
  return c.json({
    ok: true,
    mode: "anonymized",
    message: `Conta "${target.username}" desativada e anonimizada permanentemente. O conteúdo criado por ela permanece, mas ninguém pode mais logar nessa conta.`,
    newUsername,
    associatedContent: details,
  });
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
