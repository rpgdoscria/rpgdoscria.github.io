// routes/rooms.ts — endpoints REST para gestão de salas
//
// - POST /api/rooms              — cria sala (gera código único)
// - GET  /api/rooms              — lista salas do usuário atual (como mestre)
// - GET  /api/rooms/:code        — informações de uma sala (sem conectar via WS)
// - POST /api/rooms/:code/end    — encerra sala (mestre)
// - GET  /api/rooms/characters   — lista personagens do usuário atual
// - POST /api/rooms/characters   — cria personagem
// - PUT  /api/rooms/characters/:id — edita personagem
// - DELETE /api/rooms/characters/:id — apaga personagem
// - GET  /api/rooms/dice-presets — lista presets de dados do usuário
// - POST /api/rooms/dice-presets — cria preset
// - DELETE /api/rooms/dice-presets/:id — apaga preset
//
// A conexão WebSocket (que mantém a sala viva em tempo real) é feita em
// /api/rooms/connect?code=...&token=... e é roteada para o RoomDO via binding.

import { Hono } from "hono";
import type { Env } from "../env";
import type { JwtPayload } from "../lib/crypto";
import { queryAll, queryFirst, queryRun, audit } from "../lib/db";
import { requireRole } from "../lib/middleware";
import { rollFormula } from "../lib/dice-parser";
import { DiceParseError } from "../lib/dice-parser";

export const roomRoutes = new Hono<{ Bindings: Env; Variables: { user?: JwtPayload } }>();

