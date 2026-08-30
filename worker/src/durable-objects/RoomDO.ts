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
interface InventoryItem { name: string; qty: number; description?: string; equipped?: boolean; iconUrl?: string | null; }
interface StatusEffect { id: string; text: string; }
interface SoundboardTrack {
  id: string;
  title: string;
  category: string;
  url: string;
  publicId?: string | null;
  format?: string | null;
  duration?: number | null;
  createdBy: number;
  createdByName: string;
  createdAt: number;
}

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
  playerEditable?: boolean;  // Migration 0013: se true, o jogador dono pode editar este stat
}

interface CharacterState {
  id: number;
  ownerUserId: number;
  ownerUsername: string;
  name: string;
  photoUrl?: string | null;
  symbolUrl?: string | null;
  pageId?: number | null;
  stats: CharacterStat[];       // substitui hpCurrent/hpMax/money/bars — tudo é stat
  inventory: InventoryItem[];
  statusEffects: StatusEffect[];
}

type EnemyHpMode = "numeric" | "description";
// Stat de inimigo avançado (mesmo formato de CharacterStat, mas sem statTemplateId).
type EnemyStatType = "bar" | "number" | "text" | "tag_list" | "checkbox" | "formula";
interface EnemyStat {
  id: string;
  name: string;
  type: EnemyStatType;
  valueCurrent?: number | null;
  valueMax?: number | null;
  valueText?: string | null;
  valueBool?: number | null;
  color?: string | null;
  displayOrder: number;
}
interface EnemyState {
  id: string;
  name: string;
  kind: "filler" | "complex";
  hpMode: EnemyHpMode;
  hpCurrent?: number;
  hpMax?: number;
  description?: string;
  statusEffects: StatusEffect[];
  illustrationUrl?: string | null;  // v12: ilustração do inimigo (upload ou desenho)
  stats?: EnemyStat[];              // v12: stats avançados do inimigo (NPC completo)
}

