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

// Stat flexível (homebrew) — mesmo formato do banco character_stats.
type StatType = "bar" | "number" | "text" | "tag_list" | "checkbox" | "formula";
interface CharacterStat {
  id: number;
  statTemplateId?: number | null;
  isCustom: boolean;
  name: string;
  type: StatType;
  valueCurrent?: number | null;
  valueMax?: number | null;
  valueText?: string | null;
  valueBool?: number | null;
  color?: string | null;
  displayOrder: number;
}

interface CharacterState {
  id: number;
  ownerUserId: number;
  ownerUsername: string;
  name: string;
  photoUrl?: string | null;
  pageId?: number | null;
  stats: CharacterStat[];       // substitui hpCurrent/hpMax/money/bars — tudo é stat
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

interface ChatMessage {
  id: string;
  senderUserId: number;
  senderUsername: string;
  text: string;
  timestamp: number;
}

// ---------- Polls (enquetes em tempo real) ----------
interface PollVote {
  userId: number;
  username: string;
  optionIndex: number;
}
interface PollChatMessage {
  id: string;
  userId: number;
  username: string;
  message: string;
  timestamp: number;
}
interface Poll {
  id: string;
  question: string;
  options: string[];
  createdBy: number;
  createdByName: string;
  isActive: boolean;
  votes: PollVote[];
  chat: PollChatMessage[];
  createdAt: number;
  endedAt?: number;
}

// ---------- Trades (trocas entre jogadores) ----------
interface TradeItem {
  name: string;
  qty: number;
  description?: string;
}
interface TradeOffer {
  items: TradeItem[];
  money?: number;
}
interface Trade {
  id: string;
  roomCode: string;
  proposerUserId: number;
  proposerName: string;
  receiverUserId: number;
  receiverName: string;
  offer: TradeOffer;       // o que o proposer oferece
  request: TradeOffer;     // o que o proposer pede em troca
  status: "pending" | "accepted" | "rejected" | "countered" | "cancelled";
  createdAt: number;
  resolvedAt?: number;
}

// ---------- Purchase Offers (mestre oferece compra a jogador) ----------
interface PurchaseOffer {
  id: string;
  roomCode: string;
  masterUserId: number;
  masterName: string;
  targetUserId: number;
  targetName: string;
  itemName: string;
  itemDescription?: string;
  price: number;
  priceType: string;   // "moedas" | "xp" | ...
  status: "pending" | "accepted" | "rejected" | "expired";
  createdAt: number;
  resolvedAt?: number;
}

// ---------- Level Up Points (mestre faz personagem upar) ----------
interface LevelUpOffer {
  id: string;
  characterId: number;
  characterName: string;
  ownerUserId: number;
  points: number;
  eligibleStats: { statId: number; name: string; }[];
  status: "pending" | "confirmed" | "expired";
  createdAt: number;
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
  chatLog: ChatMessage[];   // mantém últimas ~50 em memória
  // Novos (adicionados em 2026-07-27):
  polls: Poll[];
  trades: Trade[];
  purchaseOffers: PurchaseOffer[];
  levelUpOffers: LevelUpOffer[];
  // Tarefa 4: mapa userId -> ParticipantInfo (cor, characterName, photoUrl)
  participantColors: Record<number, ParticipantInfo>;
  // Tarefa 1: nome amigável da sala (vindo da tabela rooms)
  name?: string;
}

// ---------- Conexão ----------
interface Connection {
  ws: WebSocket;
  userId: number;
  username: string;
  isMaster: boolean;
  characterId?: number;
  color?: string;  // cor escolhida pelo jogador (hex)
  lastMsgAt: number;
}

// Mapa userId -> { color, characterName, photoUrl }
// Atualizado quando jogador seta cor ou quando personagem é atualizado.
interface ParticipantInfo {
  color?: string | null;
  characterName?: string | null;
  photoUrl?: string | null;
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
    const roomName = url.searchParams.get("roomName") ?? "";
    if (!code || !masterUserId) return new Response("code e masterUserId são obrigatórios", { status: 400 });
    if (this.state) return new Response("Sala já inicializada", { status: 409 });
    this.state = {
      code,
      masterUserId,
      masterUsername: decodeURIComponent(masterUsername),
      name: roomName ? decodeURIComponent(roomName) : "Sala",
      locked: false,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      characters: {},
      enemies: {},
      diceLog: [],
      suggestions: [],
      chatLog: [],
      polls: [],
      trades: [],
      purchaseOffers: [],
      levelUpOffers: [],
      participantColors: {
        [masterUserId]: { color: "#b3121c", characterName: null, photoUrl: null },  // mestre tem cor vermelha tema
      },
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
      photoUrl: ch.photoUrl ?? null,
      pageId: ch.pageId ?? null,
      // Stats flexíveis (homebrew) — aceita array de stats vindos do banco
      stats: Array.isArray(ch.stats) ? ch.stats.map(sanitizeStat).filter(Boolean) : [],
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
    // Envia histórico de chat pra o recém-conectado (pra não entrar num chat vazio)
    if (this.state!.chatLog.length > 0) {
      this.sendTo(server, { type: "chat_history", payload: { messages: this.state!.chatLog } });
    }
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
        case "send_chat_message": await this.handleChatMessage(conn, msg.payload); break;
        // ===== Polls (Feature 2) =====
        case "create_poll": await this.handleCreatePoll(conn, msg.payload); break;
        case "vote_poll": await this.handleVotePoll(conn, msg.payload); break;
        case "send_poll_chat": await this.handlePollChat(conn, msg.payload); break;
        case "end_poll": await this.handleEndPoll(conn, msg.payload); break;
        // ===== Trades (Feature 4a) =====
        case "propose_trade": await this.handleProposeTrade(conn, msg.payload); break;
        case "respond_trade": await this.handleRespondTrade(conn, msg.payload); break;
        // ===== Purchase Offers (Feature 4b) =====
        case "create_purchase": await this.handleCreatePurchase(conn, msg.payload); break;
        case "respond_purchase": await this.handleRespondPurchase(conn, msg.payload); break;
        case "accept_purchase": await this.handleRespondPurchase(conn, msg.payload); break; // alias legado
        // ===== Level Up (Feature 4c) =====
        case "set_level_up_points": await this.handleSetLevelUpPoints(conn, msg.payload); break;
        case "distribute_level_points": await this.handleLevelUpPoints(conn, msg.payload); break;
        case "level_up_points": await this.handleLevelUpPoints(conn, msg.payload); break; // alias legado
        // ===== Documentos Secretos (Feature 3) =====
        case "reveal_document": await this.handleRevealDocument(conn, msg.payload); break;
        case "reveal_secret": await this.handleRevealDocument(conn, msg.payload); break; // alias legado
        // ===== Tarefa 4: Cor pessoal do jogador =====
        case "set_player_color": await this.handleSetPlayerColor(conn, msg.payload); break;
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
    // Jogador só pode atualizar stats do próprio personagem (não inventário, não nome).
    // Formato novo: { statId, value } — value depende do tipo daquele stat.
    this.applyStatUpdate(ch, p);
    this.broadcast({ type: "character_updated", payload: ch });
  }