// ---------- POST /api/rooms — cria sala ----------
// Idempotência: se o mestre já tem uma sala ativa criada nos últimos 30s com o
// MESMO nome, retorna aquela sala em vez de criar outra. Proteção contra duplo
// clique no botão de criar.
roomRoutes.post("/", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);

  // Apenas admins podem criar/hospedar sala. Desde a migration 0005, mestre
  // e admin são o mesmo cargo — não existe mais is_game_master separado.
  const userRow = await queryFirst<{ role: string; active: number }>(
    c.env.DB,
    `SELECT role, active FROM users WHERE id = ?`,
    user.sub
  );
  if (!userRow || userRow.active !== 1) return c.json({ error: "Conta inativa." }, 403);
  if (userRow.role !== "admin") {
    return c.json({ error: "Apenas administradores podem criar salas." }, 403);
  }

  let body: { characterIds?: number[]; name?: string } = {};
  try { body = await c.req.json(); } catch { /* sem body OK */ }
  const characterIds = Array.isArray(body.characterIds) ? body.characterIds : [];
  const roomName = String(body?.name ?? "").trim().slice(0, 100) || "Sala sem nome";

  // === IDEMPOTÊNCIA ===
  // Se o mestre já tem uma sala ativa criada nos últimos 30s com o mesmo nome,
  // retorna aquela. Evita duplicação por duplo clique.
  const recent = await queryFirst<{ code: string; created_at: string }>(
    c.env.DB,
    `SELECT code, created_at FROM rooms
     WHERE master_user_id = ? AND is_active = 1 AND name = ?
       AND created_at > datetime('now', '-30 seconds')
     ORDER BY created_at DESC LIMIT 1`,
    user.sub, roomName
  );
  if (recent) {
    // Sala recém-criada — devolve o código existente
    return c.json({ ok: true, code: recent.code, name: roomName, masterUsername: user.username, characters: characterIds.length, reused: true }, 201);
  }

  // Gera código único de 6 chars. Tenta até 5x evitar colisão.
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateRoomCode();
    // Verifica se o código já existe na tabela rooms (ativa ou não)
    const existing = await queryFirst<{ id: number }>(
      c.env.DB,
      `SELECT id FROM rooms WHERE code = ?`,
      code
    );
    if (!existing) break;
    code = "";
  }
  if (!code) return c.json({ error: "Falha ao gerar código de sala. Tente novamente." }, 500);

  // === PERSISTÊNCIA NA TABELA rooms (migration 0009) ===
  await c.env.DB.prepare(
    `INSERT INTO rooms (code, name, master_user_id, is_active) VALUES (?, ?, ?, 1)`
  ).bind(code, roomName, user.sub).run();

  // Carrega personagens selecionados do banco — agora com stats flexíveis.
  const characters: any[] = [];
  if (characterIds.length > 0) {
    const placeholders = characterIds.map(() => "?").join(",");
    const rows = await queryAll<any>(
      c.env.DB,
      `SELECT c.id, c.owner_user_id, c.name, c.photo_url, c.page_id,
              c.inventory_json, c.status_effects_json, u.username AS owner_username
       FROM characters c JOIN users u ON u.id = c.owner_user_id
       WHERE c.id IN (${placeholders})`,
      ...characterIds
    );
    for (const r of rows) {
      // Carrega stats do personagem (substitui hp_current/hp_max/money/bars antigos)
      const stats = await queryAll<any>(
        c.env.DB,
        `SELECT id, stat_template_id, is_custom, name, type, value_current, value_max, value_text, value_bool, color, display_order
         FROM character_stats WHERE character_id = ? ORDER BY display_order ASC, id ASC`,
        r.id
      );
      characters.push({
        id: r.id,
        ownerUserId: r.owner_user_id,
        ownerUsername: r.owner_username,
        name: r.name,
        photoUrl: r.photo_url,
        pageId: r.page_id,
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
        inventory: safeJson(r.inventory_json, []),
        statusEffects: safeJson(r.status_effects_json, []),
      });
    }
  }

  // Estado inicial do RoomDO — vamos usar o storage interno do DO ao invés de
  // iniciar via REST, garantindo que o DO seja a fonte única de verdade.
  const doId = c.env.ROOM.idFromName(code);
  const doStub = c.env.ROOM.get(doId);
  const initResp = await doStub.fetch(new Request(`https://do/init?code=${code}&masterUserId=${user.sub}&masterUsername=${encodeURIComponent(user.username)}&roomName=${encodeURIComponent(roomName)}`, {
    method: "POST",
  }));
  if (!initResp.ok) {
    return c.json({ error: "Falha ao inicializar sala no Durable Object." }, 500);
  }

  // Adiciona personagens selecionados ao estado inicial do DO
  for (const ch of characters) {
    await doStub.fetch(new Request(`https://do/add-character?code=${code}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character: ch }),
    }));
  }

  await audit(c.env.DB, user.sub, "room.create", code, `name="${roomName}" chars=${characters.length}`);
  return c.json({ ok: true, code, name: roomName, masterUsername: user.username, characters: characters.length }, 201);
});

// ---------- GET /api/rooms — lista salas do mestre (ativas E inativas) ----------
// Agora lê da tabela rooms (migration 0009) em vez de inferir dos snapshots.
// Retorna todas as salas do mestre, marcando is_active = 0 para as encerradas.
roomRoutes.get("/", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);

  const rows = await queryAll<{
    code: string; name: string; is_active: number; created_at: string; ended_at: string | null;
    last_activity: string;
  }>(
    c.env.DB,
    `SELECT code, name, is_active, created_at, ended_at, last_activity
     FROM rooms WHERE master_user_id = ?
     ORDER BY is_active DESC, created_at DESC LIMIT 100`,
    user.sub
  );
  return c.json({ rooms: rows.map(r => ({
    code: r.code,
    name: r.name,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    endedAt: r.ended_at,
    lastActivity: r.last_activity,
  })) });
});

// ---------- DELETE /api/rooms/:code — exclui sala definitivamente ----------
// Apenas o mestre criador pode excluir. Remove sala + snapshots + chat + dados.
// (Encerrar → is_active=0; Excluir → DELETE real)
roomRoutes.delete("/:code", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const code = c.req.param("code");
  const room = await queryFirst<{ master_user_id: number; is_active: number }>(
    c.env.DB,
    `SELECT master_user_id, is_active FROM rooms WHERE code = ?`,
    code
  );
  if (!room) return c.json({ error: "Sala não encontrada." }, 404);
  if (room.master_user_id !== user.sub) {
    return c.json({ error: "Apenas o mestre criador pode excluir a sala." }, 403);
  }
  // Remove tudo (cascade manual — D1 não honra FK CASCADE em todos os casos)
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM room_snapshots WHERE room_code = ?`).bind(code),
    c.env.DB.prepare(`DELETE FROM chat_log WHERE room_code = ?`).bind(code),
    c.env.DB.prepare(`DELETE FROM dice_log WHERE room_code = ?`).bind(code),
    c.env.DB.prepare(`DELETE FROM polls WHERE room_code = ?`).bind(code),
    c.env.DB.prepare(`DELETE FROM trades WHERE room_code = ?`).bind(code),
    c.env.DB.prepare(`DELETE FROM purchase_offers WHERE room_code = ?`).bind(code),
    c.env.DB.prepare(`DELETE FROM session_participants WHERE room_code = ?`).bind(code),
    c.env.DB.prepare(`DELETE FROM master_planning WHERE room_code = ?`).bind(code),
    c.env.DB.prepare(`DELETE FROM rooms WHERE code = ?`).bind(code),
  ]);
  // Manda o DO encerrar (limpa storage interno)
  try {
    const doId = c.env.ROOM.idFromName(code);
    const doStub = c.env.ROOM.get(doId);
    await doStub.fetch(new Request(`https://do/end`, { method: "POST" }));
  } catch {}
  await audit(c.env.DB, user.sub, "room.delete", code, null);
  return c.json({ ok: true });
});