interface NpcState {
  id: string;
  name: string;
  description?: string;
  photoUrl?: string | null;
  stats: EnemyStat[];
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
  senderDisplayName?: string;  // Tarefa 4: nome do personagem (ou "Mestre"/"Espectador")
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
  proposerCharacterId?: number;
  receiverCharacterId?: number;
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

// ---------- Item Proposals (jogador propõe item → mestre aprova) ----------
// v12: fluxo colaborativo de criação de itens. Jogador usa a mesma interface
// de criação de itens do mestre, mas em vez de salvar direto, envia proposta.
// Mestre aprova → item vai pro inventário do personagem do jogador.
interface ItemProposal {
  id: string;
  fromUserId: number;
  fromUsername: string;
  characterId: number;      // personagem alvo (dono da proposta)
  characterName: string;
  item: {
    name: string;
    qty: number;
    description?: string;
    equipped?: boolean;
    iconUrl?: string | null;
  };
  status: "pending" | "approved" | "rejected";
  masterNote?: string;      // feedback opcional do mestre
  createdAt: number;
  resolvedAt?: number;
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
  npcs: Record<string, NpcState>;
  diceLog: DiceLogEntry[];
  suggestions: SuggestedFormula[];
  chatLog: ChatMessage[];   // mantém últimas ~50 em memória
  // Novos (adicionados em 2026-07-27):
  polls: Poll[];
  trades: Trade[];
  purchaseOffers: PurchaseOffer[];
  levelUpOffers: LevelUpOffer[];
  itemProposals: ItemProposal[];  // v12: propostas de itens (jogador → mestre)
  soundboard: SoundboardTrack[];  // faixas persistentes da mesa, hospedadas no Cloudinary
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
  isSpectator: boolean;  // Tarefa 1: espectador não tem personagem, só assiste
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
          if (!stored.npcs || typeof stored.npcs !== "object") stored.npcs = {};
          if (!Array.isArray(stored.soundboard)) stored.soundboard = [];
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
    if (url.pathname.endsWith("/purge") && request.method === "POST") {
      // Exclusão definitiva: não persiste um snapshot novo, pois a rota REST
      // apagará os registros do banco logo depois deste cleanup.
      await this.purgeRoomInternal();
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
      npcs: {},
      diceLog: [],
      suggestions: [],
      chatLog: [],
      polls: [],
      trades: [],
      purchaseOffers: [],
      levelUpOffers: [],
      itemProposals: [],
      soundboard: [],
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
      symbolUrl: ch.symbolUrl ?? null,
      pageId: ch.pageId ?? null,
      // Stats flexíveis (homebrew) — aceita array de stats vindos do banco
      stats: Array.isArray(ch.stats) ? ch.stats.map(sanitizeStat).filter(Boolean) : [],
      inventory: Array.isArray(ch.inventory) ? ch.inventory.slice(0, 100) : [],
      statusEffects: Array.isArray(ch.statusEffects) ? ch.statusEffects.slice(0, 50) : [],
    };
    await this.persistState(true);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  // Permite ao mestre colocar um personagem previamente criado na sala,
  // mesmo quando o dono ainda não entrou (ou nem está online).
  private async handleAddCharacterByMaster(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode adicionar personagens à sala.");
    const id = Number(p?.characterId);
    if (!id) throw new Error("characterId é obrigatório.");
    if (this.state!.characters[id]) throw new Error("Esse personagem já está na sala.");
    const r = await this.env.DB.prepare(
      `SELECT c.id, c.owner_user_id, c.name, c.photo_url, c.symbol_url, c.page_id,
              c.inventory_json, c.status_effects_json, u.username AS owner_username
       FROM characters c JOIN users u ON u.id = c.owner_user_id WHERE c.id = ?`
    ).bind(id).first<any>();
    if (!r) throw new Error("Personagem não encontrado.");
    const stats = await this.env.DB.prepare(
      `SELECT id, stat_template_id, is_custom, name, type, value_current, value_max, value_text, value_bool, color, display_order, player_editable
       FROM character_stats WHERE character_id = ? ORDER BY display_order ASC, id ASC`
    ).bind(id).all<any>();
    const ch: CharacterState = {
      id: Number(r.id), ownerUserId: Number(r.owner_user_id), ownerUsername: r.owner_username ?? "",
      name: String(r.name).slice(0, 100), photoUrl: r.photo_url ?? null, symbolUrl: r.symbol_url ?? null,
      pageId: r.page_id ?? null,
      stats: (stats.results || []).map((s: any) => sanitizeStat(s)).filter(Boolean) as CharacterStat[],
      inventory: sanitizeInventory(safeJson(r.inventory_json, [])),
      statusEffects: safeJson(r.status_effects_json, []),
    };
    this.state!.characters[id] = ch;
    await this.persistState(true);
    this.broadcast({ type: "character_updated", payload: ch });
    this.broadcastParticipantsList();
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

  private async purgeRoomInternal() {
    if (this.state) {
      this.broadcast({ type: "room_closed", payload: { reason: "Sala excluída pelo mestre." } });
    }
    for (const [ws] of this.connections) {
      try { ws.close(1000, "Sala excluída"); } catch {}
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
    const isSpectator = url.searchParams.get("isSpectator") === "1" || url.searchParams.get("isSpectator") === "true";

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
    if (!isMaster && characterId && !isSpectator) {
      const owner = await this.env.DB.prepare(`SELECT owner_user_id FROM characters WHERE id = ?`).bind(characterId).first<{ owner_user_id: number }>();
      if (!owner || Number(owner.owner_user_id) !== payload.sub) {
        return new Response("Você não pode entrar com o personagem de outro jogador.", { status: 403 });
      }
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
      isSpectator: !isMaster && isSpectator,  // mestre nunca é espectador
      characterId: isSpectator ? undefined : characterId,
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
    this.broadcast({ type: "participant_joined", payload: { userId: payload.sub, username: payload.username, isMaster, isSpectator: conn.isSpectator } }, server);

    // ===== Tarefa 3: Se o jogador tem characterId e o personagem ainda não está
    // no estado da sala, carrega do D1 e adiciona — depois faz broadcast pra todos. =====
    if (characterId && !isMaster && !isSpectator && !this.state!.characters[characterId]) {
      try {
        const r = await this.env.DB.prepare(
          `SELECT c.id, c.owner_user_id, c.name, c.photo_url, c.page_id, c.symbol_url,
                  c.inventory_json, c.status_effects_json, u.username AS owner_username
           FROM characters c JOIN users u ON u.id = c.owner_user_id
           WHERE c.id = ?`
        ).bind(characterId).first<any>();
        if (r) {
          const stats = await this.env.DB.prepare(
            `SELECT id, stat_template_id, is_custom, name, type, value_current, value_max, value_text, value_bool, color, display_order, player_editable
             FROM character_stats WHERE character_id = ? ORDER BY display_order ASC, id ASC`
          ).bind(characterId).all<any>();
          const ch: CharacterState = {
            id: Number(r.id),
            ownerUserId: r.owner_user_id,
            ownerUsername: r.owner_username ?? "",
            name: r.name,
            photoUrl: r.photo_url,
            symbolUrl: r.symbol_url ?? null,
            pageId: r.page_id ?? null,
            stats: (stats.results || []).map((s: any) => sanitizeStat(s)).filter(Boolean) as CharacterStat[],
            inventory: r.inventory_json ? JSON.parse(r.inventory_json) : [],
            statusEffects: r.status_effects_json ? safeJson(r.status_effects_json, []) : [],
          };
          this.state!.characters[characterId] = ch;
          // Broadcast pra TODOS (incluindo o recém-conectado) que o personagem entrou
          this.broadcast({ type: "character_updated", payload: ch });
          // Tarefa 3: atualiza participantColors com o nome/foto do personagem
          if (!this.state!.participantColors) this.state!.participantColors = {};
          const existing = this.state!.participantColors[payload.sub] || {};
          this.state!.participantColors[payload.sub] = {
            ...existing,
            characterName: ch.name,
            photoUrl: ch.photoUrl,
          };
          await this.persistState(true);
          // Tarefa 3: broadcast da lista completa de participantes pra todos
          this.broadcastParticipantsList();
        }
      } catch (e) {
        // best-effort — não falha a conexão se não conseguir carregar o personagem
      }
    }

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
        case "add_character": await this.handleAddCharacterByMaster(conn, msg.payload); break;
        case "add_character_stat": await this.handleAddCharacterStat(conn, msg.payload); break;
        case "create_npc": await this.handleCreateNpc(conn, msg.payload); break;
        case "update_npc": await this.handleUpdateNpc(conn, msg.payload); break;
        case "update_npc_stat": await this.handleUpdateNpcStat(conn, msg.payload); break;
        case "delete_npc": await this.handleDeleteNpc(conn, msg.payload); break;
        case "create_enemy": await this.handleCreateEnemy(conn, msg.payload); break;
        case "update_enemy": await this.handleUpdateEnemy(conn, msg.payload); break;
        case "update_enemy_stat": await this.handleUpdateEnemyStat(conn, msg.payload); break;
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
        // ===== Migration 0013: Permissões por stat + delete stat =====
        case "delete_stat": await this.handleDeleteStat(conn, msg.payload); break;
        case "set_stat_permission": await this.handleSetStatPermission(conn, msg.payload); break;
        // ===== v12: Item proposals (jogador → mestre) =====
        case "item_proposal": await this.handleItemProposal(conn, msg.payload); break;
        case "resolve_item_proposal": await this.handleResolveItemProposal(conn, msg.payload); break;
        // ===== Soundboard da mesa (Cloudinary) =====
        case "create_soundboard_track": await this.handleCreateSoundboardTrack(conn, msg.payload); break;
        case "delete_soundboard_track": await this.handleDeleteSoundboardTrack(conn, msg.payload); break;
        case "play_soundboard_track": await this.handlePlaySoundboardTrack(conn, msg.payload); break;
        case "stop_soundboard_track": await this.handleStopSoundboardTrack(conn); break;
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

  // ---------- Soundboard ----------
  private async handleCreateSoundboardTrack(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode criar sons.");
    if (!Array.isArray(this.state!.soundboard)) this.state!.soundboard = [];
    if (this.state!.soundboard.length >= 100) throw new Error("O soundboard atingiu o limite de 100 faixas.");
    const title = String(p?.title ?? "").trim();
    const url = String(p?.url ?? "").trim();
    if (!title) throw new Error("Nome do som é obrigatório.");
    if (title.length > 100) throw new Error("Nome do som excede 100 caracteres.");
    if (!url || !isCloudinaryUrl(url)) throw new Error("A faixa precisa ser uma URL segura do Cloudinary.");
    const track: SoundboardTrack = {
      id: cryptoRandomId(),
      title: title.slice(0, 100),
      category: String(p?.category ?? "Geral").trim().slice(0, 50) || "Geral",
      url: url.slice(0, 1000),
      publicId: p?.publicId ? String(p.publicId).slice(0, 300) : null,
      format: p?.format ? String(p.format).slice(0, 20) : null,
      duration: Number.isFinite(Number(p?.duration)) ? Math.max(0, Math.min(3600, Number(p.duration))) : null,
      createdBy: conn.userId,
      createdByName: conn.username,
      createdAt: Date.now(),
    };
    this.state!.soundboard.push(track);
    this.broadcast({ type: "soundboard_track_added", payload: track });
  }

  private async handleDeleteSoundboardTrack(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode remover sons.");
    const trackId = String(p?.trackId ?? "");
    const before = this.state!.soundboard.length;
    this.state!.soundboard = this.state!.soundboard.filter(track => track.id !== trackId);
    if (this.state!.soundboard.length === before) throw new Error("Som não encontrado.");
    this.broadcast({ type: "soundboard_track_deleted", payload: { trackId } });
  }

  private async handlePlaySoundboardTrack(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode tocar sons para a sala.");
    const trackId = String(p?.trackId ?? "");
    const track = this.state!.soundboard.find(item => item.id === trackId);
    if (!track) throw new Error("Som não encontrado.");
    this.broadcast({ type: "soundboard_play", payload: { trackId, startedAt: Date.now() } });
  }

  private async handleStopSoundboardTrack(conn: Connection) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode parar o soundboard.");
    this.broadcast({ type: "soundboard_stop", payload: { stoppedAt: Date.now() } });
  }

  private async handleUpdateOwnCharacter(conn: Connection, p: any) {
    if (!conn.characterId) throw new Error("Você não está conectado com um personagem.");
    if (!this.state!.characters[conn.characterId]) throw new Error("Personagem não está na sala.");
    const ch = this.state!.characters[conn.characterId];
    // Migration 0013: jogador só pode atualizar stats marcados como playerEditable.
    // Se o stat não for editável pelo jogador, rejeita silenciosamente (não lança erro
    // pra não poluir o console — só ignora a mudança).
    const statId = Number(p?.statId);
    if (statId) {
      const stat = ch.stats.find(s => s.id === statId);
      if (stat && !stat.playerEditable) {
        throw new Error("Este status só pode ser editado pelo mestre.");
      }
      this.applyStatUpdate(ch, p);
    }
    if (Array.isArray(p?.stats)) {
      for (const statPayload of p.stats) {
        const editable = ch.stats.find(s => s.id === Number(statPayload?.id));
        if (editable && !editable.playerEditable) throw new Error(`O status "${editable.name}" só pode ser editado pelo mestre.`);
        if (editable) this.applyStatUpdate(ch, { statId: editable.id, value: statPayloadToValue(statPayload) });
      }
    }
    this.applyCharacterFields(ch, p, true);
    await this.persistCharacterToDb(ch);
    this.broadcast({ type: "character_updated", payload: ch });
  }

  private async handleUpdateCharacter(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode editar personagens de outros.");
    const id = Number(p?.characterId);
    if (!id || !this.state!.characters[id]) throw new Error("Personagem não encontrado.");
    const ch = this.state!.characters[id];
    // Mestre pode atualizar stat individual, vários stats e os dados completos.
    if (p?.statId) this.applyStatUpdate(ch, p);
    if (Array.isArray(p?.stats)) {
      for (const statPayload of p.stats) {
        const stat = ch.stats.find(s => s.id === Number(statPayload?.id));
        if (stat) this.applyStatUpdate(ch, { statId: stat.id, value: statPayloadToValue(statPayload) });
      }
    }
    this.applyCharacterFields(ch, p, true);
    if (Array.isArray(p?.inventory)) {
      ch.inventory = sanitizeInventory(p.inventory);
    }
    // Mestre pode mudar permissão de um stat on the fly
    if (p?.statId && typeof p?.playerEditable === "boolean") {
      const stat = ch.stats.find(s => s.id === Number(p.statId));
      if (stat) stat.playerEditable = !!p.playerEditable;
    }
    await this.persistCharacterToDb(ch);
    this.broadcast({ type: "character_updated", payload: ch });
  }

  private async handleAddCharacterStat(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode adicionar barras ou status.");
    const characterId = Number(p?.characterId);
    const ch = this.state!.characters[characterId];
    if (!characterId || !ch) throw new Error("Personagem não encontrado na sala.");
    const name = String(p?.name ?? "").trim().slice(0, 50);
    if (!name) throw new Error("Nome da barra é obrigatório.");
    const type: StatType = ["bar", "number", "text", "tag_list", "checkbox"].includes(p?.type) ? p.type : "bar";
    const color = typeof p?.color === "string" && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#a78bfa";
    const max = clampInt(p?.valueMax ?? 10, 0, 1_000_000_000);
    const current = type === "bar"
      ? clampInt(p?.valueCurrent ?? max, 0, max)
      : type === "number" ? clampInt(p?.valueCurrent ?? 0, -1_000_000_000, 1_000_000_000) : null;
    const order = ch.stats.reduce((highest, stat) => Math.max(highest, stat.displayOrder), -1) + 1;
    const result = await this.env.DB.prepare(
      `INSERT INTO character_stats (character_id, stat_template_id, is_custom, name, type, value_current, value_max, value_text, value_bool, color, display_order, player_editable)
       VALUES (?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      characterId, name, type, current, type === "bar" ? max : null,
      type === "tag_list" ? "[]" : type === "text" ? "" : null,
      type === "checkbox" ? 0 : null, color, order, p?.playerEditable ? 1 : 0
    ).run();
    const stat: CharacterStat = {
      id: Number(result.meta.last_row_id), statTemplateId: null, isCustom: true,
      name, type, valueCurrent: current, valueMax: type === "bar" ? max : null,
      valueText: type === "tag_list" ? "[]" : type === "text" ? "" : null,
      valueBool: type === "checkbox" ? 0 : null, color, displayOrder: order,
      playerEditable: !!p?.playerEditable,
    };
    ch.stats.push(stat);
    await this.persistCharacterToDb(ch);
    this.broadcast({ type: "character_updated", payload: ch });
  }

  private applyCharacterFields(ch: CharacterState, p: any, includeInventory: boolean) {
    if (typeof p?.name === "string" && p.name.trim()) ch.name = p.name.trim().slice(0, 100);
    if (typeof p?.photoUrl !== "undefined") ch.photoUrl = p.photoUrl ? String(p.photoUrl).slice(0, 500) : null;
    if (typeof p?.symbolUrl !== "undefined") ch.symbolUrl = p.symbolUrl ? String(p.symbolUrl).slice(0, 500) : null;
    if (typeof p?.pageId !== "undefined") ch.pageId = p.pageId ? Number(p.pageId) : null;
    if (includeInventory && Array.isArray(p?.inventory)) ch.inventory = sanitizeInventory(p.inventory);
  }

  private async persistCharacterToDb(ch: CharacterState) {
    ch.inventory = sanitizeInventory(ch.inventory);
    const statements = [this.env.DB.prepare(
      `UPDATE characters SET name = ?, photo_url = ?, symbol_url = ?, page_id = ?, inventory_json = ?, status_effects_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(ch.name, ch.photoUrl ?? null, ch.symbolUrl ?? null, ch.pageId ?? null, JSON.stringify(ch.inventory), JSON.stringify(ch.statusEffects || []), ch.id)];
    for (const stat of ch.stats) {
      statements.push(this.env.DB.prepare(
        `UPDATE character_stats SET name = ?, type = ?, value_current = ?, value_max = ?, value_text = ?, value_bool = ?, color = ?, player_editable = ?, updated_at = datetime('now') WHERE id = ? AND character_id = ?`
      ).bind(stat.name, stat.type, stat.valueCurrent ?? null, stat.valueMax ?? null, stat.valueText ?? null, stat.valueBool ?? null, stat.color ?? null, stat.playerEditable ? 1 : 0, stat.id, ch.id));
    }
    await this.env.DB.batch(statements).catch(() => {/* o snapshot ainda mantém a sessão */});
    const inventoryStatements = [this.env.DB.prepare(`DELETE FROM character_inventory_items WHERE character_id = ?`).bind(ch.id)];
    ch.inventory.forEach((item, index) => {
      inventoryStatements.push(this.env.DB.prepare(
        `INSERT INTO character_inventory_items (character_id, name, qty, description, equipped, icon_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(ch.id, item.name, item.qty, item.description ?? null, item.equipped ? 1 : 0, item.iconUrl ?? null, index));
    });
    for (let i = 0; i < inventoryStatements.length; i += 90) {
      await this.env.DB.batch(inventoryStatements.slice(i, i + 90)).catch(() => {/* o snapshot ainda mantém a sessão */});
    }
  }

  // Migration 0013: mestre deleta um stat da ficha do personagem em tempo real.
  private async handleDeleteStat(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode deletar status.");
    const characterId = Number(p?.characterId);
    const statId = Number(p?.statId);
    if (!characterId || !statId) throw new Error("characterId e statId são obrigatórios.");
    const ch = this.state!.characters[characterId];
    if (!ch) throw new Error("Personagem não encontrado na sala.");
    const idx = ch.stats.findIndex(s => s.id === statId);
    if (idx < 0) throw new Error("Status não encontrado neste personagem.");
    ch.stats.splice(idx, 1);
    // Persiste no D1 também (DELETE do banco)
    try {
      await this.env.DB.prepare(`DELETE FROM character_stats WHERE id = ? AND character_id = ?`).bind(statId, characterId).run();
    } catch {}
    await this.persistCharacterToDb(ch);
    this.broadcast({ type: "character_updated", payload: ch });
  }

  // Migration 0013: mestre alterna permissão de edição do stat pelo jogador.
  private async handleSetStatPermission(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode alterar permissões de status.");
    const characterId = Number(p?.characterId);
    const statId = Number(p?.statId);
    const playerEditable = !!p?.playerEditable;
    if (!characterId || !statId) throw new Error("characterId e statId são obrigatórios.");
    const ch = this.state!.characters[characterId];
    if (!ch) throw new Error("Personagem não encontrado na sala.");
    const stat = ch.stats.find(s => s.id === statId);
    if (!stat) throw new Error("Status não encontrado neste personagem.");
    stat.playerEditable = playerEditable;
    // Persiste no D1
    try {
      await this.env.DB.prepare(
        `UPDATE character_stats SET player_editable = ?, updated_at = datetime('now') WHERE id = ? AND character_id = ?`
      ).bind(playerEditable ? 1 : 0, statId, characterId).run();
    } catch {}
    await this.persistCharacterToDb(ch);
    this.broadcast({ type: "character_updated", payload: ch });
  }

  // Aplica update de UM stat (identificado por statId) no personagem.
  // Validações: tipo do stat bate com o campo enviado; bar não passa de max.
  private applyStatUpdate(ch: CharacterState, p: any) {
    const statId = Number(p?.statId);
    if (!statId) throw new Error("statId é obrigatório.");
    const stat = ch.stats.find(s => s.id === statId);
    if (!stat) throw new Error("Status não encontrado neste personagem.");
    if (stat.type === "formula") throw new Error("Status calculado por fórmula não pode ser editado diretamente.");
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
    } else if (stat.type === "text" || stat.type === "tag_list") {
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
      kind: p?.kind === "complex" ? "complex" : "filler",
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
    // v12: ilustração do inimigo (URL Cloudinary)
    if (typeof p?.illustrationUrl === "string" && p.illustrationUrl) {
      enemy.illustrationUrl = String(p.illustrationUrl).slice(0, 500);
    }
    // v12: stats avançados do inimigo (NPC completo com barras, números, etc.)
    if (enemy.kind === "complex" && Array.isArray(p?.stats)) {
      enemy.stats = this.sanitizeEnemyStats(p.stats);
    } else if (enemy.kind === "filler") {
      enemy.stats = [];
    }
    this.state!.enemies[enemy.id] = enemy;
    this.broadcast({ type: "enemy_updated", payload: enemy });
  }

  private async handleUpdateEnemy(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode editar inimigos.");
    const id = String(p?.enemyId ?? "");
    const enemy = this.state!.enemies[id];
    if (!enemy) throw new Error("Inimigo não encontrado.");

    if (p?.kind === "filler" || p?.kind === "complex") enemy.kind = p.kind;

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
    // v12: atualiza ilustração (string vazia = remove)
    if (typeof p?.illustrationUrl !== "undefined") {
      enemy.illustrationUrl = p.illustrationUrl ? String(p.illustrationUrl).slice(0, 500) : null;
    }
    // v12: atualiza stats avançados (substitui todos se vier array)
    if (enemy.kind === "complex" && Array.isArray(p?.stats)) {
      enemy.stats = this.sanitizeEnemyStats(p.stats);
    } else if (enemy.kind === "filler") {
      enemy.stats = [];
    }
    this.broadcast({ type: "enemy_updated", payload: enemy });
  }

  // v12: sanitiza array de stats de inimigo vindos do cliente.
  // Rejeita tipos inválidos, trunca strings, valida cores hex.
  private sanitizeEnemyStats(stats: any[]): EnemyStat[] {
    const validTypes = new Set(["bar", "number", "text", "tag_list", "checkbox", "formula"]);
    return stats
      .filter(s => s && typeof s.name === "string" && s.name.trim() && validTypes.has(s.type))
      .map((s, i) => {
        const stat: EnemyStat = {
          id: String(s.id || cryptoRandomId()),
          name: String(s.name).slice(0, 50),
          type: s.type,
          displayOrder: Number(s.displayOrder ?? i),
        };
        if (s.color && /^#[0-9a-f]{6}$/i.test(s.color)) stat.color = s.color;
        if (s.type === "bar" || s.type === "number") {
          stat.valueCurrent = s.valueCurrent !== null && s.valueCurrent !== undefined ? Number(s.valueCurrent) : null;
          if (s.type === "bar") stat.valueMax = s.valueMax !== null && s.valueMax !== undefined ? Number(s.valueMax) : null;
        } else if (s.type === "text" || s.type === "tag_list" || s.type === "formula") {
          stat.valueText = s.valueText ? String(s.valueText).slice(0, 2000) : null;
        } else if (s.type === "checkbox") {
          stat.valueBool = s.valueBool ? 1 : 0;
        }
        return stat;
      });
  }

  // v12: mestre atualiza UM stat de inimigo (para edição inline rápida).
  private async handleUpdateEnemyStat(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode editar stats de inimigos.");
    const enemyId = String(p?.enemyId ?? "");
    const enemy = this.state!.enemies[enemyId];
    if (!enemy) throw new Error("Inimigo não encontrado.");
    if (!Array.isArray(enemy.stats)) throw new Error("Este inimigo não tem stats avançados.");
    const statId = String(p?.statId ?? "");
    const stat = enemy.stats.find(s => s.id === statId);
    if (!stat) throw new Error("Status não encontrado neste inimigo.");
    this.applyEnemyStatUpdate(stat, p?.value ?? {});
    this.broadcast({ type: "enemy_updated", payload: enemy });
  }

  private applyEnemyStatUpdate(stat: EnemyStat, v: any) {
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
    }
  }

  private async handleCreateNpc(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode criar NPCs.");
    const name = String(p?.name ?? "").trim();
    if (!name) throw new Error("Nome do NPC é obrigatório.");
    if (!this.state!.npcs) this.state!.npcs = {};
    const npc: NpcState = {
      id: cryptoRandomId(),
      name: name.slice(0, 100),
      description: p?.description ? String(p.description).slice(0, 1000) : undefined,
      photoUrl: p?.photoUrl ? String(p.photoUrl).slice(0, 500) : null,
      stats: Array.isArray(p?.stats) ? this.sanitizeEnemyStats(p.stats) : [],
      statusEffects: [],
    };
    this.state!.npcs[npc.id] = npc;
    this.broadcast({ type: "npc_updated", payload: npc });
  }

  private async handleUpdateNpc(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode editar NPCs.");
    const id = String(p?.npcId ?? "");
    const npc = this.state!.npcs[id];
    if (!npc) throw new Error("NPC não encontrado.");
    if (typeof p?.name === "string" && p.name.trim()) npc.name = p.name.trim().slice(0, 100);
    if (typeof p?.description !== "undefined") npc.description = p.description ? String(p.description).slice(0, 1000) : undefined;
    if (typeof p?.photoUrl !== "undefined") npc.photoUrl = p.photoUrl ? String(p.photoUrl).slice(0, 500) : null;
    if (Array.isArray(p?.stats)) npc.stats = this.sanitizeEnemyStats(p.stats);
    this.broadcast({ type: "npc_updated", payload: npc });
  }

  private async handleUpdateNpcStat(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode editar stats de NPCs.");
    const npc = this.state!.npcs[String(p?.npcId ?? "")];
    if (!npc) throw new Error("NPC não encontrado.");
    const stat = npc.stats.find(s => s.id === String(p?.statId ?? ""));
    if (!stat) throw new Error("Status não encontrado neste NPC.");
    this.applyEnemyStatUpdate(stat, p?.value ?? {});
    this.broadcast({ type: "npc_updated", payload: npc });
  }

  private async handleDeleteNpc(conn: Connection, p: any) {
    if (!conn.isMaster) throw new Error("Apenas o mestre pode remover NPCs.");
    const id = String(p?.npcId ?? "");
    if (!this.state!.npcs[id]) return;
    delete this.state!.npcs[id];
    this.broadcast({ type: "npc_deleted", payload: { npcId: id } });
  }

  // v12: jogador propõe item para o mestre aprovar.
  private async handleItemProposal(conn: Connection, p: any) {
    if (!this.state) return;
    if (conn.isMaster) throw new Error("Mestre não propõe itens — use o botão de adicionar diretamente.");
    if (!conn.characterId) throw new Error("Você precisa estar conectado com um personagem para propor itens.");
    const ch = this.state.characters[conn.characterId];
    if (!ch) throw new Error("Personagem não encontrado na sala.");

    const name = String(p?.item?.name ?? "").trim();
    if (!name) throw new Error("Nome do item é obrigatório.");
    const qty = clampInt(p?.item?.qty ?? 1, 1, 9999);
    const description = p?.item?.description ? String(p.item.description).slice(0, 200) : undefined;
    const equipped = !!p?.item?.equipped;
    const iconUrl = p?.item?.iconUrl ? String(p.item.iconUrl).slice(0, 500) : null;

    const proposal: ItemProposal = {
      id: cryptoRandomId(),
      fromUserId: conn.userId,
      fromUsername: conn.username,
      characterId: conn.characterId,
      characterName: ch.name,
      item: { name: name.slice(0, 80), qty, description, equipped, iconUrl },
      status: "pending",
      createdAt: Date.now(),
    };
    this.state.itemProposals.push(proposal);
    if (this.state.itemProposals.length > 30) this.state.itemProposals.shift();

    // Broadcast pra todos — o mestre vê a notificação, o jogador vê "aguardando aprovação"
    this.broadcast({ type: "item_proposal_received", payload: proposal });

    // Mensagem de sistema no chat
    const sysMsg: ChatMessage = {
      id: cryptoRandomId(),
      senderUserId: 0,
      senderUsername: "sistema",
      text: `📦 ${conn.username} propôs o item "${name}" — aguardando aprovação do mestre.`,
      timestamp: Date.now(),
    };
    this.state.chatLog.push(sysMsg);
    if (this.state.chatLog.length > 50) this.state.chatLog.shift();
    this.broadcast({ type: "chat_message", payload: sysMsg });
  }

  // v12: mestre aprova ou rejeita proposta de item.
  private async handleResolveItemProposal(conn: Connection, p: any) {
    if (!this.state) return;
    if (!conn.isMaster) throw new Error("Apenas o mestre pode aprovar/rejeitar propostas de itens.");
    const proposalId = String(p?.proposalId ?? "");
    const approved = !!p?.approved;
    const masterNote = p?.note ? String(p.note).slice(0, 200) : undefined;

    const proposal = this.state.itemProposals.find(pr => pr.id === proposalId);
    if (!proposal) throw new Error("Proposta não encontrada.");
    if (proposal.status !== "pending") throw new Error("Esta proposta já foi resolvida.");

    proposal.status = approved ? "approved" : "rejected";
    proposal.masterNote = masterNote;
    proposal.resolvedAt = Date.now();

    if (approved) {
      // Adiciona o item ao inventário do personagem via API REST (persiste no D1)
      try {
        await this.env.DB.prepare(
          `INSERT INTO character_inventory_items (character_id, name, qty, description, equipped, icon_url, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          proposal.characterId,
          proposal.item.name,
          proposal.item.qty,
          proposal.item.description || null,
          proposal.item.equipped ? 1 : 0,
          proposal.item.iconUrl || null,
          0
        ).run();
      } catch (e) {
        // Se a tabela não existir (migration 0013 não rodou), adiciona ao estado em memória
        const ch = this.state.characters[proposal.characterId];
        if (ch) {
          ch.inventory = ch.inventory || [];
          ch.inventory.push({
            name: proposal.item.name,
            qty: proposal.item.qty,
            description: proposal.item.description,
            equipped: proposal.item.equipped,
            iconUrl: proposal.item.iconUrl,
          });
        }
      }
      // Atualiza estado do personagem em memória e broadcast
      const ch = this.state.characters[proposal.characterId];
      if (ch) {
        // Re-busca inventário do D1 para sincronizar
        try {
          const items = await this.env.DB.prepare(
            `SELECT id, name, qty, description, equipped, icon_url, sort_order FROM character_inventory_items WHERE character_id = ? ORDER BY sort_order ASC, id ASC`
          ).bind(proposal.characterId).all<any>();
          ch.inventory = (items.results || []).map((it: any) => ({
            name: it.name, qty: it.qty, description: it.description,
            equipped: it.equipped === 1, iconUrl: it.icon_url,
          }));
        } catch {}
        this.broadcast({ type: "character_updated", payload: ch });
      }
    }

    // Broadcast da resolução
    this.broadcast({ type: "item_proposal_resolved", payload: proposal });

    // Mensagem de sistema
    const sysMsg: ChatMessage = {
      id: cryptoRandomId(),
      senderUserId: 0,
      senderUsername: "sistema",
      text: approved
        ? `✅ Mestre aprovou o item "${proposal.item.name}" para ${proposal.characterName}.`
        : `❌ Mestre rejeitou o item "${proposal.item.name}"${masterNote ? `: ${masterNote}` : ""}.`,
      timestamp: Date.now(),
    };
    this.state.chatLog.push(sysMsg);
    if (this.state.chatLog.length > 50) this.state.chatLog.shift();
    this.broadcast({ type: "chat_message", payload: sysMsg });
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
      await this.persistCharacterToDb(ch);
      this.broadcast({ type: "status_effect_added", payload: { targetType, targetId: Number(targetId), effect } });
    } else if (targetType === "npc") {
      const npc = this.state!.npcs[String(targetId)];
      if (!npc) throw new Error("NPC não encontrado.");
      npc.statusEffects.push(effect);
      this.broadcast({ type: "status_effect_added", payload: { targetType, targetId: String(targetId), effect } });
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
      await this.persistCharacterToDb(ch);
      this.broadcast({ type: "status_effect_removed", payload: { targetType, targetId: Number(targetId), statusId } });
    } else if (targetType === "npc") {
      const npc = this.state!.npcs[String(targetId)];
      if (!npc) return;
      npc.statusEffects = npc.statusEffects.filter(s => s.id !== statusId);
      this.broadcast({ type: "status_effect_removed", payload: { targetType, targetId: String(targetId), statusId } });
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

    // Tarefa 4: determinar o nome de exibição (character name, "Mestre", ou "Espectador")
    let senderDisplayName = conn.username;
    if (conn.isMaster) {
      senderDisplayName = "Mestre";
    } else if (conn.isSpectator) {
      senderDisplayName = "Espectador";
    } else if (conn.characterId && this.state.characters[conn.characterId]) {
      senderDisplayName = this.state.characters[conn.characterId].name;
    } else if (conn.characterId) {
      // Personagem pode não estar carregado ainda — tenta do estado
      const ch = Object.values(this.state.characters).find(c => c.id === conn.characterId);
      if (ch) senderDisplayName = ch.name;
    }

    const msg: ChatMessage = {
      id: cryptoRandomId(),
      senderUserId: conn.userId,
      senderUsername: conn.username,
      senderDisplayName,  // Tarefa 4: nome do personagem (ou "Mestre"/"Espectador")
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
    const targetCharacterId = Number(p?.targetCharacterId);
    const receiverCh = targetCharacterId
      ? this.state.characters[targetCharacterId]
      : receiverChars[0];
    if (!receiverCh || receiverCh.ownerUserId !== targetUserId) throw new Error("Personagem alvo não está na sala.");
    const proposerCh = this.state.characters[conn.characterId];
    if (!proposerCh) throw new Error("Seu personagem não está na sala.");
    this.assertTradeTransfer(proposerCh, receiverCh, offer, "Você não possui todos os itens ou moedas oferecidos.");
    this.assertTradeTransfer(receiverCh, proposerCh, request, "O personagem alvo não possui todos os itens ou moedas solicitados.");

    const trade: Trade = {
      id: cryptoRandomId(),
      roomCode: this.state.code,
      proposerUserId: conn.userId,
      proposerName: conn.username,
      receiverUserId: targetUserId,
      receiverName,
      proposerCharacterId: proposerCh.id,
      receiverCharacterId: receiverCh.id,
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
      const proposerCh = this.findTradeCharacter(trade.proposerUserId, trade.proposerCharacterId);
      const receiverCh = this.findTradeCharacter(trade.receiverUserId, trade.receiverCharacterId);
      if (!proposerCh || !receiverCh) throw new Error("Os personagens da troca não estão disponíveis na sala.");
      this.assertTradeTransfer(proposerCh, receiverCh, trade.offer, "O personagem que oferece não possui mais todos os itens ou moedas.");
      this.assertTradeTransfer(receiverCh, proposerCh, trade.request, "Você não possui mais todos os itens ou moedas solicitados.");
      trade.status = "accepted";
      trade.resolvedAt = Date.now();
      // Aplica a troca nos personagens (move itens/dinheiro)
      await this.applyTradeEffects(trade);
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
        proposerCharacterId: trade.receiverCharacterId ?? conn.characterId,
        receiverCharacterId: trade.proposerCharacterId,
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
  private async applyTradeEffects(trade: Trade) {
    const proposerCh = this.findTradeCharacter(trade.proposerUserId, trade.proposerCharacterId);
    const receiverCh = this.findTradeCharacter(trade.receiverUserId, trade.receiverCharacterId);
    if (!proposerCh || !receiverCh) return;

    // Move itens do proposer -> receiver
    for (const item of trade.offer.items) {
      // Remove do proposer (subtrai qty; se chegar a 0, remove)
      const propItem = proposerCh.inventory.find(it => it.name.trim().toLowerCase() === item.name.trim().toLowerCase());
      if (propItem) {
        propItem.qty = Math.max(0, propItem.qty - item.qty);
        if (propItem.qty === 0) {
          proposerCh.inventory = proposerCh.inventory.filter(it => it !== propItem);
        }
      }
      // Adiciona no receiver
      const recvItem = receiverCh.inventory.find(it => it.name.trim().toLowerCase() === item.name.trim().toLowerCase());
      if (recvItem) {
        recvItem.qty += item.qty;
      } else {
        receiverCh.inventory.push({ name: item.name, qty: item.qty, description: item.description });
      }
    }

    // Move itens do receiver -> proposer (request)
    for (const item of trade.request.items) {
      const recvItem = receiverCh.inventory.find(it => it.name.trim().toLowerCase() === item.name.trim().toLowerCase());
      if (recvItem) {
        recvItem.qty = Math.max(0, recvItem.qty - item.qty);
        if (recvItem.qty === 0) {
          receiverCh.inventory = receiverCh.inventory.filter(it => it !== recvItem);
        }
      }
      const propItem = proposerCh.inventory.find(it => it.name.trim().toLowerCase() === item.name.trim().toLowerCase());
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
    await this.persistCharacterToDb(proposerCh);
    await this.persistCharacterToDb(receiverCh);
  }

  private findTradeCharacter(userId: number, characterId?: number): CharacterState | null {
    if (characterId && this.state?.characters[characterId]?.ownerUserId === userId) return this.state.characters[characterId];
    return Object.values(this.state?.characters || {}).find(c => c.ownerUserId === userId) ?? null;
  }

  private assertTradeAssets(ch: CharacterState, offer: TradeOffer, message: string) {
    for (const item of offer.items) {
      const owned = ch.inventory.find(it => it.name.trim().toLowerCase() === item.name.trim().toLowerCase());
      if (!owned || owned.qty < item.qty) throw new Error(message);
    }
    if (offer.money && offer.money > 0) {
      const moneyNames = ["dinheiro", "moedas", "gold", "ouro", "money"];
      const stat = ch.stats.find(s => s.type === "number" && moneyNames.includes(s.name.toLowerCase()));
      if (!stat || Number(stat.valueCurrent ?? 0) < offer.money) throw new Error(message);
    }
  }

  private assertTradeTransfer(from: CharacterState, to: CharacterState, offer: TradeOffer, message: string) {
    this.assertTradeAssets(from, offer, message);
    if (offer.money && offer.money > 0 && !this.findMoneyStat(to)) throw new Error(message);
  }

  private findMoneyStat(ch: CharacterState): CharacterStat | undefined {
    const names = ["dinheiro", "moedas", "gold", "ouro", "money"];
    return ch.stats.find(s => s.type === "number" && names.includes(s.name.toLowerCase()));
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
        await this.persistCharacterToDb(ch);
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

    await this.persistCharacterToDb(ch);
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
    // Tarefa 3: atualiza lista de participantes com a nova cor
    this.broadcastParticipantsList();
  }

  private onClose(ws: WebSocket) {
    const conn = this.connections.get(ws);
    this.connections.delete(ws);
    if (conn) {
      this.broadcast({ type: "participant_left", payload: { userId: conn.userId, username: conn.username, isMaster: conn.isMaster } });
      // Tarefa 3: atualiza lista de participantes pra todos
      this.broadcastParticipantsList();
    }
  }

  // Tarefa 3: Monta e faz broadcast da lista completa de participantes
  // com informações de personagem (nome, foto, cor, status, is_spectator).
  private broadcastParticipantsList() {
    if (!this.state) return;
    const participants = [];
    for (const [ws, conn] of this.connections) {
      const info = this.state.participantColors?.[conn.userId] || {};
      let characterName: string | null = null;
      let photoUrl: string | null | undefined = null;
      let stats: any[] | null = null;
      if (conn.characterId && this.state.characters[conn.characterId]) {
        const ch = this.state.characters[conn.characterId];
        characterName = ch.name;
        photoUrl = ch.photoUrl;
        stats = ch.stats;
      }
      participants.push({
        userId: conn.userId,
        username: conn.username,
        isMaster: conn.isMaster,
        isSpectator: conn.isSpectator,
        characterId: conn.characterId ?? null,
        characterName,
        photoUrl,
        color: info.color || null,
        stats,
      });
    }
    this.broadcast({ type: "participants_updated", payload: { participants } });
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
      if (!parsed.npcs || typeof parsed.npcs !== "object") parsed.npcs = {};
      if (!Array.isArray(parsed.soundboard)) parsed.soundboard = [];
      if (parsed.enemies && typeof parsed.enemies === "object") {
        Object.values(parsed.enemies).forEach((enemy: any) => {
          if (enemy.kind !== "filler" && enemy.kind !== "complex") enemy.kind = Array.isArray(enemy.stats) && enemy.stats.length ? "complex" : "filler";
        });
      }
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
      npcs: Object.values(this.state.npcs || {}),
      diceLog: this.state.diceLog.slice(-50),
      suggestions: this.state.suggestions,
      chatLog: this.state.chatLog.slice(-50),
      // Novos campos (Feature 2, 4):
      polls: this.state.polls,
      trades: this.state.trades,
      purchaseOffers: this.state.purchaseOffers,
      levelUpOffers: this.state.levelUpOffers,
      itemProposals: this.state.itemProposals || [],
      soundboard: this.state.soundboard || [],
      // Tarefa 4: mapa userId -> { color, characterName, photoUrl }
      participantColors: this.state.participantColors || {},
      you: {
        userId: conn.userId,
        username: conn.username,
        isMaster: conn.isMaster,
        isSpectator: conn.isSpectator,
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

function safeJson(s: string | null | undefined, fallback: any): any {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function sanitizeInventory(items: any[]): InventoryItem[] {
  return (Array.isArray(items) ? items : [])
    .filter(it => it && typeof it.name === "string" && it.name.trim())
    .slice(0, 100)
    .map(it => ({
      name: String(it.name).trim().slice(0, 80),
      qty: clampInt(it.qty, 0, 9999),
      description: it.description ? String(it.description).slice(0, 200) : undefined,
      equipped: !!it.equipped,
      iconUrl: it.iconUrl ? String(it.iconUrl).slice(0, 500) : null,
    }));
}

function statPayloadToValue(s: any): any {
  const value = s?.value || s || {};
  if (s?.type === "bar") return { current: Number(value.current ?? s.valueCurrent), max: Number(value.max ?? s.valueMax) };
  if (s?.type === "number") return { current: Number(value.current ?? s.valueCurrent) };
  if (s?.type === "checkbox") return { bool: typeof value.bool === "boolean" ? value.bool : !!s.valueBool };
  return { text: String(value.text ?? s.valueText ?? "") };
}

function cryptoRandomId(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

function isCloudinaryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "res.cloudinary.com" || url.hostname.endsWith(".cloudinary.com"));
  } catch {
    return false;
  }
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
    playerEditable: !!(s.playerEditable ?? s.player_editable),
  };
}