  private async handleUpdateCharacter(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode editar personagens de outros.");
    const id = Number(p?.characterId);
    if (!id || !this.state!.characters[id]) throw new Error("Personagem não encontrado.");
    const ch = this.state!.characters[id];
    // Mestre pode atualizar stat individual OU inventário completo.
    this.applyStatUpdate(ch, p);
    if (Array.isArray(p?.inventory)) {
      ch.inventory = p.inventory.filter((it: any) => it && typeof it.name === "string").map((it: any) => ({
        name: String(it.name).slice(0, 80),
        qty: clampInt(it.qty, 0, 9999),
        description: it.description ? String(it.description).slice(0, 200) : undefined,
      })).slice(0, 100);
    }
    this.broadcast({ type: "character_updated", payload: ch });
  }

  // Aplica update de UM stat (identificado por statId) no personagem.
  // Validações: tipo do stat bate com o campo enviado; bar não passa de max.
  private applyStatUpdate(ch: CharacterState, p: any) {
    const statId = Number(p?.statId);
    if (!statId) throw new Error("statId é obrigatório.");
    const stat = ch.stats.find(s => s.id === statId);
    if (!stat) throw new Error("Status não encontrado neste personagem.");
    const v = p?.value ?? {};
    if (stat.type === "bar" || stat.type === "number") {
      if (typeof v.current === "number" && Number.isFinite(v.current)) {
        let n = v.current;
        if (stat.type === "bar") {
          if (stat.valueMax !== null && stat.valueMax !== undefined && n > stat.valueMax) n = stat.valueMax;
          if (n < 0) n = 0;
        }
        stat.valueCurrent = n;
      }
      if (stat.type === "bar" && typeof v.max === "number" && Number.isFinite(v.max) && v.max >= 0) {
        stat.valueMax = v.max;
        if (stat.valueCurrent !== null && stat.valueCurrent !== undefined && stat.valueCurrent > v.max) {
          stat.valueCurrent = v.max;
        }
      }
    } else if (stat.type === "text" || stat.type === "tag_list" || stat.type === "formula") {
      if (typeof v.text === "string") stat.valueText = v.text.slice(0, 2000);
    } else if (stat.type === "checkbox") {
      if (typeof v.bool === "boolean") stat.valueBool = v.bool ? 1 : 0;
      else if (typeof v.bool === "number") stat.valueBool = v.bool ? 1 : 0;
    }
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

  // ---------- Chat ----------
  // Qualquer participante (mestre ou jogador) pode enviar mensagens.
  // Rate limit já é aplicado em onMessage (1 msg / 300ms por socket).
  // Texto é sanitizado no frontend (DOMPurify) antes de renderizar.
  // Persiste em chat_log (D1) e mantém últimas 50 em memória.
  private async handleChatMessage(conn: Connection, p: any) {
    if (!this.state) return;
    const text = String(p?.text ?? "").trim();
    if (!text) throw new Error("Mensagem vazia.");
    if (text.length > 500) throw new Error("Mensagem muito longa (máx 500 caracteres).");

    const msg: ChatMessage = {
      id: cryptoRandomId(),
      senderUserId: conn.userId,
      senderUsername: conn.username,
      text,
      timestamp: Date.now(),
    };
    this.state.chatLog.push(msg);
    if (this.state.chatLog.length > 50) this.state.chatLog.shift();

    // Persiste em D1 (best-effort)
    await this.env.DB.prepare(
      `INSERT INTO chat_log (room_code, sender_user_id, message) VALUES (?, ?, ?)`
    ).bind(this.state.code, conn.userId, text).run().catch(() => {});

    this.broadcast({ type: "chat_message", payload: msg });
  }

  // ============================================================
  // POLLs (Feature 2) — enquetes em tempo real via WebSocket
  // ============================================================
  // Qualquer participante pode criar. Votos são upsert (último vale).
  // Chat dedicado dentro da poll. Criador ou mestre encerra.

  private async handleCreatePoll(conn: Connection, p: any) {
    if (!this.state) return;
    const question = String(p?.question ?? "").trim();
    const options: string[] = Array.isArray(p?.options)
      ? p.options.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 5)
      : [];
    if (!question) throw new Error("Pergunta é obrigatória.");
    if (question.length > 200) throw new Error("Pergunta muito longa (máx 200).");
    if (options.length < 2 || options.length > 5) throw new Error("Precisa entre 2 e 5 opções.");

    const poll: Poll = {
      id: cryptoRandomId(),
      question: question.slice(0, 200),
      options: options.map(o => o.slice(0, 100)),
      createdBy: conn.userId,
      createdByName: conn.username,
      isActive: true,
      votes: [],
      chat: [],
      createdAt: Date.now(),
    };
    this.state.polls.push(poll);
    if (this.state.polls.length > 20) this.state.polls.shift();

    // Persiste em D1 (best-effort) — tabela polls
    try {
      const result = await this.env.DB.prepare(
        `INSERT INTO polls (room_code, question, options_json, created_by_user_id) VALUES (?, ?, ?, ?)`
      ).bind(this.state.code, poll.question, JSON.stringify(poll.options), conn.userId).run();
      // Vincula o id interno do banco ao poll (para votos e chat)
      if (result.meta?.last_row_id) {
        (poll as any).dbId = result.meta.last_row_id;
      }
    } catch {}

    this.broadcast({ type: "poll_created", payload: poll });
  }