// ---------- GET /api/rooms/:code/status — estado da sala + papel do usuário ----------
// CRÍTICO: este endpoint decide se o usuário é mestre ou jogador COMPARANDO
// o usuário autenticado com o masterUserId da sala no banco. Nunca confiar em
// parâmetro de URL nem em flag enviada pelo cliente.
//
// Agora lê da tabela rooms (0009) primeiro; fallback pra room_snapshots
// (compat com salas criadas antes da migration).
roomRoutes.get("/:code/status", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const code = c.req.param("code");

  // Tenta tabela rooms primeiro (nova)
  const roomRow = await queryFirst<{ name: string; master_user_id: number; is_active: number; ended_at: string | null; last_activity: string }>(
    c.env.DB,
    `SELECT name, master_user_id, is_active, ended_at, last_activity FROM rooms WHERE code = ?`,
    code
  );

  if (roomRow) {
    // Sala permanente (nova estrutura)
    if (!roomRow.is_active) {
      return c.json({
        status: "ended",
        message: "Esta sala foi encerrada pelo mestre.",
        code,
        name: roomRow.name,
      });
    }
    const isMaster = roomRow.master_user_id === user.sub;
    // Sala travada: só o mestre pode entrar — verifica no snapshot (estado em tempo real)
    let locked = false;
    const snap = await queryFirst<{ state_json: string }>(
      c.env.DB,
      `SELECT state_json FROM room_snapshots WHERE room_code = ? ORDER BY created_at DESC LIMIT 1`,
      code
    );
    if (snap) {
      try { locked = !!JSON.parse(snap.state_json).locked; } catch {}
    }
    if (locked && !isMaster) {
      return c.json({
        status: "locked",
        message: "Sala travada pelo mestre — não aceita novas entradas.",
        code, name: roomRow.name,
      });
    }
    return c.json({
      status: "active",
      code,
      name: roomRow.name,
      masterUsername: (await queryFirst<{ username: string }>(c.env.DB, `SELECT username FROM users WHERE id = ?`, roomRow.master_user_id))?.username ?? "mestre",
      locked,
      lastActivity: roomRow.last_activity,
      role: isMaster ? "master" : "player",
    });
  }

  // Fallback: sala antiga (pré-migration 0009) — lê do snapshot
  const row = await queryFirst<{ state_json: string; created_at: string }>(
    c.env.DB,
    `SELECT state_json, created_at FROM room_snapshots WHERE room_code = ? ORDER BY created_at DESC LIMIT 1`,
    code
  );

  if (!row) {
    return c.json({
      status: "not_found",
      message: "Sala não encontrada. Verifique o código com o mestre.",
    });
  }

  let st: any;
  try { st = JSON.parse(row.state_json); }
  catch { return c.json({ status: "corrupted", message: "Estado da sala corrompido." }, 500); }

  if (st.expired) {
    return c.json({ status: "ended", message: "Esta sala foi encerrada pelo mestre.", code });
  }
  const idleMs = Date.now() - (st.lastActivity ?? 0);
  if (idleMs > 6 * 60 * 60 * 1000) {
    return c.json({ status: "expired", message: "Esta sala expirou por inatividade (mais de 6h sem atividade).", code });
  }
  const isMaster = st.masterUserId === user.sub;
  if (st.locked && !isMaster) {
    return c.json({ status: "locked", message: "Sala travada pelo mestre — não aceita novas entradas.", code });
  }
  return c.json({
    status: "active",
    code,
    name: st.name || "Sala",
    masterUsername: st.masterUsername,
    locked: !!st.locked,
    createdAt: st.createdAt,
    lastActivity: st.lastActivity,
    role: isMaster ? "master" : "player",
  });
});

