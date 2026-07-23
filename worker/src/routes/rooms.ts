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

  let body: { characterIds?: number[] } = {};
  try { body = await c.req.json(); } catch { /* sem body OK */ }
  const characterIds = Array.isArray(body.characterIds) ? body.characterIds : [];

  // Gera código único de 6 chars. Tenta até 5x evitar colisão.
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateRoomCode();
    // Não há tabela de "rooms ativas" — a existência é inferida pelo snapshot
    // mais recente não-expirado em room_snapshots. Aqui só checamos se o último
    // snapshot dessa code está dentro da janela de 6h.
    const recent = await queryFirst<{ created_at: string; state_json: string }>(
      c.env.DB,
      `SELECT created_at, state_json FROM room_snapshots WHERE room_code = ? ORDER BY created_at DESC LIMIT 1`,
      code
    );
    if (recent) {
      try {
        const st = JSON.parse(recent.state_json);
        if (Date.now() - (st.lastActivity ?? 0) < 6 * 60 * 60 * 1000 && !st.expired) {
          continue; // código colidiu com sala ativa
        }
      } catch {}
    }
    break;
  }
  if (!code) return c.json({ error: "Falha ao gerar código de sala. Tente novamente." }, 500);

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
  // Para isso, mandamos um POST pro DO via fetch interno.
  const doId = c.env.ROOM.idFromName(code);
  const doStub = c.env.ROOM.get(doId);
  const initResp = await doStub.fetch(new Request(`https://do/init?code=${code}&masterUserId=${user.sub}&masterUsername=${encodeURIComponent(user.username)}`, {
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

  await audit(c.env.DB, user.sub, "room.create", code, `chars=${characters.length}`);
  return c.json({ ok: true, code, masterUsername: user.username, characters: characters.length }, 201);
});

// ---------- GET /api/rooms — lista salas do mestre ----------
roomRoutes.get("/", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);

  // Lista snapshots recentes (últimas 24h) cujo state_json.masterUserId == user.sub
  const rows = await queryAll<{ room_code: string; state_json: string; created_at: string }>(
    c.env.DB,
    `SELECT room_code, state_json, created_at FROM room_snapshots
     WHERE created_at > datetime('now', '-1 day')
     ORDER BY created_at DESC LIMIT 50`
  );
  const mine = rows
    .map(r => { try { return { ...JSON.parse(r.state_json), _code: r.room_code, _snap_at: r.created_at }; } catch { return null; } })
    .filter((r: any) => r && r.masterUserId === user.sub && !r.expired && Date.now() - (r.lastActivity ?? 0) < 6 * 60 * 60 * 1000);
  return c.json({ rooms: mine.map((r: any) => ({
    code: r._code,
    createdAt: r.createdAt,
    lastActivity: r.lastActivity,
    locked: r.locked,
    participantCount: Object.keys(r.characters || {}).length,
    enemyCount: Object.keys(r.enemies || {}).length,
    diceCount: (r.diceLog || []).length,
  })) });
});

// ---------- GET /api/rooms/:code/status — estado da sala + papel do usuário ----------
// CRÍTICO: este endpoint decide se o usuário é mestre ou jogador COMPARANDO
// o usuário autenticado com o masterUserId da sala no banco. Nunca confiar em
// parâmetro de URL nem em flag enviada pelo cliente.
roomRoutes.get("/:code/status", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const code = c.req.param("code");

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

  // Sala encerrada pelo mestre
  if (st.expired) {
    return c.json({
      status: "ended",
      message: "Esta sala foi encerrada pelo mestre.",
      code,
    });
  }

  // Sala expirada por inatividade (6h)
  const idleMs = Date.now() - (st.lastActivity ?? 0);
  if (idleMs > 6 * 60 * 60 * 1000) {
    return c.json({
      status: "expired",
      message: "Esta sala expirou por inatividade (mais de 6h sem atividade).",
      code,
    });
  }

  // DECISÃO DE PAPEL PELO SERVIDOR — mestre é quem criou a sala (masterUserId)
  const isMaster = st.masterUserId === user.sub;
  // Sala travada: só o mestre pode entrar
  if (st.locked && !isMaster) {
    return c.json({
      status: "locked",
      message: "Sala travada pelo mestre — não aceita novas entradas.",
      code,
    });
  }

  return c.json({
    status: "active",
    code,
    masterUsername: st.masterUsername,
    locked: !!st.locked,
    createdAt: st.createdAt,
    lastActivity: st.lastActivity,
    participantCount: Object.keys(st.characters || {}).length,
    enemyCount: Object.keys(st.enemies || {}).length,
    // PAPEL DECIDIDO PELO SERVIDOR — nunca pelo cliente
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

// ---------- POST /api/rooms/:code/end — encerra sala ----------
roomRoutes.post("/:code/end", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const code = c.req.param("code");

  // Verifica que é o mestre da sala
  const row = await queryFirst<{ state_json: string }>(
    c.env.DB,
    `SELECT state_json FROM room_snapshots WHERE room_code = ? ORDER BY created_at DESC LIMIT 1`,
    code
  );
  if (!row) return c.json({ error: "Sala não encontrada." }, 404);
  let st: any;
  try { st = JSON.parse(row.state_json); } catch { return c.json({ error: "Estado corrompido." }, 500); }
  if (st.masterUserId !== user.sub) return c.json({ error: "Apenas o mestre pode encerrar a sala." }, 403);

  // Manda o DO encerrar (ele vai limpar conexões + storage + gravar snapshot final)
  const doId = c.env.ROOM.idFromName(code);
  const doStub = c.env.ROOM.get(doId);
  await doStub.fetch(new Request(`https://do/end`, { method: "POST" }));

  await audit(c.env.DB, user.sub, "room.end", code, null);
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