  private async handleVotePoll(conn: Connection, p: any) {
    if (!this.state) return;
    const pollId = String(p?.pollId ?? "");
    const optionIndex = Number(p?.optionIndex);
    const poll = this.state.polls.find(pl => pl.id === pollId);
    if (!poll) throw new Error("Poll não encontrada.");
    if (!poll.isActive) throw new Error("Poll já encerrada.");
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
      throw new Error("Opção inválida.");
    }
    // Upsert voto (remove voto anterior do mesmo usuário)
    poll.votes = poll.votes.filter(v => v.userId !== conn.userId);
    poll.votes.push({ userId: conn.userId, username: conn.username, optionIndex });

    // Persiste em D1 (best-effort)
    if ((poll as any).dbId) {
      try {
        await this.env.DB.batch([
          this.env.DB.prepare(`DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?`)
            .bind((poll as any).dbId, conn.userId),
          this.env.DB.prepare(`INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES (?, ?, ?)`)
            .bind((poll as any).dbId, conn.userId, optionIndex),
        ]);
      } catch {}
    }

    this.broadcast({ type: "poll_updated", payload: poll });
  }

  private async handlePollChat(conn: Connection, p: any) {
    if (!this.state) return;
    const pollId = String(p?.pollId ?? "");
    const message = String(p?.message ?? "").trim();
    if (!message) throw new Error("Mensagem vazia.");
    if (message.length > 500) throw new Error("Mensagem muito longa (máx 500).");
    const poll = this.state.polls.find(pl => pl.id === pollId);
    if (!poll) throw new Error("Poll não encontrada.");
    if (!poll.isActive) throw new Error("Poll encerrada — chat fechado.");

    const chatMsg: PollChatMessage = {
      id: cryptoRandomId(),
      userId: conn.userId,
      username: conn.username,
      message,
      timestamp: Date.now(),
    };
    poll.chat.push(chatMsg);
    if (poll.chat.length > 50) poll.chat.shift();

    // Persiste em D1 (best-effort)
    if ((poll as any).dbId) {
      try {
        await this.env.DB.prepare(
          `INSERT INTO poll_chat_messages (poll_id, user_id, message) VALUES (?, ?, ?)`
        ).bind((poll as any).dbId, conn.userId, message).run();
      } catch {}
    }

    this.broadcast({ type: "poll_chat", payload: { pollId, ...chatMsg } });
  }

  private async handleEndPoll(conn: Connection, p: any) {
    if (!this.state) return;
    const pollId = String(p?.pollId ?? "");
    const poll = this.state.polls.find(pl => pl.id === pollId);
    if (!poll) throw new Error("Poll não encontrada.");
    if (!poll.isActive) throw new Error("Poll já encerrada.");
    // Só criador ou mestre pode encerrar
    if (poll.createdBy !== conn.userId && !conn.isMaster) {
      throw new Error("Apenas o criador ou o mestre pode encerrar a poll.");
    }
    poll.isActive = false;
    poll.endedAt = Date.now();

    // Persiste em D1 (best-effort)
    if ((poll as any).dbId) {
      try {
        await this.env.DB.prepare(`UPDATE polls SET ended_at = datetime('now') WHERE id = ?`)
          .bind((poll as any).dbId).run();
      } catch {}
    }

    this.broadcast({ type: "poll_ended", payload: poll });
  }