// ---------- GET /api/rooms/:code — info de uma sala ----------
roomRoutes.get("/:code", async (c) => {
  const code = c.req.param("code");
  const row = await queryFirst<{ state_json: string; created_at: string }>(
    c.env.DB,
    `SELECT state_json, created_at FROM room_snapshots WHERE room_code = ? ORDER BY created_at DESC LIMIT 1`,
    code
  );
  if (!row) return c.json({ error: "Sala não encontrada." }, 404);
  try {
    const st = JSON.parse(row.state_json);
    return c.json({
      code: st.code,
      masterUsername: st.masterUsername,
      createdAt: st.createdAt,
      lastActivity: st.lastActivity,
      locked: st.locked,
      expired: !!st.expired || Date.now() - (st.lastActivity ?? 0) > 6 * 60 * 60 * 1000,
      characterCount: Object.keys(st.characters || {}).length,
      enemyCount: Object.keys(st.enemies || {}).length,
    });
  } catch {
    return c.json({ error: "Estado da sala corrompido." }, 500);
  }
});

// ---------- POST /api/rooms/:code/end — encerra sala (marca is_active=0) ----------
// Sala permanece no banco (permanente) mas fica indisponível pra conexão.
// Para excluir definitivo, usar DELETE /api/rooms/:code.
roomRoutes.post("/:code/end", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const code = c.req.param("code");

  // Verifica permissão (mestre da sala)
  const roomRow = await queryFirst<{ master_user_id: number }>(
    c.env.DB,
    `SELECT master_user_id FROM rooms WHERE code = ?`,
    code
  );
  if (roomRow) {
    if (roomRow.master_user_id !== user.sub) {
      return c.json({ error: "Apenas o mestre pode encerrar a sala." }, 403);
    }
  } else {
    // Fallback: sala antiga — verifica no snapshot
    const row = await queryFirst<{ state_json: string }>(
      c.env.DB,
      `SELECT state_json FROM room_snapshots WHERE room_code = ? ORDER BY created_at DESC LIMIT 1`,
      code
    );
    if (!row) return c.json({ error: "Sala não encontrada." }, 404);
    let st: any;
    try { st = JSON.parse(row.state_json); } catch { return c.json({ error: "Estado corrompido." }, 500); }
    if (st.masterUserId !== user.sub) return c.json({ error: "Apenas o mestre pode encerrar a sala." }, 403);
  }

  // Marca is_active = 0 na tabela rooms (se existir)
  await c.env.DB.prepare(
    `UPDATE rooms SET is_active = 0, ended_at = datetime('now') WHERE code = ? AND is_active = 1`
  ).bind(code).run().catch(() => {});

  // Manda o DO encerrar (limpa conexões + storage + grava snapshot final)
  const doId = c.env.ROOM.idFromName(code);
  const doStub = c.env.ROOM.get(doId);
  await doStub.fetch(new Request(`https://do/end`, { method: "POST" }));

  await audit(c.env.DB, user.sub, "room.end", code, null);
  return c.json({ ok: true });
});

// ===================== Planejamento do mestre (Tarefa 5) =====================
// GET /api/rooms/:code/planning — retorna todas as seções de planejamento do mestre
// PUT /api/rooms/:code/planning/:section — upsert de uma seção (notes|enemies|scenarios)
// Apenas o mestre criador da sala pode acessar.

roomRoutes.get("/:code/planning", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const code = c.req.param("code");
  // Verifica mestre
  const room = await queryFirst<{ master_user_id: number }>(
    c.env.DB,
    `SELECT master_user_id FROM rooms WHERE code = ?`,
    code
  );
  if (!room) return c.json({ error: "Sala não encontrada." }, 404);
  if (room.master_user_id !== user.sub) {
    return c.json({ error: "Apenas o mestre pode ver o planejamento." }, 403);
  }
  const rows = await queryAll<{ section: string; content: string; updated_at: string }>(
    c.env.DB,
    `SELECT section, content, updated_at FROM master_planning WHERE room_code = ? AND user_id = ?`,
    code, user.sub
  );
  const out: Record<string, string> = { notes: "", enemies: "", scenarios: "" };
  rows.forEach(r => { out[r.section] = r.content; });
  return c.json({ planning: out });
});

