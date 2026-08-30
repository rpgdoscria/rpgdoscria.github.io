// Sistema de trocas da sala — seleção simples dos dois lados da negociação.
// Cada item possui quantidade própria e a troca só é aceita se os ativos ainda
// existirem no personagem escolhido.

(function () {
  const pendingTrades = {};

  function init(wsClient) {
    if (!wsClient) return;
    const original = wsClient.onEvent;
    wsClient.onEvent = (msg) => {
      if (msg.type === "trade_proposed") handleTradeProposed(msg.payload);
      if (msg.type === "trade_updated") delete pendingTrades[msg.payload.id || msg.payload.tradeId];
      if (original) original(msg);
    };
  }

  function proposeTrade(wsClient, targetUserId, targetCharacterId, offer, request) {
    return wsClient?.send("propose_trade", { targetUserId, targetCharacterId, offer, request });
  }

  function respondTrade(wsClient, tradeId, action) {
    if (typeof action === "boolean") action = action ? "accept" : "reject";
    return wsClient?.send("respond_trade", { tradeId, action });
  }

  function formatItems(items) {
    if (!items?.length) return `<span class="muted text-sm">Nada</span>`;
    return items.map(i => `<div class="text-sm">• ${escapeHtml(i.name)} ×${i.qty}</div>`).join("");
  }

  function handleTradeProposed(payload) {
    const ws = window._roomClient;
    if (ws && payload.receiverUserId !== ws.userId) return;
    pendingTrades[payload.id || payload.tradeId] = payload;
    document.getElementById("trade-modal-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "trade-modal-overlay";
    overlay.className = "modal-backdrop";
    overlay.style.display = "grid";
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:600px">
        <div class="flex items-center justify-between mb-3">
          <div><h3 style="margin:0">🤝 Proposta de troca</h3><p class="muted text-sm" style="margin:4px 0 0">${escapeHtml(payload.proposerName)} quer negociar com você.</p></div>
          <button class="btn btn-sm btn-ghost" id="trade-close">✕</button>
        </div>
        <div class="grid-2 mb-4">
          <div class="card" style="padding:14px"><div class="text-xs muted mb-1">VOCÊ RECEBE</div>${formatItems(payload.offer.items)}${payload.offer.money ? `<div class="text-sm">💰 ${payload.offer.money} moedas</div>` : ""}</div>
          <div class="card" style="padding:14px"><div class="text-xs muted mb-1">VOCÊ ENTREGA</div>${formatItems(payload.request.items)}${payload.request.money ? `<div class="text-sm">💰 ${payload.request.money} moedas</div>` : ""}</div>
        </div>
        <div class="alert alert-info text-sm">Confira os itens antes de aceitar. A troca é validada novamente no servidor.</div>
        <div class="flex gap-2" style="justify-content:flex-end">
          <button class="btn btn-danger" id="trade-reject">Recusar</button>
          <button class="btn btn-ghost" id="trade-counter">Alterar proposta</button>
          <button class="btn btn-primary" id="trade-accept">Aceitar troca</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#trade-close").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#trade-accept").addEventListener("click", () => { respondTrade(ws, payload.id || payload.tradeId, "accept"); overlay.remove(); });
    overlay.querySelector("#trade-reject").addEventListener("click", () => { respondTrade(ws, payload.id || payload.tradeId, "reject"); overlay.remove(); });
    overlay.querySelector("#trade-counter").addEventListener("click", () => {
      overlay.remove();
      const state = window._roomState;
      const mine = state?.characters?.find(c => c.ownerUserId === ws?.userId);
      const theirs = state?.characters?.find(c => c.id === payload.proposerCharacterId) || state?.characters?.find(c => c.ownerUserId === payload.proposerUserId);
      if (mine && theirs) openTradeCreator(mine, [theirs]);
      else alert("Não foi possível abrir a contraproposta porque um dos personagens não está na sala.");
    });
  }

  function itemPicker(items, prefix, title) {
    const rows = (items || []).map((it, i) => `
      <label class="trade-item-option">
        <input type="checkbox" data-trade-check="${prefix}" data-item-index="${i}">
        <span class="trade-item-name">${escapeHtml(it.name)}</span><span class="muted text-xs">possui ${it.qty}</span>
        <input class="trade-item-qty" type="number" data-trade-qty="${prefix}" data-item-index="${i}" value="1" min="1" max="${Math.max(1, Number(it.qty) || 1)}" disabled>
      </label>`).join("");
    return `<div class="trade-side"><div class="text-xs muted mb-1">${title}</div>${rows || `<span class="muted text-sm">Sem itens</span>`}</div>`;
  }

  function readItems(character, prefix, root) {
    const result = [];
    root.querySelectorAll(`input[data-trade-check="${prefix}"]:checked`).forEach(check => {
      const index = Number(check.dataset.itemIndex);
      const item = character.inventory?.[index];
      const qtyInput = root.querySelector(`input[data-trade-qty="${prefix}"][data-item-index="${index}"]`);
      const qty = Math.max(1, Math.min(Number(item?.qty) || 1, Number(qtyInput?.value) || 1));
      if (item) result.push({ name: item.name, qty, description: item.description, iconUrl: item.iconUrl || null });
    });
    return result;
  }

  function openTradeCreator(myCharacter, otherCharacters) {
    document.getElementById("trade-create-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "trade-create-overlay";
    overlay.className = "modal-backdrop";
    overlay.style.display = "grid";
    const options = otherCharacters.map(c => `<option value="${c.id}">${escapeHtml(c.name)} — ${escapeHtml(c.ownerUsername || "jogador")}</option>`).join("");
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:760px">
        <div class="flex items-center justify-between mb-3"><div><h3 style="margin:0">🤝 Nova troca</h3><p class="muted text-sm" style="margin:4px 0 0">Escolha o que sai e o que entra. Você pode negociar parte da quantidade.</p></div><button class="btn btn-sm btn-ghost" id="trade-create-close">✕</button></div>
        <div class="field"><label for="trade-target">Negociar com</label><select id="trade-target">${options}</select></div>
        <div class="grid-2 mb-3" id="trade-pickers">
          ${itemPicker(myCharacter.inventory, "offer", "VOCÊ ENTREGA")}
          ${itemPicker(otherCharacters[0]?.inventory, "request", "VOCÊ RECEBE")}
        </div>
        <div class="grid-2">
          <div class="field"><label>Moedas que você entrega</label><input type="number" id="trade-offer-money" value="0" min="0"></div>
          <div class="field"><label>Moedas que você recebe</label><input type="number" id="trade-request-money" value="0" min="0"></div>
        </div>
        <div id="trade-create-alert"></div>
        <div class="modal-actions"><button class="btn btn-ghost" id="trade-create-cancel">Cancelar</button><button class="btn btn-primary" id="trade-send">Enviar proposta</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const targetSelect = overlay.querySelector("#trade-target");
    const pickers = overlay.querySelector("#trade-pickers");
    const renderTargetItems = () => {
      const target = otherCharacters.find(c => c.id === Number(targetSelect.value)) || otherCharacters[0];
      pickers.querySelector(".trade-side:last-child").outerHTML = itemPicker(target?.inventory, "request", "VOCÊ RECEBE");
      bindCheckBoxes(pickers);
    };
    targetSelect.addEventListener("change", renderTargetItems);
    bindCheckBoxes(overlay);
    const close = () => overlay.remove();
    overlay.querySelector("#trade-create-close").addEventListener("click", close);
    overlay.querySelector("#trade-create-cancel").addEventListener("click", close);
    overlay.querySelector("#trade-send").addEventListener("click", () => {
      const target = otherCharacters.find(c => c.id === Number(targetSelect.value)) || otherCharacters[0];
      const offer = { items: readItems(myCharacter, "offer", overlay), money: Math.max(0, Number(overlay.querySelector("#trade-offer-money").value) || 0) };
      const request = { items: readItems(target, "request", overlay), money: Math.max(0, Number(overlay.querySelector("#trade-request-money").value) || 0) };
      if (!offer.items.length && !offer.money && !request.items.length && !request.money) {
        overlay.querySelector("#trade-create-alert").innerHTML = `<div class="alert alert-error">Selecione pelo menos um item ou valor.</div>`;
        return;
      }
      const ws = window._roomClient;
      if (!ws || !target) return;
      proposeTrade(ws, target.ownerUserId, target.id, offer, request);
      close();
    });
  }

  function bindCheckBoxes(root) {
    root.querySelectorAll("input[data-trade-check]").forEach(check => {
      check.addEventListener("change", () => {
        const qty = root.querySelector(`input[data-trade-qty="${check.dataset.tradeCheck}"][data-item-index="${check.dataset.itemIndex}"]`);
        if (qty) qty.disabled = !check.checked;
      });
    });
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  window.tradeSystem = { init, openTradeCreator, proposeTrade, respondTrade };
})();