  // ============================================================
  // TRADES (Feature 4a) — trocas entre jogadores
  // ============================================================
  // Jogador propõe troca de itens/dinheiro com outro.
  // Receiver recebe notificação via WS e aceita/recusa.

  private async handleProposeTrade(conn: Connection, p: any) {
    if (!this.state) return;
    if (conn.isMaster) throw new Error("Mestre não propõe trocas.");
    if (!conn.characterId) throw new Error("Você precisa estar conectado com um personagem.");
    const targetUserId = Number(p?.targetUserId);
    if (!targetUserId) throw new Error("targetUserId é obrigatório.");
    if (targetUserId === conn.userId) throw new Error("Não pode trocar com você mesmo.");

    // Valida offer/request
    const offer = this.validateTradeOffer(p?.offer);
    const request = this.validateTradeOffer(p?.request);
    if (offer.items.length === 0 && !offer.money && request.items.length === 0 && !request.money) {
      throw new Error("Troca vazia — precisa oferecer ou pedir algo.");
    }

    // Acha o personagem alvo (para pegar o nome do receiver)
    let receiverName = "jogador";
    const receiverChars = Object.values(this.state.characters).filter(c => c.ownerUserId === targetUserId);
    if (receiverChars.length > 0) receiverName = receiverChars[0].ownerUsername;

    const trade: Trade = {
      id: cryptoRandomId(),
      roomCode: this.state.code,
      proposerUserId: conn.userId,
      proposerName: conn.username,
      receiverUserId: targetUserId,
      receiverName,
      offer,
      request,
      status: "pending",
      createdAt: Date.now(),
    };
    this.state.trades.push(trade);
    if (this.state.trades.length > 30) this.state.trades.shift();

    // Persiste em D1 (best-effort)
    try {
      const result = await this.env.DB.prepare(
        `INSERT INTO trades (room_code, proposer_user_id, receiver_user_id, status, offer_json, request_json)
         VALUES (?, ?, ?, 'pending', ?, ?)`
      ).bind(
        this.state.code, conn.userId, targetUserId,
        JSON.stringify(offer), JSON.stringify(request)
      ).run();
      if (result.meta?.last_row_id) (trade as any).dbId = result.meta.last_row_id;
    } catch {}

    // Notifica o receiver diretamente + todos pra sincronizar estado
    this.broadcast({ type: "trade_proposed", payload: trade });
  }

  private validateTradeOffer(o: any): TradeOffer {
    if (!o || typeof o !== "object") return { items: [] };
    const items: TradeItem[] = Array.isArray(o.items)
      ? o.items.filter((it: any) => it && typeof it.name === "string")
          .map((it: any) => ({
            name: String(it.name).slice(0, 80),
            qty: clampInt(it.qty, 1, 9999),
            description: it.description ? String(it.description).slice(0, 200) : undefined,
          })).slice(0, 50)
      : [];
    const money = typeof o.money === "number" && Number.isFinite(o.money) && o.money >= 0
      ? Math.floor(o.money) : undefined;
    return { items, money };
  }

  private async handleRespondTrade(conn: Connection, p: any) {
    if (!this.state) return;
    const tradeId = String(p?.tradeId ?? "");
    const action = String(p?.action ?? (p?.accept ? "accept" : "reject")).toLowerCase();
    // action pode ser: "accept" | "reject" | "counter"
    const trade = this.state.trades.find(t => t.id === tradeId);
    if (!trade) throw new Error("Troca não encontrada.");
    if (trade.status !== "pending") throw new Error(`Troca já ${trade.status}.`);
    if (trade.receiverUserId !== conn.userId && !conn.isMaster) {
      throw new Error("Apenas o receiver pode responder.");
    }

    if (action === "accept") {
      trade.status = "accepted";
      trade.resolvedAt = Date.now();
      // Aplica a troca nos personagens (move itens/dinheiro)
      this.applyTradeEffects(trade);
    } else if (action === "reject") {
      trade.status = "rejected";
      trade.resolvedAt = Date.now();
    } else if (action === "counter") {
      // Contraproposta: receiver envia nova offer/request e vira proposer da nova troca
      const counterOffer = this.validateTradeOffer(p?.offer);
      const counterRequest = this.validateTradeOffer(p?.request);
      if (counterOffer.items.length === 0 && !counterOffer.money && counterRequest.items.length === 0 && !counterRequest.money) {
        throw new Error("Contraproposta vazia — precisa oferecer ou pedir algo.");
      }
      // Marca a troca original como countered
      trade.status = "countered";
      trade.resolvedAt = Date.now();
      // Cria uma nova troca invertendo os papéis (receiver vira proposer)
      const newTrade: Trade = {
        id: cryptoRandomId(),
        roomCode: this.state.code,
        proposerUserId: trade.receiverUserId,
        proposerName: trade.receiverName,
        receiverUserId: trade.proposerUserId,
        receiverName: trade.proposerName,
        offer: counterOffer,
        request: counterRequest,
        status: "pending",
        createdAt: Date.now(),
      };
      this.state.trades.push(newTrade);
      if (this.state.trades.length > 30) this.state.trades.shift();
      // Persiste a nova troca (best-effort)
      try {
        const result = await this.env.DB.prepare(
          `INSERT INTO trades (room_code, proposer_user_id, receiver_user_id, status, offer_json, request_json)
           VALUES (?, ?, ?, 'pending', ?, ?)`
        ).bind(
          this.state.code, newTrade.proposerUserId, newTrade.receiverUserId,
          JSON.stringify(newTrade.offer), JSON.stringify(newTrade.request)
        ).run();
        if (result.meta?.last_row_id) (newTrade as any).dbId = result.meta.last_row_id;
      } catch {}
      // Broadcast da nova troca
      this.broadcast({ type: "trade_proposed", payload: newTrade });
    } else {
      throw new Error(`Ação inválida: ${action}. Use accept, reject ou counter.`);
    }

    // Persiste em D1 (best-effort)
    if ((trade as any).dbId) {
      try {
        await this.env.DB.prepare(
          `UPDATE trades SET status = ?, resolved_at = datetime('now') WHERE id = ?`
        ).bind(trade.status, (trade as any).dbId).run();
      } catch {}
    }

    this.broadcast({ type: "trade_updated", payload: trade });
    // Notifica via chat também (sistema)
    const actionLabel = action === "accept" ? "aceita" : action === "reject" ? "recusada" : "contraproposta";
    const sysMsg: ChatMessage = {
      id: cryptoRandomId(),
      senderUserId: 0,
      senderUsername: "sistema",
      text: `🤝 Troca ${actionLabel}: ${trade.proposerName} ↔ ${trade.receiverName}`,
      timestamp: Date.now(),
    };
    this.state.chatLog.push(sysMsg);
    if (this.state.chatLog.length > 50) this.state.chatLog.shift();
    this.broadcast({ type: "chat_message", payload: sysMsg });
  }

