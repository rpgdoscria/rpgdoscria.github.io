// frontend/js/poll.js — sistema de enquetes (polls) da sala
//
// Funcionalidades:
// 1. Qualquer participante cria poll (pergunta + 2-5 opções)
// 2. Poll aparece como modal para todos via WebSocket
// 3. Cada participante vota (pode mudar voto enquanto ativa)
// 4. Chat dedicado dentro do modal da poll
// 5. Criador ou mestre encerra → resultados finais
// 6. Histórico de polls encerradas

(function () {
  let activePoll = null;
  let pollHistory = [];
  let wsClient = null;

  function init(client) {
    wsClient = client;
    if (wsClient) {
      const origOnEvent = wsClient.onEvent;
      wsClient.onEvent = (msg) => {
        if (msg.type === "poll_created") handlePollCreated(msg.payload);
        else if (msg.type === "poll_updated") handlePollUpdated(msg.payload);
        else if (msg.type === "poll_ended") handlePollEnded(msg.payload);
        else if (msg.type === "poll_chat") handlePollChat(msg.payload);
        if (origOnEvent) origOnEvent(msg);
      };
    }
  }

  // Criar poll
  function createPoll(question, options) {
    if (!wsClient) return;
    wsClient.send("create_poll", { question, options });
  }

  // Votar
  function vote(pollId, optionIndex) {
    if (!wsClient) return;
    wsClient.send("vote_poll", { pollId, optionIndex });
  }

  // Enviar chat da poll
  function sendPollChat(pollId, message) {
    if (!wsClient) return;
    wsClient.send("send_poll_chat", { pollId, message });
  }

  // Encerrar poll
  function endPoll(pollId) {
    if (!wsClient) return;
    wsClient.send("end_poll", { pollId });
  }

  // Abrir modal de criação
  function openCreator() {
    const existing = document.getElementById("poll-create-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "poll-create-overlay";
    overlay.className = "modal-backdrop";
    overlay.style.display = "grid";

    overlay.innerHTML = `
      <div class="modal-card" style="max-width:440px">
        <h3 style="margin:0 0 16px 0">📊 Criar enquete</h3>
        <div class="field">
          <label>Pergunta:</label>
          <input type="text" id="poll-question" placeholder="Ex: Seguimos em frente ou exploramos a caverna?" maxlength="200">
        </div>
        <div class="field">
          <label>Opções (2 a 5):</label>
          <div id="poll-options-list">
            <input type="text" class="poll-option-input" placeholder="Opção 1" maxlength="100">
            <input type="text" class="poll-option-input" placeholder="Opção 2" maxlength="100" style="margin-top:6px">
          </div>
          <button class="btn btn-sm btn-ghost mt-2" id="poll-add-option">+ Adicionar opção</button>
        </div>
        <div class="flex gap-2" style="justify-content:flex-end">
          <button class="btn btn-ghost" id="poll-cancel">Cancelar</button>
          <button class="btn btn-primary" id="poll-create-btn">Criar enquete</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let optionCount = 2;
    overlay.querySelector("#poll-add-option").addEventListener("click", () => {
      if (optionCount >= 5) return;
      const list = overlay.querySelector("#poll-options-list");
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "poll-option-input";
      inp.placeholder = `Opção ${++optionCount}`;
      inp.maxLength = 100;
      inp.style.marginTop = "6px";
      list.appendChild(inp);
      if (optionCount >= 5) overlay.querySelector("#poll-add-option").classList.add("hidden");
    });

    overlay.querySelector("#poll-create-btn").addEventListener("click", () => {
      const question = overlay.querySelector("#poll-question").value.trim();
      const options = Array.from(overlay.querySelectorAll(".poll-option-input"))
        .map(i => i.value.trim()).filter(Boolean);
      if (!question) { alert("Digite a pergunta."); return; }
      if (options.length < 2) { alert("Precisa pelo menos 2 opções."); return; }
      createPoll(question, options);
      overlay.remove();
    });
    overlay.querySelector("#poll-cancel").addEventListener("click", () => overlay.remove());
  }

  // Poll recebida — mostra modal
  function handlePollCreated(payload) {
    activePoll = payload;
    renderPollModal(payload);
  }

  function handlePollUpdated(payload) {
    activePoll = payload;
    const modal = document.getElementById("poll-active-overlay");
    if (modal) renderPollModal(payload);
  }

  function handlePollEnded(payload) {
    activePoll = null;
    const modal = document.getElementById("poll-active-overlay");
    if (modal) {
      modal.querySelector(".poll-modal-status").innerHTML = `<span class="tag tag-off">Encerrada</span>`;
      modal.querySelector("#poll-end-btn")?.classList.add("hidden");
      // Atualiza resultados finais
      renderResults(payload, modal);
    }
    setTimeout(() => {
      if (modal) modal.remove();
    }, 5000);
  }

  function handlePollChat(payload) {
    if (!activePoll || activePoll.id !== payload.pollId) return;
    const chatEl = document.querySelector("#poll-chat-messages");
    if (!chatEl) return;
    const isSelf = payload.userId === (window._roomClient?.userId);
    const cls = isSelf ? "chat-msg-self" : "chat-msg-other";
    const div = document.createElement("div");
    div.className = `chat-msg ${cls}`;
    div.innerHTML = `${isSelf ? "" : `<div class="chat-msg-sender">${esc(payload.username)}</div>`}${esc(payload.message)}<div class="chat-msg-time">${formatTime(payload.timestamp)}</div>`;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function renderPollModal(payload) {
    const existing = document.getElementById("poll-active-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "poll-active-overlay";
    overlay.className = "modal-backdrop";
    overlay.style.display = "grid";

    const myVote = payload.votes?.find(v => v.userId === (window._roomClient?.userId));
    const voteCounts = {};
    (payload.votes || []).forEach(v => { voteCounts[v.optionIndex] = (voteCounts[v.optionIndex] || 0) + 1; });
    const totalVotes = (payload.votes || []).length;

    overlay.innerHTML = `
      <div class="modal-card poll-modal" style="max-width:480px">
        <div class="flex items-center justify-between mb-3">
          <h3 style="margin:0">📊 ${esc(payload.question)}</h3>
          <div class="poll-modal-status">
            ${payload.isActive ? '<span class="tag tag-on">Ativa</span>' : '<span class="tag tag-off">Encerrada</span>'}
          </div>
        </div>
        <div class="poll-options" id="poll-options"></div>
        <div class="text-xs muted mt-2 mb-3">${totalVotes} voto(s) total</div>
        ${payload.isActive ? `
          <div class="poll-chat-section">
            <div class="text-xs muted mb-1">💬 Chat da enquete:</div>
            <div class="poll-chat-messages" id="poll-chat-messages" style="max-height:150px;overflow-y:auto;margin-bottom:8px">
              ${(payload.chat || []).map(m => `<div class="chat-msg ${m.userId === window._roomClient?.userId ? 'chat-msg-self' : 'chat-msg-other'}" style="font-size:12px">${esc(m.username)}: ${esc(m.message)}</div>`).join("")}
            </div>
            <div class="flex gap-2">
              <input type="text" id="poll-chat-input" placeholder="Comentar..." maxlength="500" style="flex:1;background:var(--surface);border:1px solid var(--border-soft);border-radius:var(--radius);padding:6px 10px;color:var(--text);font-size:13px">
              <button class="btn btn-sm btn-primary" id="poll-chat-send">Enviar</button>
            </div>
          </div>
        ` : ""}
        <div class="flex gap-2 mt-3" style="justify-content:flex-end">
          ${payload.isActive ? `<button class="btn btn-sm btn-danger" id="poll-end-btn">Encerrar</button>` : ""}
          <button class="btn btn-sm btn-ghost" id="poll-close">Fechar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Renderiza opções
    const optsEl = overlay.querySelector("#poll-options");
    optsEl.innerHTML = payload.options.map((opt, i) => {
      const count = voteCounts[i] || 0;
      const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      const isMyVote = myVote && myVote.optionIndex === i;
      return `
        <div class="poll-option ${isMyVote ? 'selected' : ''}" data-option-idx="${i}">
          <div class="poll-option-label">
            <span>${isMyVote ? '✓ ' : ''}${esc(opt)}</span>
            <span class="poll-option-count">${count} (${pct}%)</span>
          </div>
          <div class="poll-option-bar">
            <div class="poll-option-bar-fill" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    }).join("");

    // Click numa opção = votar
    if (payload.isActive) {
      optsEl.querySelectorAll(".poll-option").forEach(el => {
        el.addEventListener("click", () => {
          const idx = Number(el.dataset.optionIdx);
          vote(payload.id, idx);
        });
      });
    }

    // Chat
    const chatInput = overlay.querySelector("#poll-chat-input");
    if (chatInput) {
      chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const msg = chatInput.value.trim();
          if (msg) { sendPollChat(payload.id, msg); chatInput.value = ""; }
        }
      });
      overlay.querySelector("#poll-chat-send").addEventListener("click", () => {
        const msg = chatInput.value.trim();
        if (msg) { sendPollChat(payload.id, msg); chatInput.value = ""; }
      });
    }

    // Encerrar
    const endBtn = overlay.querySelector("#poll-end-btn");
    if (endBtn) endBtn.addEventListener("click", () => {
      if (confirm("Encerrar esta enquete?")) endPoll(payload.id);
    });

    overlay.querySelector("#poll-close").addEventListener("click", () => overlay.remove());
  }

  function renderResults(payload, modal) {
    // Re-renderiza opções com resultados finais
    const optsEl = modal.querySelector("#poll-options");
    if (!optsEl) return;
    const voteCounts = {};
    (payload.votes || []).forEach(v => { voteCounts[v.optionIndex] = (voteCounts[v.optionIndex] || 0) + 1; });
    const totalVotes = (payload.votes || []).length;
    optsEl.innerHTML = payload.options.map((opt, i) => {
      const count = voteCounts[i] || 0;
      const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      return `
        <div class="poll-option">
          <div class="poll-option-label"><span>${esc(opt)}</span><span class="poll-option-count">${count} (${pct}%)</span></div>
          <div class="poll-option-bar"><div class="poll-option-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join("");
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }
  function formatTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  window.pollSystem = { init, openCreator, createPoll, vote, endPoll, sendPollChat };
})();
