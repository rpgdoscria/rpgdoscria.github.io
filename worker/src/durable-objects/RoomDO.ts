// durable-objects/RoomDO.ts — Durable Object: uma instância por sala
//
// Responsabilidades:
//   - Aceitar upgrades WebSocket
//   - Validar JWT do cliente (passado via query string porque o navegador
//     não permite header Authorization em WS)
//   - Manter estado da sala em memória (personagens presentes, inimigos,
//     log de dados, presets sugeridos)
//   - Fazer broadcast de mudanças para todos os sockets conectados
//   - Persistir snapshots em D1 (throttled) e ao encerrar
//   - Aplicar rate limit por socket (1 msg/300ms)
//   - Expirar após inatividade (6h)
//
// O D1 é acessado via env.DB injetado no Durable Object (bindings passam).

import { verifyJwt, type JwtPayload } from "../lib/crypto";
import { rollFormula, formatBreakdown, type RollResult, DiceParseError } from "../lib/dice-parser";

export interface RoomEnv {
  DB: D1Database;
  JWT_SECRET: string;
}

// ---------- Tipos de estado da sala ----------
interface Bar { name: string; current: number; max: number; color: string; }
interface InventoryItem { name: string; qty: number; description?: string; }
interface StatusEffect { id: string; text: string; }

interface CharacterState {
  id: number;
  ownerUserId: number;
  ownerUsername: string;
  name: string;
  hpCurrent: number;
  hpMax: number;
  money: number;
  bars: Bar[];
  inventory: InventoryItem[];
  statusEffects: StatusEffect[];
}

type EnemyHpMode = "numeric" | "description";
interface EnemyState {
  id: string;
  name: string;
  hpMode: EnemyHpMode;
  hpCurrent?: number;
  hpMax?: number;
  description?: string;
  statusEffects: StatusEffect[];
}

interface DiceLogEntry {
  id: string;
  rollerUserId: number;
  rollerUsername: string;
  formula: string;
  label?: string;
  result: RollResult;
  breakdown: string;
  timestamp: number;
}

interface SuggestedFormula {
  id: string;
  fromUserId: number;
  fromUsername: string;
  formula: string;
  label: string;
  timestamp: number;
}

interface RoomState {
  code: string;
  masterUserId: number;
  masterUsername: string;
  locked: boolean;
  createdAt: number;
  lastActivity: number;
  characters: Record<number, CharacterState>;  // chave = characterId
  enemies: Record<string, EnemyState>;
  diceLog: DiceLogEntry[];
  suggestions: SuggestedFormula[];
}

// ---------- Conexão ----------
interface Connection {
  ws: WebSocket;
  userId: number;
  username: string;
  isMaster: boolean;
  characterId?: number;
  lastMsgAt: number;
}

const RATE_LIMIT_MS = 300;
const ROOM_IDLE_EXPIRY_MS = 6 * 60 * 60 * 1000; // 6h
const SNAPSHOT_THROTTLE_MS = 3000;

const ENEMY_PRESETS = ["Ileso", "Arranhado", "Ferido", "Gravemente ferido", "À beira da morte", "Derrotado"];

// Acesso ao storage do DO: usamos uma propriedade injetada via ctor.
// Em runtime Cloudflare, o DurableObjectState tem storage/alarm. Em dev com
// wrangler, igual. Em testes unitários (fora do runtime), pode faltar — por
// isso todos os acessos são try/catch.
interface StorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  setAlarm(time: number): Promise<void>;
}

export class RoomDO<Env extends RoomEnv = RoomEnv> implements DurableObject {
  private state: RoomState | null = null;
  private connections = new Map<WebSocket, Connection>();
  private lastSnapshotAt = 0;
  private alarmScheduled = false;
  private readonly env: Env;
  private readonly storage: StorageLike;

  constructor(state: DurableObjectState, env: Env) {
    this.env = env;
    // storage pode não existir em ambientes de teste — acesse com cuidado.
    this.storage = (state as any).storage as StorageLike;
    state.blockConcurrencyWhile(async () => {
      try {
        const stored = await this.storage.get<RoomState>("roomState");
        if (stored) {
          this.state = stored;
          await this.scheduleExpiry();
        }
      } catch {}
    });
  }