  // Move itens/dinheiro entre personagens após troca aceita.
  // Nota: no modelo homebrew, itens ficam em ch.inventory[] (array de {name, qty, description}).
  // "money" é tratado como stat separado (se existir) — buscamos por nome.
  private applyTradeEffects(trade: Trade) {
    const proposerChars = Object.values(this.state!.characters).filter(c => c.ownerUserId === trade.proposerUserId);
    const receiverChars = Object.values(this.state!.characters).filter(c => c.ownerUserId === trade.receiverUserId);
    if (proposerChars.length === 0 || receiverChars.length === 0) return;
    const proposerCh = proposerChars[0];
    const receiverCh = receiverChars[0];

    // Move itens do proposer -> receiver
    for (const item of trade.offer.items) {
      // Remove do proposer (subtrai qty; se chegar a 0, remove)
      const propItem = proposerCh.inventory.find(it => it.name === item.name);
      if (propItem) {
        propItem.qty = Math.max(0, propItem.qty - item.qty);
        if (propItem.qty === 0) {
          proposerCh.inventory = proposerCh.inventory.filter(it => it !== propItem);
        }
      }
      // Adiciona no receiver
      const recvItem = receiverCh.inventory.find(it => it.name === item.name);
      if (recvItem) {
        recvItem.qty += item.qty;
      } else {
        receiverCh.inventory.push({ name: item.name, qty: item.qty, description: item.description });
      }
    }

    // Move itens do receiver -> proposer (request)
    for (const item of trade.request.items) {
      const recvItem = receiverCh.inventory.find(it => it.name === item.name);
      if (recvItem) {
        recvItem.qty = Math.max(0, recvItem.qty - item.qty);
        if (recvItem.qty === 0) {
          receiverCh.inventory = receiverCh.inventory.filter(it => it !== recvItem);
        }
      }
      const propItem = proposerCh.inventory.find(it => it.name === item.name);
      if (propItem) {
        propItem.qty += item.qty;
      } else {
        proposerCh.inventory.push({ name: item.name, qty: item.qty, description: item.description });
      }
    }

    // Move dinheiro (stat name "Dinheiro" ou "Money")
    if (trade.offer.money && trade.offer.money > 0) {
      this.transferMoney(proposerCh, receiverCh, trade.offer.money);
    }
    if (trade.request.money && trade.request.money > 0) {
      this.transferMoney(receiverCh, proposerCh, trade.request.money);
    }

    // Broadcast update dos personagens afetados
    this.broadcast({ type: "character_updated", payload: proposerCh });
    this.broadcast({ type: "character_updated", payload: receiverCh });
  }

  // Procura um stat do tipo "number" com nome "Dinheiro" (case-insensitive).
  // No modelo homebrew, dinheiro é um stat como outro qualquer.
  private transferMoney(from: CharacterState, to: CharacterState, amount: number) {
    const moneyNames = ["dinheiro", "moedas", "gold", "ouro", "money"];
    const fromStat = from.stats.find(s => s.type === "number" && moneyNames.includes(s.name.toLowerCase()));
    const toStat = to.stats.find(s => s.type === "number" && moneyNames.includes(s.name.toLowerCase()));
    if (!fromStat || !toStat) return;  // sem stat de dinheiro definido — silenciosamente pula
    const cur = Number(fromStat.valueCurrent ?? 0);
    const transfer = Math.min(cur, amount);
    fromStat.valueCurrent = cur - transfer;
    toStat.valueCurrent = Number(toStat.valueCurrent ?? 0) + transfer;
  }

