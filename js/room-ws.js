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
    constructor(code, characterId) {
      this.code = code;
      this.characterId = characterId;
      this.ws = null;
      this.state = null;
      this.connected = false;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 10;
      this.shouldReconnect = true;
      this.onEvent = null;       // callback (msg) => void
      this.onStateChange = null; // callback (state) => void  (chamado a cada room_state ou atualização incremental)
      this.onConnectivity = null;// callback (status: 'connected'|'reconnecting'|'closed'|'error') => void
    }

    connect() {
      const token = getToken();
      if (!token) {
        this._notify("error");
        location.href = "login.html?next=" + encodeURIComponent(location.pathname + location.search);
        return;
      }
      const params = new URLSearchParams({ code: this.code, token });
      if (this.characterId) params.set("characterId", String(this.characterId));
      const url = `${WS_BASE}/api/rooms/connect?${params}`;

      this._notify("reconnecting");
      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        this._notify("error");
        this._scheduleReconnect();
        return;
      }

      this.ws.addEventListener("open", () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this._notify("connected");
      });

      this.ws.addEventListener("message", (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        this._handleMessage(msg);
      });

      this.ws.addEventListener("close", (e) => {
        this.connected = false;
        this.ws = null;
        this._notify("closed");
        if (this.shouldReconnect && e.code !== 1000 && e.code !== 1008) {
          this._scheduleReconnect();
        }
      });

      this.ws.addEventListener("error", () => {
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
      if (this.ws) {
        try { this.ws.close(1000, "Saindo"); } catch {}
      }
    }

    _scheduleReconnect() {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this._notify("error");
        if (this.onEvent) this.onEvent({ type: "fatal", payload: { message: "Não foi possível reconectar após várias tentativas. Recarregue a página." } });
        return;
      }
      const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 15000);
      this.reconnectAttempts++;
      setTimeout(() => {
        if (this.shouldReconnect) this.connect();
      }, delay);
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
        case "status_effect_added": {
          const { targetType, targetId, effect } = msg.payload;
          if (targetType === "character") {
            const ch = s.characters.find(c => c.id === targetId);
            if (ch) ch.statusEffects.push(effect);
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
      }
    }

    _notify(status) {
      if (this.onConnectivity) this.onConnectivity(status);
    }
  }

  window.RoomClient = RoomClient;
})();
