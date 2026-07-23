// frontend/js/room-chat.js — UI e lógica do chat da sala
//
// Conecta ao protocolo WebSocket existente (room-ws.js) pra enviar e receber
// mensagens de chat. Sanitiza todo texto com DOMPurify antes de renderizar.

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

  let chatContainer = null;
  let chatInput = null;
  let chatSendBtn = null;
  let currentUserId = null;
  let onSendCallback = null;

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
          <div class="chat-msg chat-msg-system">Nenhuma mensagem ainda. Diga olá! 👋</div>
        </div>
        <div class="chat-input-row">
          <input type="text" id="chat-input" placeholder="Digite uma mensagem…" maxlength="500" autocomplete="off">
          <button class="btn btn-primary btn-sm" id="chat-send">Enviar</button>
        </div>
      </div>
    `;
    chatInput = document.getElementById("chat-input");
    chatSendBtn = document.getElementById("chat-send");
    chatSendBtn.addEventListener("click", sendMessage);
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); sendMessage(); }
    });
  }

  function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || !onSendCallback) return;
    onSendCallback(text);
    chatInput.value = "";
  }

  function renderMessage(msg) {
    const msgs = document.getElementById("chat-messages");
    if (!msgs) return;
    const isSelf = msg.senderUserId === currentUserId;
    const cls = isSelf ? "chat-msg-self" : "chat-msg-other";
    const senderHtml = isSelf ? "" : `<div class="chat-msg-sender">${escapeHtml(msg.senderUsername)}</div>`;
    const div = document.createElement("div");
    div.className = `chat-msg ${cls}`;
    div.innerHTML = `${senderHtml}${sanitizeText(msg.text)}<div class="chat-msg-time">${formatTime(msg.timestamp)}</div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function renderHistory(messages) {
    const msgs = document.getElementById("chat-messages");
    if (!msgs) return;
    msgs.innerHTML = "";
    if (!messages || messages.length === 0) {
      msgs.innerHTML = `<div class="chat-msg chat-msg-system">Nenhuma mensagem ainda. Diga olá! 👋</div>`;
      return;
    }
    messages.forEach(m => renderMessage(m));
  }

  window.roomChat = { init, renderMessage, renderHistory, renderEmpty };
})();