roomRoutes.put("/:code/planning/:section", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const code = c.req.param("code");
  const section = c.req.param("section");
  if (!["notes", "enemies", "scenarios"].includes(section)) {
    return c.json({ error: "Seção inválida. Use: notes, enemies ou scenarios." }, 400);
  }
  const room = await queryFirst<{ master_user_id: number }>(
    c.env.DB,
    `SELECT master_user_id FROM rooms WHERE code = ?`,
    code
  );
  if (!room) return c.json({ error: "Sala não encontrada." }, 404);
  if (room.master_user_id !== user.sub) {
    return c.json({ error: "Apenas o mestre pode editar o planejamento." }, 403);
  }
  let body: { content?: string } = {};
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const content = String(body?.content ?? "").slice(0, 50000);
  await c.env.DB.prepare(
    `INSERT INTO master_planning (room_code, user_id, section, content, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(room_code, user_id, section) DO UPDATE SET content = ?, updated_at = datetime('now')`
  ).bind(code, user.sub, section, content, content).run();
  return c.json({ ok: true });
});

// ===================== Personagens (legado) =====================
// Os endpoints de personagens foram MOVIDOS para /api/characters (routes/characters.ts)
// que agora suporta stats flexíveis (homebrew). Estes proxies mantêm compat
// retroativa pra qualquer cliente antigo, mas TODO frontend novo deve usar
// /api/characters diretamente.

roomRoutes.get("/characters", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const rows = await queryAll<any>(
    c.env.DB,
    `SELECT id, owner_user_id, page_id, name, photo_url, is_active, inventory_json, status_effects_json, created_at, updated_at
     FROM characters WHERE owner_user_id = ?
     ORDER BY is_active DESC, updated_at DESC`,
    user.sub
  );
  // Para cada personagem, carrega stats (formato novo)
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
      pageId: r.page_id,
      name: r.name,
      photoUrl: r.photo_url,
      isActive: r.is_active === 1,
      stats: stats.map(s => ({
        id: s.id, statTemplateId: s.stat_template_id, isCustom: s.is_custom === 1,
        name: s.name, type: s.type,
        valueCurrent: s.value_current, valueMax: s.value_max,
        valueText: s.value_text, valueBool: s.value_bool,
        color: s.color, displayOrder: s.display_order,
      })),
      inventory: safeJson(r.inventory_json, []),
      statusEffects: safeJson(r.status_effects_json, []),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  }
  return c.json({ characters: out });
});

roomRoutes.post("/characters", async (c) => {
  // Proxy: manda criar em /api/characters via fetch interno
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  // Compat: se o body tem campos antigos (hpCurrent, hpMax, money, bars),
  // converte pra stats automaticamente.
  const stats = Array.isArray(body.stats) ? body.stats : [];
  if (body.hpMax !== undefined) {
    stats.push({ name: "Vida", type: "bar", valueCurrent: body.hpCurrent ?? body.hpMax, valueMax: body.hpMax, color: "#ef4444" });
  }
  if (body.money !== undefined) {
    stats.push({ name: "Dinheiro", type: "number", valueCurrent: body.money, color: "#fbbf24" });
  }
  if (Array.isArray(body.bars)) {
    body.bars.forEach((b: any) => stats.push({ name: b.name, type: "bar", valueCurrent: b.current, valueMax: b.max, color: b.color }));
  }
  // Cria direto
  const name = String(body?.name ?? "").trim();
  if (!name) return c.json({ error: "Nome é obrigatório." }, 400);
  const pageId = body.pageId ? Number(body.pageId) : null;
  const photoUrl = body.photoUrl ? String(body.photoUrl) : null;
  const inventory = Array.isArray(body.inventory) ? body.inventory : [];
  const result = await c.env.DB.prepare(
    `INSERT INTO characters (owner_user_id, page_id, name, photo_url, inventory_json, status_effects_json)
     VALUES (?, ?, ?, ?, ?, '[]')`
  ).bind(user.sub, pageId, name, photoUrl, JSON.stringify(inventory.slice(0, 100))).run();
  const newId = result.meta.last_row_id as number;
  // Insere stats
  let order = 0;
  for (const s of stats) {
    await c.env.DB.prepare(
      `INSERT INTO character_stats (character_id, stat_template_id, is_custom, name, type, value_current, value_max, value_text, value_bool, color, display_order)
       VALUES (?, NULL, 1, ?, ?, ?, ?, NULL, NULL, ?, ?)`
    ).bind(newId, String(s.name).slice(0, 50), s.type,
      s.type === "bar" || s.type === "number" ? (s.valueCurrent ?? 0) : null,
      s.type === "bar" ? (s.valueMax ?? 0) : null,
      s.color && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : null,
      order++
    ).run();
  }
  return c.json({ ok: true, id: newId }, 201);
});