  // ============================================================
  // PURCHASE OFFERS (Feature 4b) — mestre oferece compra a jogador
  // ============================================================
  private async handleCreatePurchase(conn: Connection, p: any) {
    if (!this.state) return;
    if (!conn.isMaster) throw new Error("Apenas o mestre pode oferecer compras.");
    const targetUserId = Number(p?.targetUserId);
    if (!targetUserId) throw new Error("targetUserId é obrigatório.");
    const itemName = String(p?.itemName ?? "").trim();
    if (!itemName) throw new Error("Nome do item é obrigatório.");
    if (itemName.length > 80) throw new Error("Nome muito longo (máx 80).");
    const itemDescription = p?.itemDescription ? String(p.itemDescription).slice(0, 200) : undefined;
    const price = clampInt(p?.price, 0, 9999999);
    const priceType = String(p?.priceType ?? "moedas").slice(0, 20);

    // Acha nome do receiver
    let targetName = "jogador";
    const targetChars = Object.values(this.state.characters).filter(c => c.ownerUserId === targetUserId);
    if (targetChars.length > 0) targetName = targetChars[0].ownerUsername;

    const offer: PurchaseOffer = {
      id: cryptoRandomId(),
      roomCode: this.state.code,
      masterUserId: conn.userId,
      masterName: conn.username,
      targetUserId,
      targetName,
      itemName: itemName.slice(0, 80),
      itemDescription,
      price,
      priceType,
      status: "pending",
      createdAt: Date.now(),
    };
    this.state.purchaseOffers.push(offer);
    if (this.state.purchaseOffers.length > 30) this.state.purchaseOffers.shift();

    // Persiste em D1 (best-effort)
    try {
      const result = await this.env.DB.prepare(
        `INSERT INTO purchase_offers (room_code, target_user_id, item_name, item_description, price, price_type, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`
      ).bind(this.state.code, targetUserId, offer.itemName, itemDescription ?? null, price, priceType).run();
      if (result.meta?.last_row_id) (offer as any).dbId = result.meta.last_row_id;
    } catch {}

    this.broadcast({ type: "purchase_offer", payload: offer });
  }

  private async handleRespondPurchase(conn: Connection, p: any) {
    if (!this.state) return;
    const offerId = String(p?.offerId ?? "");
    const accept = !!p?.accept;
    const offer = this.state.purchaseOffers.find(o => o.id === offerId);
    if (!offer) throw new Error("Oferta não encontrada.");
    if (offer.status !== "pending") throw new Error(`Oferta já ${offer.status}.`);
    if (offer.targetUserId !== conn.userId) {
      throw new Error("Apenas o jogador alvo pode responder.");
    }
    offer.status = accept ? "accepted" : "rejected";
    offer.resolvedAt = Date.now();

    // Se aceita: debita preço do personagem e adiciona item no inventário
    if (accept) {
      const targetChars = Object.values(this.state.characters).filter(c => c.ownerUserId === offer.targetUserId);
      if (targetChars.length > 0) {
        const ch = targetChars[0];
        // Debita preço (procura stat de dinheiro)
        if (offer.price > 0) {
          const moneyNames = ["dinheiro", "moedas", "gold", "ouro", "money"];
          const moneyStat = ch.stats.find(s => s.type === "number" && moneyNames.includes(s.name.toLowerCase()));
          if (moneyStat) {
            const cur = Number(moneyStat.valueCurrent ?? 0);
            // Se XP, procura stat de XP
            if (offer.priceType === "xp") {
              const xpStat = ch.stats.find(s => s.type === "number" && s.name.toLowerCase() === "xp");
              if (xpStat) {
                xpStat.valueCurrent = Number(xpStat.valueCurrent ?? 0) - offer.price;
              }
            } else {
              moneyStat.valueCurrent = Math.max(0, cur - offer.price);
            }
          }
        }
        // Adiciona item ao inventário
        const existing = ch.inventory.find(it => it.name === offer.itemName);
        if (existing) {
          existing.qty += 1;
        } else {
          ch.inventory.push({ name: offer.itemName, qty: 1, description: offer.itemDescription });
        }
        this.broadcast({ type: "character_updated", payload: ch });
      }
    }

    // Persiste em D1 (best-effort)
    if ((offer as any).dbId) {
      try {
        await this.env.DB.prepare(
          `UPDATE purchase_offers SET status = ? WHERE id = ?`
        ).bind(offer.status, (offer as any).dbId).run();
      } catch {}
    }

    this.broadcast({ type: "purchase_updated", payload: offer });
    // Notifica via chat (sistema)
    const sysMsg: ChatMessage = {
      id: cryptoRandomId(),
      senderUserId: 0,
      senderUsername: "sistema",
      text: `🛒 ${offer.targetName} ${accept ? "comprou" : "recusou"}: ${offer.itemName} (${offer.price} ${offer.priceType})`,
      timestamp: Date.now(),
    };
    this.state.chatLog.push(sysMsg);
    if (this.state.chatLog.length > 50) this.state.chatLog.shift();
    this.broadcast({ type: "chat_message", payload: sysMsg });
  }

