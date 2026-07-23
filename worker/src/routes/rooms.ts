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

  // Apenas usuários com is_game_master=1 OU role=admin podem criar sala.
  // Admin do site é considerado master também (facilita pra grupo pequeno).
  const userRow = await queryFirst<{ is_game_master: number; role: string; active: number }>(
    c.env.DB,
    `SELECT is_game_master, role, active FROM users WHERE id = ?`,
    user.sub
  );
  if (!userRow || userRow.active !== 1) return c.json({ error: "Conta inativa." }, 403);
  if (userRow.role !== "admin" && userRow.is_game_master !== 1) {
    return c.json({ error: "Você não tem permissão de mestre. Peça a um admin para habilitar." }, 403);
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

  // Carrega personagens selecionados do banco (apenas os que pertencem ao mestre
  // ou a outros usuários — o mestre decide quem entra na sessão).
  const characters: any[] = [];
  if (characterIds.length > 0) {
    const placeholders = characterIds.map(() => "?").join(",");
    const rows = await queryAll<any>(
      c.env.DB,
      `SELECT c.id, c.owner_user_id, c.name, c.hp_current, c.hp_max, c.money,
              c.bars_json, c.inventory_json, c.status_effects_json, u.username AS owner_username
       FROM characters c JOIN users u ON u.id = c.owner_user_id
       WHERE c.id IN (${placeholders})`,
      ...characterIds
    );
    for (const r of rows) {
      characters.push({
        id: r.id,
        ownerUserId: r.owner_user_id,
        ownerUsername: r.owner_username,
        name: r.name,
        hpCurrent: r.hp_current,
        hpMax: r.hp_max,
        money: r.money,
        bars: safeJson(r.bars_json, []),
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

// ===================== Personagens =====================

roomRoutes.get("/characters", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const rows = await queryAll<any>(
    c.env.DB,
    `SELECT id, owner_user_id, page_id, name, hp_current, hp_max, money,
            bars_json, inventory_json, status_effects_json, created_at, updated_at
     FROM characters WHERE owner_user_id = ?
     ORDER BY updated_at DESC`,
    user.sub
  );
  return c.json({
    characters: rows.map(r => ({
      id: r.id,
      ownerUserId: r.owner_user_id,
      pageId: r.page_id,
      name: r.name,
      hpCurrent: r.hp_current,
      hpMax: r.hp_max,
      money: r.money,
      bars: safeJson(r.bars_json, []),
      inventory: safeJson(r.inventory_json, []),
      statusEffects: safeJson(r.status_effects_json, []),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});

roomRoutes.post("/characters", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const name = String(body?.name ?? "").trim();
  if (name.length < 1) return c.json({ error: "Nome é obrigatório." }, 400);
  const pageId = body.pageId ? Number(body.pageId) : null;
  const hpCurrent = clampInt(body.hpCurrent ?? 0, -9999, 99999);
  const hpMax = clampInt(body.hpMax ?? 0, 0, 99999);
  const money = clampInt(body.money ?? 0, -1_000_000, 1_000_000_000);
  const bars = JSON.stringify((Array.isArray(body.bars) ? body.bars : []).slice(0, 10));
  const inventory = JSON.stringify((Array.isArray(body.inventory) ? body.inventory : []).slice(0, 100));
  const status = JSON.stringify([]);

  const result = await c.env.DB.prepare(
    `INSERT INTO characters (owner_user_id, page_id, name, hp_current, hp_max, money, bars_json, inventory_json, status_effects_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.sub, pageId, name, hpCurrent, hpMax, money, bars, inventory, status).run();
  const newId = result.meta.last_row_id as number;
  return c.json({ ok: true, id: newId }, 201);
});

roomRoutes.put("/characters/:id", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id inválido." }, 400);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }

  const own = await queryFirst<{ owner: number }>(
    c.env.DB,
    `SELECT owner_user_id AS owner FROM characters WHERE id = ?`,
    id
  );
  if (!own) return c.json({ error: "Personagem não encontrado." }, 404);
  if (own.owner !== user.sub) return c.json({ error: "Você só pode editar seus próprios personagens." }, 403);

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (typeof body.name === "string" && body.name.trim()) { fields.push("name = ?"); values.push(body.name.trim().slice(0, 100)); }
  if (typeof body.pageId === "number") { fields.push("page_id = ?"); values.push(body.pageId); }
  if (typeof body.hpCurrent === "number") { fields.push("hp_current = ?"); values.push(clampInt(body.hpCurrent, -9999, 99999)); }
  if (typeof body.hpMax === "number") { fields.push("hp_max = ?"); values.push(clampInt(body.hpMax, 0, 99999)); }
  if (typeof body.money === "number") { fields.push("money = ?"); values.push(clampInt(body.money, -1_000_000, 1_000_000_000)); }
  if (Array.isArray(body.bars)) { fields.push("bars_json = ?"); values.push(JSON.stringify(body.bars.slice(0, 10))); }
  if (Array.isArray(body.inventory)) { fields.push("inventory_json = ?"); values.push(JSON.stringify(body.inventory.slice(0, 100))); }
  if (fields.length === 0) return c.json({ error: "Nenhum campo para atualizar." }, 400);
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
  if (own.owner !== user.sub) return c.json({ error: "Você só pode apagar seus próprios personagens." }, 403);
  await queryRun(c.env.DB, `DELETE FROM characters WHERE id = ?`, id);
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
