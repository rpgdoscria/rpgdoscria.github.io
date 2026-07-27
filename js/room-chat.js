// frontend/js/room-chat.js — UI e lógica do chat da sala (versão bolhas)
//
// Reformulado (Tarefa 2): agora cada mensagem é uma bolha com:
//   - Avatar do personagem (foto ou inicial) com borda na cor do jogador
//   - Nome do personagem (ou username se mestre) na cor do jogador
//   - Texto com fundo colorido pela cor do jogador (mensagens self)
//   - Bolhas self alinhadas à direita, others à esquerda
//   - Mensagens de sistema em estilo diferenciado (itálico, cinza, sem foto)
//   - Scroll automático segue novas mensagens (exceto se usuário rolou pra cima)

(function () {
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }
  function sanitizeText(s) {
    if (!window.DOMPurify) return escapeHtml(s);
    return escapeHtml(window.DOMPurify.sanitize(String(s ?? ""), { ALLOWED_TAGS: [] }));
  }
  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  // Mapa de cores dos participantes: userId -> { color, characterName, photoUrl }
  // Populado por sala quando recebe eventos set_player_color ou room_state.
  let participantColors = {};
  let currentUserId = null;
  let onSendCallback = null;
  let chatContainer = null;
  let chatInput = null;
  let chatSendBtn = null;
  let autoScrollEnabled = true;

  // Atualiza as cores dos participantes — chamado externamente por sala
  function setParticipantColors(map) {
    participantColors = Object.assign({}, participantColors, map);
  }

  function getParticipantInfo(userId) {
    return participantColors[userId] || { color: "#888888", characterName: null, photoUrl: null };
  }

  function init(containerSelector, userId, sendCallback) {
    chatContainer = document.querySelector(containerSelector);
    if (!chatContainer) return;
    currentUserId = userId;
    onSendCallback = sendCallback;
    renderEmpty();
  }

  function renderEmpty() {
    if (!chatContainer) return;
    chatContainer.innerHTML = `
      <div class="chat-container">
        <div class="chat-messages" id="chat-messages">
          <div class="chat-bubble-system">Nenhuma mensagem ainda. Diga olá! 👋</div>
        </div>
        <div class="chat-input-row">
          <input type="text" id="chat-input" placeholder="Digite uma mensagem…" maxlength="500" autocomplete="off">
          <button class="btn btn-primary btn-sm" id="chat-send">Enviar</button>
        </div>
      </div>
    `;
    const msgs = document.getElementById("chat-messages");
    chatInput = document.getElementById("chat-input");
    chatSendBtn = document.getElementById("chat-send");
    chatSendBtn.addEventListener("click", sendMessage);
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); sendMessage(); }
    });
    // Detecta scroll pra desabilitar auto-scroll se usuário subiu
    msgs.addEventListener("scroll", () => {
      const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;
      autoScrollEnabled = atBottom;
    });
  }

  function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || !onSendCallback) return;
    onSendCallback(text);
    chatInput.value = "";
    autoScrollEnabled = true;  // reabilita auto-scroll após enviar
  }

  function maybeAutoScroll() {
    if (!autoScrollEnabled) return;
    const msgs = document.getElementById("chat-messages");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function renderMessage(msg) {
    const msgs = document.getElementById("chat-messages");
    if (!msgs) return;

    // Mensagem de sistema (senderUserId === 0 ou senderUsername === "sistema")
    if (msg.senderUserId === 0 || msg.senderUsername === "sistema") {
      const sysDiv = document.createElement("div");
      sysDiv.className = "chat-bubble-system";
      sysDiv.textContent = msg.text;
      msgs.appendChild(sysDiv);
      maybeAutoScroll();
      return;
    }

    const isSelf = msg.senderUserId === currentUserId;
    const info = getParticipantInfo(msg.senderUserId);
    // Tarefa 4: usa senderDisplayName (nome do personagem) se disponível;
    // senão usa characterName do participantColors; senão username.
    const displayName = msg.senderDisplayName || info.characterName || msg.senderUsername || "desconhecido";
    const color = info.color || "#888888";
    const initial = (displayName || "?").charAt(0).toUpperCase();

    // Avatar
    const avatarHtml = info.photoUrl
      ? `<div class="chat-bubble-avatar" style="border-color:${escapeHtml(color)}"><img src="${escapeHtml(info.photoUrl)}" alt=""></div>`
      : `<div class="chat-bubble-avatar" style="border-color:${escapeHtml(color)};background:${escapeHtml(color)}33;color:${escapeHtml(color)}">${escapeHtml(initial)}</div>`;

    // Bolha — self usa cor do jogador como fundo, others usa surface
    const bubbleStyle = isSelf
      ? `background:${escapeHtml(color)};color:#fff`
      : `background:var(--surface);border-left:3px solid ${escapeHtml(color)}`;

    const row = document.createElement("div");
    row.className = `chat-bubble-row ${isSelf ? "self" : ""}`;
    row.innerHTML = `
      ${avatarHtml}
      <div class="chat-bubble-content">
        <div class="chat-bubble-sender" style="color:${escapeHtml(color)}">${escapeHtml(displayName)}</div>
        <div class="chat-bubble" style="${bubbleStyle}">${sanitizeText(msg.text)}</div>
        <div class="chat-bubble-time" style="${isSelf ? "color:rgba(255,255,255,0.7)" : ""}">${formatTime(msg.timestamp)}</div>
      </div>
    `;
    msgs.appendChild(row);
    maybeAutoScroll();
  }

  function renderHistory(messages) {
    const msgs = document.getElementById("chat-messages");
    if (!msgs) return;
    msgs.innerHTML = "";
    if (!messages || messages.length === 0) {
      msgs.innerHTML = `<div class="chat-bubble-system">Nenhuma mensagem ainda. Diga olá! 👋</div>`;
      return;
    }
    messages.forEach(m => renderMessage(m));
  }

  window.roomChat = { init, renderMessage, renderHistory, renderEmpty, setParticipantColors };
})();