  // ============================================================
  // LEVEL UP POINTS (Feature 4c) — jogador distribui pontos
  // ============================================================
  // Fluxo completo:
  //   1. Mestre envia "set_level_up_points" com { characterId, points }
  //      → RoomDO cria um LevelUpOffer, envia "level_up_available" só pro
  //        dono do personagem (broadcast mas cada client filtra por ownerUserId)
  //   2. Jogador abre o modal (levelup.js), distribui pontos, envia
  //      "distribute_level_points" (ou alias "level_up_points") com { characterId, allocations }
  //   3. RoomDO valida, aplica nos stats do tipo "number", broadcast character_updated

  private async handleSetLevelUpPoints(conn: Connection, p: any) {
    if (!this.state) return;
    if (!conn.isMaster) throw new Error("Apenas o mestre pode conceder pontos de level up.");
    const characterId = Number(p?.characterId);
    if (!characterId) throw new Error("characterId é obrigatório.");
    const ch = this.state.characters[characterId];
    if (!ch) throw new Error("Personagem não encontrado na sala.");
    const points = clampInt(p?.points, 1, 100);
    if (points <= 0) throw new Error("points deve ser maior que 0.");

    // Stats elegíveis: tipo "number" do personagem
    const eligibleStats = ch.stats
      .filter(s => s.type === "number")
      .map(s => ({ statId: s.id, name: s.name }));

    if (eligibleStats.length === 0) {
      throw new Error("Este personagem não tem status do tipo 'number' para distribuir pontos.");
    }

    const offer: LevelUpOffer = {
      id: cryptoRandomId(),
      characterId,
      characterName: ch.name,
      ownerUserId: ch.ownerUserId,
      points,
      eligibleStats,
      status: "pending",
      createdAt: Date.now(),
    };
    this.state.levelUpOffers.push(offer);
    if (this.state.levelUpOffers.length > 20) this.state.levelUpOffers.shift();

    // Broadcast pra todos — cada client verifica se é o dono e abre o modal
    this.broadcast({ type: "level_up_available", payload: offer });

    // Notifica via chat (sistema) — todo mundo vê
    const sysMsg: ChatMessage = {
      id: cryptoRandomId(),
      senderUserId: 0,
      senderUsername: "sistema",
      text: `🎉 ${ch.name} recebeu ${points} pontos de atributo pra distribuir!`,
      timestamp: Date.now(),
    };
    this.state.chatLog.push(sysMsg);
    if (this.state.chatLog.length > 50) this.state.chatLog.shift();
    this.broadcast({ type: "chat_message", payload: sysMsg });
  }

  // Handler chamado pelo JOGADOR pra CONFIRMAR a distribuição de pontos.
  // Recebe allocations = { statId: delta, statId: delta, ... }
  private async handleLevelUpPoints(conn: Connection, p: any) {
    if (!this.state) return;
    if (!conn.characterId) throw new Error("Você precisa estar conectado com um personagem.");
    const ch = this.state.characters[conn.characterId];
    if (!ch) throw new Error("Personagem não encontrado.");

    const allocations = p?.allocations;
    if (!allocations || typeof allocations !== "object") throw new Error("allocations inválido.");

    // Aplica cada alocação
    for (const statIdStr of Object.keys(allocations)) {
      const statId = Number(statIdStr);
      const delta = Number(allocations[statIdStr]);
      if (!Number.isInteger(delta) || delta < 0) continue;
      const stat = ch.stats.find(s => s.id === statId);
      if (!stat || stat.type !== "number") continue;
      stat.valueCurrent = Number(stat.valueCurrent ?? 0) + delta;
    }

    this.broadcast({ type: "character_updated", payload: ch });

    // Notifica via chat
    const sysMsg: ChatMessage = {
      id: cryptoRandomId(),
      senderUserId: 0,
      senderUsername: "sistema",
      text: `🎉 ${ch.name} distribuiu pontos de atributo!`,
      timestamp: Date.now(),
    };
    this.state.chatLog.push(sysMsg);
    if (this.state.chatLog.length > 50) this.state.chatLog.shift();
    this.broadcast({ type: "chat_message", payload: sysMsg });
  }

  // ============================================================
  // REVEAL DOCUMENT (Feature 3) — mestre revela documento secreto
  // ============================================================
  // O mestre chama a API REST /api/pages/:slug/reveal primeiro (pra
  // marcar revealed=1 no banco) e DEPOIS envia este WS pra todos
  // verem a animação simultaneamente.
  // Nome do evento = "reveal_document" (renomeado de "reveal_secret").
  // Mantemos alias "reveal_secret" legado no switch de onMessage.
  private async handleRevealDocument(conn: Connection, p: any) {
    if (!this.state) return;
    if (!conn.isMaster) throw new Error("Apenas o mestre pode revelar documentos secretos.");
    const slug = String(p?.slug ?? "").trim();
    if (!slug) throw new Error("slug é obrigatório.");
    const title = String(p?.title ?? slug).slice(0, 200);
    const contentHtml = String(p?.contentHtml ?? "").slice(0, 50000);  // já vem sanitizado do front
    const animation = ["envelope", "carta", "pergaminho", "bau", "livro"].includes(p?.animation)
      ? p.animation : "pergaminho";

    this.broadcast({
      type: "reveal_document",
      payload: { slug, title, contentHtml, animation, revealedBy: conn.username },
    });
  }