roomRoutes.put("/characters/:id", async (c) => {
  // Proxy simples pra compat — só atualiza nome/inventário. Stats vão via /api/characters/:id/stat/:statId
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const own = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!own) return c.json({ error: "Personagem não encontrado." }, 404);
  if (own.owner !== user.sub) return c.json({ error: "Sem permissão." }, 403);
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (typeof body.name === "string" && body.name.trim()) { fields.push("name = ?"); values.push(body.name.trim().slice(0, 100)); }
  if (body.pageId !== undefined) { fields.push("page_id = ?"); values.push(body.pageId ? Number(body.pageId) : null); }
  if (typeof body.photoUrl !== "undefined") { fields.push("photo_url = ?"); values.push(body.photoUrl ? String(body.photoUrl) : null); }
  if (Array.isArray(body.inventory)) { fields.push("inventory_json = ?"); values.push(JSON.stringify(body.inventory.slice(0, 100))); }
  if (fields.length === 0) return c.json({ error: "Nenhum campo." }, 400);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  await c.env.DB.prepare(`UPDATE characters SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  return c.json({ ok: true });
});

roomRoutes.delete("/characters/:id", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const own = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM characters WHERE id = ?`, id);
  if (!own) return c.json({ error: "Personagem não encontrado." }, 404);
  if (own.owner !== user.sub) return c.json({ error: "Sem permissão." }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM character_stats WHERE character_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM characters WHERE id = ?`).bind(id),
  ]);
  return c.json({ ok: true });
});

// ===================== Presets de dados =====================

roomRoutes.get("/dice-presets", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  // Retorna presets do próprio user + presets públicos de qualquer user
  const rows = await queryAll<any>(
    c.env.DB,
    `SELECT p.id, p.owner_user_id, p.label, p.formula, p.is_public, p.created_at, u.username AS owner_username
     FROM dice_presets p JOIN users u ON u.id = p.owner_user_id
     WHERE p.owner_user_id = ? OR p.is_public = 1
     ORDER BY p.created_at DESC`,
    user.sub
  );
  return c.json({ presets: rows });
});

roomRoutes.post("/dice-presets", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const label = String(body?.label ?? "").trim();
  const formula = String(body?.formula ?? "").trim();
  if (!label || !formula) return c.json({ error: "label e formula são obrigatórios." }, 400);
  // Valida fórmula antes de salvar
  try { rollFormula(formula); } catch (e) {
    if (e instanceof DiceParseError) return c.json({ error: `Fórmula inválida: ${e.message}` }, 400);
    return c.json({ error: "Fórmula inválida." }, 400);
  }
  const isPublic = body.isPublic === false ? 0 : 1;
  const result = await c.env.DB.prepare(
    `INSERT INTO dice_presets (owner_user_id, label, formula, is_public) VALUES (?, ?, ?, ?)`
  ).bind(user.sub, label.slice(0, 100), formula.slice(0, 200), isPublic).run();
  return c.json({ ok: true, id: result.meta.last_row_id }, 201);
});

roomRoutes.delete("/dice-presets/:id", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const own = await queryFirst<{ owner: number }>(c.env.DB, `SELECT owner_user_id AS owner FROM dice_presets WHERE id = ?`, id);
  if (!own) return c.json({ error: "Preset não encontrado." }, 404);
  if (own.owner !== user.sub) return c.json({ error: "Você só pode apagar seus próprios presets." }, 403);
  await queryRun(c.env.DB, `DELETE FROM dice_presets WHERE id = ?`, id);
  return c.json({ ok: true });
});

// ---------- Helpers ----------
function generateRoomCode(): string {
  // 6 chars alfanuméricos, evitando chars ambíguos (0/O, 1/I, etc)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

function safeJson(s: string | null, fallback: any): any {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function clampInt(v: any, min: number, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
