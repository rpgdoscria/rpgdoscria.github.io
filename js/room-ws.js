// frontend/js/room-ws.js — cliente WebSocket para a Sala de Jogo
//
// Conecta ao endpoint /api/rooms/connect?code=...&token=... do Worker, que
// roteia para o RoomDO. Faz reconexão automática com backoff exponencial.
// Mantém o estado mais recente recebido em `state` e chama `onEvent` para
// cada mensagem broadcast.

(function () {
  const cfg = window.WIKI_CONFIG || {};
  const API_BASE = cfg.API_BASE || "";
  // Converte https://... para wss://... (e http:// para ws://)
  const WS_BASE = API_BASE.replace(/^http/, "ws");

  function getToken() {
    try { return localStorage.getItem("rpg_wiki_token") || null; } catch { return null; }
  }

  class RoomClient {
    constructor(code, characterId, isSpectator = false) {
      this.code = code;
      this.characterId = characterId;
      this.isSpectator = isSpectator;
      this.ws = null;
      this.state = null;
      this.connected = false;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 10;
      this.shouldReconnect = true;
      this.reconnectTimer = null;
      this.socketGeneration = 0;
      this.fatal = false;
      this.onEvent = null;       // callback (msg) => void
      this.onStateChange = null; // callback (state) => void  (chamado a cada room_state ou atualização incremental)
      this.onConnectivity = null;// callback (status: 'connected'|'reconnecting'|'closed'|'error') => void
    }

    connect() {
      if (!this.shouldReconnect || this.fatal) return;
      if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
      const token = getToken();
      if (!token) {
        this._notify("error");
        
        
        location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search);
        return;
      }
      const params = new URLSearchParams({ code: this.code, token });
      if (this.characterId) params.set("characterId", String(this.characterId));
      if (this.isSpectator) params.set("isSpectator", "1");
      const url = `${WS_BASE}/api/rooms/connect?${params}`;

      this._notify("reconnecting");
      const generation = ++this.socketGeneration;
      let socket;
      try {
        socket = new WebSocket(url);
        this.ws = socket;
      } catch (e) {
        this._notify("error");
        this._scheduleReconnect();
        return;
      }

      socket.addEventListener("open", () => {
        if (this.ws !== socket || generation !== this.socketGeneration) return;
        this.connected = true;
        this.reconnectAttempts = 0;
        this._notify("connected");
      });

      socket.addEventListener("message", (e) => {
        if (this.ws !== socket || generation !== this.socketGeneration) return;
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        this._handleMessage(msg);
      });

      socket.addEventListener("close", (e) => {
        if (this.ws !== socket || generation !== this.socketGeneration) return;
        this.connected = false;
        this.ws = null;
        this._notify("closed");
        // 1008 = política/autorização e 1011 = erro interno do servidor:
        // repetir nesses casos só cria um loop agressivo no navegador.
        if (this.shouldReconnect && e.code !== 1000 && e.code !== 1008 && e.code !== 1011) {
          this._scheduleReconnect();
        } else if (this.shouldReconnect && (e.code === 1008 || e.code === 1011)) {
          this._stopWithFatal("A sala recusou a conexão. Atualize a página ou peça ao mestre para verificar a sala.");
        }
      });

      socket.addEventListener("error", () => {
        if (this.ws !== socket || generation !== this.socketGeneration) return;
        this._notify("error");
        // Não fecha aqui — o close handler cuida da reconexão
      });
    }

    send(type, payload) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
      try {
        this.ws.send(JSON.stringify({ type, payload }));
        return true;
      } catch (e) {
        console.error("WS send failed", e);
        return false;
      }
    }

    close() {
      this.shouldReconnect = false;
      this.fatal = false;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.socketGeneration++;
      if (this.ws) {
        try { this.ws.close(1000, "Saindo"); } catch {}
        this.ws = null;
      }
    }

    _scheduleReconnect() {
      if (!this.shouldReconnect || this.fatal || this.reconnectTimer) return;
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this._stopWithFatal("Não foi possível reconectar após várias tentativas. Recarregue a página.");
        return;
      }
      const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 15000);
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.shouldReconnect && !this.fatal) this.connect();
      }, delay);
    }

    _stopWithFatal(message) {
      this.fatal = true;
      this.shouldReconnect = false;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this._notify("error");
      if (this.onEvent) this.onEvent({ type: "fatal", payload: { message } });
    }

    _handleMessage(msg) {
      // room_state é o snapshot completo — atualiza this.state e chama onStateChange
      if (msg.type === "room_state") {
        this.state = msg.payload;
        if (this.onStateChange) this.onStateChange(this.state);
        return;
      }
      // Atualizações incrementais — aplica no estado local e chama onEvent
      if (this.state) {
        this._applyIncremental(msg);
      }
      if (this.onEvent) this.onEvent(msg);
      // Sempre chama onStateChange também para re-renderizar a UI
      if (this.onStateChange) this.onStateChange(this.state);
    }

    _applyIncremental(msg) {
      const s = this.state;
      if (!s) return;
      switch (msg.type) {
        case "character_updated": {
          const ch = msg.payload;
          const idx = s.characters.findIndex(c => c.id === ch.id);
          if (idx >= 0) s.characters[idx] = ch;
          else s.characters.push(ch);
          break;
        }
        case "enemy_updated": {
          const en = msg.payload;
          const idx = s.enemies.findIndex(e => e.id === en.id);
          if (idx >= 0) s.enemies[idx] = en;
          else s.enemies.push(en);
          break;
        }
        case "enemy_deleted": {
          s.enemies = s.enemies.filter(e => e.id !== msg.payload.enemyId);
          break;
        }
        case "npc_updated": {
          if (!Array.isArray(s.npcs)) s.npcs = [];
          const npc = msg.payload;
          const idx = s.npcs.findIndex(n => n.id === npc.id);
          if (idx >= 0) s.npcs[idx] = npc;
          else s.npcs.push(npc);
          break;
        }
        case "npc_deleted": {
          if (!Array.isArray(s.npcs)) s.npcs = [];
          s.npcs = s.npcs.filter(n => n.id !== msg.payload.npcId);
          break;
        }
        case "status_effect_added": {
          const { targetType, targetId, effect } = msg.payload;
          if (targetType === "character") {
            const ch = s.characters.find(c => c.id === targetId);
            if (ch) ch.statusEffects.push(effect);
          } else if (targetType === "npc") {
            if (!Array.isArray(s.npcs)) s.npcs = [];
            const npc = s.npcs.find(n => n.id === targetId);
            if (npc) npc.statusEffects.push(effect);
          } else {
            const en = s.enemies.find(e => e.id === targetId);
            if (en) en.statusEffects.push(effect);
          }
          break;
        }
        case "status_effect_removed": {
          const { targetType, targetId, statusId } = msg.payload;
          if (targetType === "character") {
            const ch = s.characters.find(c => c.id === targetId);
            if (ch) ch.statusEffects = ch.statusEffects.filter(s => s.id !== statusId);
          } else if (targetType === "npc") {
            if (!Array.isArray(s.npcs)) s.npcs = [];
            const npc = s.npcs.find(n => n.id === targetId);
            if (npc) npc.statusEffects = npc.statusEffects.filter(s => s.id !== statusId);
          } else {
            const en = s.enemies.find(e => e.id === targetId);
            if (en) en.statusEffects = en.statusEffects.filter(s => s.id !== statusId);
          }
          break;
        }
        case "dice_result": {
          s.diceLog.push(msg.payload);
          if (s.diceLog.length > 50) s.diceLog.shift();
          break;
        }
        case "formula_suggested": {
          s.suggestions.push(msg.payload);
          break;
        }
        case "room_locked": {
          s.locked = msg.payload.locked;
          break;
        }
        case "room_closed": {
          this.shouldReconnect = false;
          if (this.ws) try { this.ws.close(1000); } catch {}
          break;
        }
        // ===== Polls (Feature 2) =====
        case "poll_created": {
          if (!Array.isArray(s.polls)) s.polls = [];
          s.polls.push(msg.payload);
          if (s.polls.length > 20) s.polls.shift();
          break;
        }
        case "poll_updated": {
          if (!Array.isArray(s.polls)) s.polls = [];
          const idx = s.polls.findIndex(p => p.id === msg.payload.id);
          if (idx >= 0) s.polls[idx] = msg.payload;
          else s.polls.push(msg.payload);
          break;
        }
        case "poll_ended": {
          if (!Array.isArray(s.polls)) s.polls = [];
          const idx = s.polls.findIndex(p => p.id === msg.payload.id);
          if (idx >= 0) s.polls[idx] = msg.payload;
          break;
        }
        case "poll_chat": {
          if (!Array.isArray(s.polls)) s.polls = [];
          const poll = s.polls.find(p => p.id === msg.payload.pollId);
          if (poll) {
            if (!Array.isArray(poll.chat)) poll.chat = [];
            const { pollId, ...chatMsg } = msg.payload;
            poll.chat.push(chatMsg);
            if (poll.chat.length > 50) poll.chat.shift();
          }
          break;
        }
        // ===== Trades (Feature 4a) =====
        case "trade_proposed": {
          if (!Array.isArray(s.trades)) s.trades = [];
          s.trades.push(msg.payload);
          if (s.trades.length > 30) s.trades.shift();
          break;
        }
        case "trade_updated": {
          if (!Array.isArray(s.trades)) s.trades = [];
          const idx = s.trades.findIndex(t => t.id === msg.payload.id);
          if (idx >= 0) s.trades[idx] = msg.payload;
          break;
        }
        // ===== Purchase Offers (Feature 4b) =====
        case "purchase_offer": {
          if (!Array.isArray(s.purchaseOffers)) s.purchaseOffers = [];
          s.purchaseOffers.push(msg.payload);
          if (s.purchaseOffers.length > 30) s.purchaseOffers.shift();
          break;
        }
        case "purchase_updated": {
          if (!Array.isArray(s.purchaseOffers)) s.purchaseOffers = [];
          const idx = s.purchaseOffers.findIndex(o => o.id === msg.payload.id);
          if (idx >= 0) s.purchaseOffers[idx] = msg.payload;
          break;
        }
        // ===== Level Up (Feature 4c) — level_up_available viria do mestre,
        // mas por enquanto o mestre não envia WS pra esse evento. =====
        case "level_up_available": {
          if (!Array.isArray(s.levelUpOffers)) s.levelUpOffers = [];
          s.levelUpOffers.push(msg.payload);
          break;
        }
        // ===== Secret Revealed (Feature 3) — não precisa sincronizar estado,
        // apenas dispara a animação no front-end (tratado no onEvent). =====
        case "reveal_document":
        case "participant_joined":
        case "participant_left":
          // Sem estado local pra atualizar — onEvent cuida da UI.
          break;
        // ===== Tarefa 2B: chat_message DEVE ser adicionado ao estado local,
        // senão o onStateChange re-renderiza renderHistory() e apaga a bolha
        // que onEvent acabou de adicionar. =====
        case "chat_message": {
          if (!Array.isArray(s.chatLog)) s.chatLog = [];
          s.chatLog.push(msg.payload);
          if (s.chatLog.length > 50) s.chatLog.shift();
          break;
        }
        // ===== Tarefa 4: Cor do jogador — atualiza mapa participantColors =====
        case "player_color_set": {
          if (!s.participantColors) s.participantColors = {};
          const { userId, color } = msg.payload;
          const existing = s.participantColors[userId] || {};
          s.participantColors[userId] = { ...existing, color };
          break;
        }
        // ===== Tarefa 3: Lista de participantes atualizada =====
        case "participants_updated":
          // Não precisa atualizar estado local — onEvent cuida de re-renderizar.
          // Mas guardamos no estado pra que outros componentes possam acessar.
          if (s) s.participants = msg.payload.participants || [];
          break;
        // ===== v12: Item proposals (jogador → mestre) =====
        case "item_proposal_received":
        case "item_proposal_resolved":
          // Guarda no estado pra persistência após reconexão
          if (s) {
            if (!s.itemProposals) s.itemProposals = [];
            if (msg.type === "item_proposal_received") {
              s.itemProposals.push(msg.payload);
            } else {
              const idx = s.itemProposals.findIndex(p => p.id === msg.payload.id);
              if (idx >= 0) s.itemProposals[idx] = msg.payload;
              else s.itemProposals.push(msg.payload);
            }
          }
          break;
      }
    }

    _notify(status) {
      if (this.onConnectivity) this.onConnectivity(status);
    }
  }

  window.RoomClient = RoomClient;
})();