  // ============================================================
  // TAREFA 4: Cor pessoal do jogador
  // ============================================================
  // Jogador envia { color: "#rrggbb" } — valida formato, armazena no
  // estado participantColors[userId], atualiza a Connection, faz broadcast
  // pra todos atualizarem chat/ficha/dado.
  // Persiste em session_participants.color (D1) pra restaurar ao reconectar.
  private async handleSetPlayerColor(conn: Connection, p: any) {
    if (!this.state) return;
    const color = String(p?.color ?? "").trim();
    // Valida hex #rrggbb
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      throw new Error("Cor inválida — use formato #rrggbb (ex: #a855f7).");
    }
    conn.color = color;
    if (!this.state.participantColors) this.state.participantColors = {};
    // Preserva characterName/photoUrl se já existir
    const existing = this.state.participantColors[conn.userId] || {};
    this.state.participantColors[conn.userId] = {
      ...existing,
      color,
      characterName: existing.characterName || (conn.characterId ? this.state.characters[conn.characterId]?.name : null),
      photoUrl: existing.photoUrl || (conn.characterId ? this.state.characters[conn.characterId]?.photoUrl : null),
    };

    // Persiste em session_participants (upsert) — best-effort
    try {
      if (conn.characterId) {
        await this.env.DB.prepare(
          `INSERT INTO session_participants (room_code, user_id, character_id, color)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(room_code, user_id) DO UPDATE SET color = ?`
        ).bind(this.state.code, conn.userId, conn.characterId, color, color).run();
      }
    } catch {}

    this.broadcast({
      type: "player_color_set",
      payload: { userId: conn.userId, username: conn.username, color, characterId: conn.characterId },
    });
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
      // Se chatLog não estava no snapshot (snapshot antigo), inicializa vazio
      // e carrega do D1 as últimas 50 mensagens.
      if (!Array.isArray(parsed.chatLog)) parsed.chatLog = [];
      // Compat: snapshots antigos não têm polls/trades/etc.
      if (!Array.isArray(parsed.polls)) parsed.polls = [];
      if (!Array.isArray(parsed.trades)) parsed.trades = [];
      if (!Array.isArray(parsed.purchaseOffers)) parsed.purchaseOffers = [];
      if (!Array.isArray(parsed.levelUpOffers)) parsed.levelUpOffers = [];
      if (!parsed.participantColors) parsed.participantColors = {};
      if (!parsed.name) parsed.name = "Sala";
      if (parsed.chatLog.length === 0) {
        const chatRows = await this.env.DB.prepare(
          `SELECT cl.id, cl.sender_user_id, cl.message, cl.created_at, u.username
           FROM chat_log cl LEFT JOIN users u ON u.id = cl.sender_user_id
           WHERE cl.room_code = ? ORDER BY cl.created_at DESC LIMIT 50`
        ).bind(code).all<any>();
        if (chatRows.results) {
          parsed.chatLog = chatRows.results.reverse().map((r: any) => ({
            id: String(r.id),
            senderUserId: r.sender_user_id,
            senderUsername: r.username ?? "desconhecido",
            text: r.message,
            timestamp: new Date(r.created_at.replace(" ", "T") + "Z").getTime(),
          }));
        }
      }
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
      name: this.state.name || "Sala",
      masterUserId: this.state.masterUserId,
      masterUsername: this.state.masterUsername,
      locked: this.state.locked,
      createdAt: this.state.createdAt,
      characters: Object.values(this.state.characters),
      enemies: Object.values(this.state.enemies),
      diceLog: this.state.diceLog.slice(-50),
      suggestions: this.state.suggestions,
      chatLog: this.state.chatLog.slice(-50),
      // Novos campos (Feature 2, 4):
      polls: this.state.polls,
      trades: this.state.trades,
      purchaseOffers: this.state.purchaseOffers,
      levelUpOffers: this.state.levelUpOffers,
      // Tarefa 4: mapa userId -> { color, characterName, photoUrl }
      participantColors: this.state.participantColors || {},
      you: {
        userId: conn.userId,
        username: conn.username,
        isMaster: conn.isMaster,
        characterId: conn.characterId,
        color: conn.color,
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

// Sanitiza um stat vindo do cliente/banco pro formato CharacterStat do RoomDO.
// Devolve null se inválido (caller filtra).
function sanitizeStat(s: any): CharacterStat | null {
  if (!s || typeof s.name !== "string") return null;
  const validTypes = new Set(["bar", "number", "text", "tag_list", "checkbox", "formula"]);
  if (!validTypes.has(s.type)) return null;
  return {
    id: Number(s.id),
    statTemplateId: s.statTemplateId ? Number(s.statTemplateId) : null,
    isCustom: !!s.isCustom,
    name: String(s.name).slice(0, 50),
    type: s.type,
    valueCurrent: s.valueCurrent !== null && s.valueCurrent !== undefined ? Number(s.valueCurrent) : null,
    valueMax: s.valueMax !== null && s.valueMax !== undefined ? Number(s.valueMax) : null,
    valueText: s.valueText ? String(s.valueText).slice(0, 2000) : null,
    valueBool: s.valueBool ? 1 : 0,
    color: s.color && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : null,
    displayOrder: Number(s.displayOrder ?? 0),
  };
}