  // ---------- HTTP entry: aceita upgrade WebSocket ----------
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Endpoints internos REST chamados pela rota POST /api/rooms (criar sala).
    if (url.pathname.endsWith("/init") && request.method === "POST") {
      return this.handleInit(url);
    }
    if (url.pathname.endsWith("/add-character") && request.method === "POST") {
      return this.handleAddCharacter(request);
    }
    if (url.pathname.endsWith("/end") && request.method === "POST") {
      // Encerra via REST — busca o mestre no estado e dispara o handler
      if (!this.state) return new Response("Sala não existe", { status: 404 });
      // Cria uma Connection virtual sem socket para satisfazer handleEndRoom
      // Na verdade, vamos refatorar: handleEndRoom não precisa do conn.
      await this.endRoomInternal();
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname.endsWith("/connect") || url.pathname.endsWith("/connect/")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Esperado Upgrade: websocket", { status: 426 });
      }
      return this.handleConnect(request, url);
    }
    if (url.pathname.endsWith("/state") || url.pathname.endsWith("/state/")) {
      if (!this.state) return new Response("Sala não inicializada", { status: 404 });
      return new Response(JSON.stringify(this.state), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  }

  // Inicializa o estado da sala a partir de uma chamada REST da rota POST /api/rooms.
  private async handleInit(url: URL): Promise<Response> {
    const code = url.searchParams.get("code");
    const masterUserId = Number(url.searchParams.get("masterUserId"));
    const masterUsername = url.searchParams.get("masterUsername") ?? "";
    if (!code || !masterUserId) return new Response("code e masterUserId são obrigatórios", { status: 400 });
    if (this.state) return new Response("Sala já inicializada", { status: 409 });
    this.state = {
      code,
      masterUserId,
      masterUsername: decodeURIComponent(masterUsername),
      locked: false,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      characters: {},
      enemies: {},
      diceLog: [],
      suggestions: [],
    };
    await this.persistState(true);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  // Adiciona um personagem ao estado da sala (chamado pela rota POST /api/rooms).
  private async handleAddCharacter(request: Request): Promise<Response> {
    if (!this.state) return new Response("Sala não inicializada", { status: 409 });
    let body: any;
    try { body = await request.json(); } catch { return new Response("JSON inválido", { status: 400 }); }
    const ch = body?.character;
    if (!ch || !ch.id || !ch.name) return new Response("Personagem inválido", { status: 400 });
    this.state.characters[Number(ch.id)] = {
      id: Number(ch.id),
      ownerUserId: ch.ownerUserId,
      ownerUsername: ch.ownerUsername ?? "",
      name: String(ch.name).slice(0, 100),
      hpCurrent: clampInt(ch.hpCurrent ?? 0, -9999, 99999),
      hpMax: clampInt(ch.hpMax ?? 0, 0, 99999),
      money: clampInt(ch.money ?? 0, -1_000_000, 1_000_000_000),
      bars: Array.isArray(ch.bars) ? ch.bars.slice(0, 10) : [],
      inventory: Array.isArray(ch.inventory) ? ch.inventory.slice(0, 100) : [],
      statusEffects: [],
    };
    await this.persistState(true);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  private async endRoomInternal() {
    await this.persistState(true);
    this.broadcast({ type: "room_closed", payload: { reason: "Sala encerrada pelo mestre." } });
    for (const [ws] of this.connections) {
      try { ws.close(1000, "Sala encerrada"); } catch {}
    }
    this.connections.clear();
    try { await this.storage.deleteAll(); } catch {}
    this.state = null;
  }

  private async handleConnect(request: Request, url: URL): Promise<Response> {
    const code = url.searchParams.get("code");
    const token = url.searchParams.get("token");
    const characterIdStr = url.searchParams.get("characterId");
    const characterId = characterIdStr ? Number(characterIdStr) : undefined;

    if (!code || !token) {
      return new Response("code e token são obrigatórios", { status: 400 });
    }

    const payload = await verifyJwt(token, this.env.JWT_SECRET);
    if (!payload) {
      return new Response("Token inválido ou expirado.", { status: 401 });
    }

    if (!this.state) {
      const restored = await this.restoreFromSnapshot(code);
      if (!restored) {
        return new Response("Sala não encontrada. Peça ao mestre para recriá-la.", { status: 404 });
      }
    }

    const isMaster = this.state!.masterUserId === payload.sub;
    if (!isMaster && this.state!.locked) {
      return new Response("Sala travada pelo mestre — não aceita novas entradas.", { status: 403 });
    }

    this.state!.lastActivity = Date.now();
    await this.persistState(true);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const conn: Connection = {
      ws: server,
      userId: payload.sub,
      username: payload.username,
      isMaster,
      characterId,
      lastMsgAt: 0,
    };
    this.connections.set(server, conn);

    server.accept();
    server.addEventListener("message", (e) => this.onMessage(server, e));
    server.addEventListener("close", () => this.onClose(server));
    server.addEventListener("error", () => this.onClose(server));

    this.sendTo(server, { type: "room_state", payload: this.publicState(conn) });
    this.broadcast({ type: "participant_joined", payload: { userId: payload.sub, username: payload.username, isMaster } }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------- Handler de mensagens ----------
  private async onMessage(ws: WebSocket, event: MessageEvent) {
    const conn = this.connections.get(ws);
    if (!conn || !this.state) return;

    const now = Date.now();
    if (now - conn.lastMsgAt < RATE_LIMIT_MS) {
      this.sendTo(ws, { type: "error", payload: { message: "Muitas mensagens. Aguarde um instante." } });
      return;
    }
    conn.lastMsgAt = now;
    this.state.lastActivity = now;

    let msg: { type: string; payload?: any };
    try {
      msg = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      this.sendTo(ws, { type: "error", payload: { message: "Mensagem inválida (JSON malformado)." } });
      return;
    }

    try {
      switch (msg.type) {
        case "roll_dice": await this.handleRollDice(conn, msg.payload); break;
        case "suggest_formula": await this.handleSuggestFormula(conn, msg.payload); break;
        case "update_own_character": await this.handleUpdateOwnCharacter(conn, msg.payload); break;
        case "update_character": await this.handleUpdateCharacter(conn, msg.payload); break;
        case "create_enemy": await this.handleCreateEnemy(conn, msg.payload); break;
        case "update_enemy": await this.handleUpdateEnemy(conn, msg.payload); break;
        case "delete_enemy": await this.handleDeleteEnemy(conn, msg.payload); break;
        case "add_status_effect": await this.handleAddStatusEffect(conn, msg.payload); break;
        case "remove_status_effect": await this.handleRemoveStatusEffect(conn, msg.payload); break;
        case "lock_room": await this.handleLockRoom(conn, msg.payload); break;
        case "end_room": await this.handleEndRoom(conn); break;
        default:
          this.sendTo(ws, { type: "error", payload: { message: `Tipo de mensagem desconhecido: ${msg.type}` } });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro interno";
      this.sendTo(ws, { type: "error", payload: { message } });
    }
    await this.persistStateThrottled();
  }

  // ---------- Handlers ----------
  private async handleRollDice(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode rolar dados.");
    const formula = String(p?.formula ?? "").trim();
    const label = p?.label ? String(p.label).trim().slice(0, 100) : undefined;
    if (!formula) throw new Error("Fórmula é obrigatória.");

    let result: RollResult;
    try {
      result = rollFormula(formula);
    } catch (e) {
      if (e instanceof DiceParseError) throw new Error(`Fórmula inválida: ${e.message}`);
      throw e;
    }
    const breakdown = formatBreakdown(result);
    const entry: DiceLogEntry = {
      id: cryptoRandomId(),
      rollerUserId: conn.userId,
      rollerUsername: conn.username,
      formula: result.formula,
      label,
      result,
      breakdown,
      timestamp: Date.now(),
    };
    this.state!.diceLog.push(entry);
    if (this.state!.diceLog.length > 200) this.state!.diceLog.shift();

    await this.env.DB.prepare(
      `INSERT INTO dice_log (room_code, roller_user_id, formula, label, result_json) VALUES (?, ?, ?, ?, ?)`
    ).bind(
      this.state!.code,
      conn.userId,
      result.formula,
      label ?? null,
      JSON.stringify(result)
    ).run().catch(() => {/* best-effort */});

    this.broadcast({ type: "dice_result", payload: entry });
  }

  private async handleSuggestFormula(conn: Connection, p: any) {
    const formula = String(p?.formula ?? "").trim();
    const label = String(p?.label ?? "").trim();
    if (!formula || !label) throw new Error("Fórmula e label são obrigatórios.");
    try { rollFormula(formula); } catch (e) {
      if (e instanceof DiceParseError) throw new Error(`Fórmula inválida: ${e.message}`);
      throw e;
    }
    const sug: SuggestedFormula = {
      id: cryptoRandomId(),
      fromUserId: conn.userId,
      fromUsername: conn.username,
      formula,
      label,
      timestamp: Date.now(),
    };
    this.state!.suggestions.push(sug);
    if (this.state!.suggestions.length > 50) this.state!.suggestions.shift();
    this.broadcast({ type: "formula_suggested", payload: sug });
  }

  private async handleUpdateOwnCharacter(conn: Connection, p: any) {
    if (!conn.characterId) throw new Error("Você não está conectado com um personagem.");
    if (!this.state!.characters[conn.characterId]) throw new Error("Personagem não está na sala.");
    const ch = this.state!.characters[conn.characterId];
    this.applyCharacterUpdate(ch, p, /*allowAll=*/false);
    this.broadcast({ type: "character_updated", payload: ch });
  }

  private async handleUpdateCharacter(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode editar personagens de outros.");
    const id = Number(p?.characterId);
    if (!id || !this.state!.characters[id]) throw new Error("Personagem não encontrado.");
    const ch = this.state!.characters[id];
    this.applyCharacterUpdate(ch, p, /*allowAll=*/true);
    this.broadcast({ type: "character_updated", payload: ch });
  }

  private applyCharacterUpdate(ch: CharacterState, p: any, allowAll: boolean) {
    if (typeof p?.hpCurrent === "number") {
      const v = Math.floor(p.hpCurrent);
      if (v < -9999 || v > 99999) throw new Error("HP atual fora do intervalo permitido.");
      ch.hpCurrent = v;
    }
    if (typeof p?.hpMax === "number") {
      const v = Math.floor(p.hpMax);
      if (v < 0 || v > 99999) throw new Error("HP máximo fora do intervalo permitido.");
      ch.hpMax = v;
    }
    if (typeof p?.money === "number") {
      const v = Math.floor(p.money);
      if (v < -1_000_000 || v > 1_000_000_000) throw new Error("Dinheiro fora do intervalo permitido.");
      ch.money = v;
    }
    if (Array.isArray(p?.bars)) {
      const clean = p.bars.filter((b: any) => b && typeof b.name === "string").map((b: any) => ({
        name: String(b.name).slice(0, 50),
        current: clampInt(b.current, 0, 99999),
        max: clampInt(b.max, 0, 99999),
        color: typeof b.color === "string" && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : "#3498db",
      }));
      ch.bars = clean.slice(0, 10);
    }
    if (Array.isArray(p?.inventory)) {
      const clean = p.inventory.filter((it: any) => it && typeof it.name === "string").map((it: any) => ({
        name: String(it.name).slice(0, 80),
        qty: clampInt(it.qty, 0, 9999),
        description: it.description ? String(it.description).slice(0, 200) : undefined,
      }));
      ch.inventory = clean.slice(0, 100);
    }
    // hp_current nunca pode exceder hp_max (se ambos definidos)
    if (ch.hpMax > 0 && ch.hpCurrent > ch.hpMax) ch.hpCurrent = ch.hpMax;
  }

  private async handleCreateEnemy(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode criar inimigos.");
    const name = String(p?.name ?? "").trim();
    if (!name) throw new Error("Nome do inimigo é obrigatório.");
    const hpMode: EnemyHpMode = p?.hpMode === "numeric" ? "numeric" : "description";
    const enemy: EnemyState = {
      id: cryptoRandomId(),
      name: name.slice(0, 100),
      hpMode,
      statusEffects: [],
    };
    if (hpMode === "numeric") {
      enemy.hpMax = clampInt(p?.hpMax, 0, 99999);
      enemy.hpCurrent = clampInt(p?.hpCurrent ?? enemy.hpMax, 0, enemy.hpMax);
    } else {
      const desc = String(p?.description ?? "Ileso").trim();
      enemy.description = ENEMY_PRESETS.includes(desc) ? desc : desc.slice(0, 100);
    }
    this.state!.enemies[enemy.id] = enemy;
    this.broadcast({ type: "enemy_updated", payload: enemy });
  }

  private async handleUpdateEnemy(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode editar inimigos.");
    const id = String(p?.enemyId ?? "");
    const enemy = this.state!.enemies[id];
    if (!enemy) throw new Error("Inimigo não encontrado.");

    if (typeof p?.name === "string" && p.name.trim()) enemy.name = p.name.trim().slice(0, 100);
    if (p?.hpMode === "numeric" || p?.hpMode === "description") {
      const newMode = p.hpMode as EnemyHpMode;
      if (newMode !== enemy.hpMode) {
        enemy.hpMode = newMode;
        if (newMode === "numeric") {
          enemy.hpMax = clampInt(p?.hpMax ?? 10, 0, 99999);
          enemy.hpCurrent = clampInt(p?.hpCurrent ?? enemy.hpMax, 0, enemy.hpMax);
          enemy.description = undefined;
        } else {
          enemy.description = String(p?.description ?? "Ileso").trim().slice(0, 100);
          enemy.hpCurrent = undefined;
          enemy.hpMax = undefined;
        }
      }
    }
    if (enemy.hpMode === "numeric") {
      if (typeof p?.hpCurrent === "number") enemy.hpCurrent = clampInt(p.hpCurrent, 0, enemy.hpMax ?? 99999);
      if (typeof p?.hpMax === "number") {
        const newMax = clampInt(p.hpMax, 0, 99999);
        enemy.hpMax = newMax;
        if (enemy.hpCurrent && enemy.hpCurrent > newMax) enemy.hpCurrent = newMax;
      }
    } else if (typeof p?.description === "string") {
      const d = p.description.trim();
      enemy.description = ENEMY_PRESETS.includes(d) ? d : d.slice(0, 100);
    }
    this.broadcast({ type: "enemy_updated", payload: enemy });
  }

  private async handleDeleteEnemy(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode remover inimigos.");
    const id = String(p?.enemyId ?? "");
    if (!this.state!.enemies[id]) return;
    delete this.state!.enemies[id];
    this.broadcast({ type: "enemy_deleted", payload: { enemyId: id } });
  }

  private async handleAddStatusEffect(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode adicionar status.");
    const targetId = p?.targetId;
    const targetType = p?.targetType;
    const text = String(p?.text ?? "").trim();
    if (!text) throw new Error("Texto do status é obrigatório.");
    if (text.length > 200) throw new Error("Status muito longo (máx 200 caracteres).");
    const effect: StatusEffect = { id: cryptoRandomId(), text: text.slice(0, 200) };
    if (targetType === "character") {
      const ch = this.state!.characters[Number(targetId)];
      if (!ch) throw new Error("Personagem não encontrado.");
      ch.statusEffects.push(effect);
      this.broadcast({ type: "status_effect_added", payload: { targetType, targetId: Number(targetId), effect } });
    } else if (targetType === "enemy") {
      const en = this.state!.enemies[String(targetId)];
      if (!en) throw new Error("Inimigo não encontrado.");
      en.statusEffects.push(effect);
      this.broadcast({ type: "status_effect_added", payload: { targetType, targetId: String(targetId), effect } });
    } else {
      throw new Error("targetType deve ser 'character' ou 'enemy'.");
    }
  }

  private async handleRemoveStatusEffect(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode remover status.");
    const { targetId, targetType, statusId } = p ?? {};
    if (targetType === "character") {
      const ch = this.state!.characters[Number(targetId)];
      if (!ch) return;
      ch.statusEffects = ch.statusEffects.filter(s => s.id !== statusId);
      this.broadcast({ type: "status_effect_removed", payload: { targetType, targetId: Number(targetId), statusId } });
    } else if (targetType === "enemy") {
      const en = this.state!.enemies[String(targetId)];
      if (!en) return;
      en.statusEffects = en.statusEffects.filter(s => s.id !== statusId);
      this.broadcast({ type: "status_effect_removed", payload: { targetType, targetId: String(targetId), statusId } });
    }
  }

  private async handleLockRoom(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode travar a sala.");
    this.state!.locked = !!p?.locked;
    this.broadcast({ type: "room_locked", payload: { locked: this.state!.locked } });
  }

  private async handleEndRoom(conn: Connection) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode encerrar a sala.");
    await this.persistState(true);
    this.broadcast({ type: "room_closed", payload: { reason: "Sala encerrada pelo mestre." } });
    for (const [ws] of this.connections) {
      try { ws.close(1000, "Sala encerrada"); } catch {}
    }
    this.connections.clear();
    try { await this.storage.deleteAll(); } catch {}
    this.state = null;
  }

  private onClose(ws: WebSocket) {
    const conn = this.connections.get(ws);
    this.connections.delete(ws);
    if (conn) {
      this.broadcast({ type: "participant_left", payload: { userId: conn.userId, username: conn.username, isMaster: conn.isMaster } });
    }
  }

  // ---------- Persistência ----------
  private async persistStateThrottled() {
    if (Date.now() - this.lastSnapshotAt < SNAPSHOT_THROTTLE_MS) return;
    await this.persistState(false);
  }

  private async persistState(force = false) {
    if (!this.state) return;
    if (!force && Date.now() - this.lastSnapshotAt < SNAPSHOT_THROTTLE_MS) return;
    this.lastSnapshotAt = Date.now();
    try { await this.storage.put("roomState", this.state); } catch {}
    await this.env.DB.prepare(
      `INSERT INTO room_snapshots (room_code, state_json) VALUES (?, ?)`
    ).bind(
      this.state.code,
      JSON.stringify(this.state)
    ).run().catch(() => {/* best-effort */});
    await this.scheduleExpiry();
  }

  private async restoreFromSnapshot(code: string): Promise<boolean> {
    const row = await this.env.DB.prepare(
      `SELECT state_json FROM room_snapshots WHERE room_code = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(code).first<{ state_json: string }>();
    if (!row) return false;
    try {
      const parsed = JSON.parse(row.state_json) as RoomState;
      if (Date.now() - parsed.lastActivity > ROOM_IDLE_EXPIRY_MS) return false;
      this.state = parsed;
      return true;
    } catch {
      return false;
    }
  }

  private async scheduleExpiry() {
    if (this.alarmScheduled || !this.state) return;
    try {
      const alarmTime = this.state.lastActivity + ROOM_IDLE_EXPIRY_MS;
      await this.storage.setAlarm(alarmTime);
      this.alarmScheduled = true;
    } catch {}
  }

  async alarm() {
    if (this.state) {
      await this.env.DB.prepare(
        `INSERT INTO room_snapshots (room_code, state_json) VALUES (?, ?)`
      ).bind(this.state.code, JSON.stringify({ ...this.state, expired: true })).run().catch(() => {});
    }
    for (const [ws] of this.connections) {
      try { ws.close(1000, "Sala expirou por inatividade"); } catch {}
    }
    this.connections.clear();
    try { await this.storage.deleteAll(); } catch {}
    this.state = null;
  }

  // ---------- Utilidades ----------
  private sendTo(ws: WebSocket, msg: any) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  private broadcast(msg: any, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const [ws] of this.connections) {
      if (ws === except) continue;
      try { ws.send(data); } catch {}
    }
  }

  private publicState(conn: Connection) {
    if (!this.state) return null;
    return {
      code: this.state.code,
      masterUserId: this.state.masterUserId,
      masterUsername: this.state.masterUsername,
      locked: this.state.locked,
      createdAt: this.state.createdAt,
      characters: Object.values(this.state.characters),
      enemies: Object.values(this.state.enemies),
      diceLog: this.state.diceLog.slice(-50),
      suggestions: this.state.suggestions,
      you: {
        userId: conn.userId,
        username: conn.username,
        isMaster: conn.isMaster,
        characterId: conn.characterId,
      },
    };
  }

  static get ENEMY_PRESETS() { return ENEMY_PRESETS; }
}

// ---------- Helpers ----------
function clampInt(v: any, min: number, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function cryptoRandomId(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}
