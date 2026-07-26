// frontend/js/trade.js — sistema de trocas entre jogadores
//
// Permite que um jogador proponha troca de itens/dinheiro com outro.
// O outro jogador recebe notificação e pode aceitar/recusar.

(function () {
  let pendingTrades = {};

  function init(wsClient) {
    // Registra handler para mensagens de troca vindas do servidor
    if (wsClient) {
      const origOnEvent = wsClient.onEvent;
      wsClient.onEvent = (msg) => {
        if (msg.type === 'trade_proposed') handleTradeProposed(msg.payload);
        else if (msg.type === 'trade_updated') handleTradeUpdated(msg.payload);
        if (origOnEvent) origOnEvent(msg);
      };
    }
  }

  // Jogador propõe troca
  function proposeTrade(wsClient, targetUserId, offer, request) {
    wsClient.send('propose_trade', { targetUserId, offer, request });
  }

  // Responder a uma troca
  function respondTrade(wsClient, tradeId, accept) {
    wsClient.send('respond_trade', { tradeId, accept });
  }

  // Recebeu proposta de troca — mostra modal
  function handleTradeProposed(payload) {
    pendingTrades[payload.tradeId] = payload;
    const existing = document.getElementById('trade-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'trade-modal-overlay';
    overlay.className = 'modal-backdrop';
    overlay.style.display = 'grid';

    const formatItems = (items) => {
      if (!items || !items.length) return '<span class="muted text-sm">Nada</span>';
      return items.map(i => `<div class="text-sm">• ${escapeHtml(i.name)} ${i.qty > 1 ? '×' + i.qty : ''}</div>`).join('');
    };

    overlay.innerHTML = `
      <div class="modal-card" style="max-width:500px">
        <h3 style="margin:0 0 16px 0">🤝 Troca proposta por ${escapeHtml(payload.proposerName)}</h3>
        <div class="grid-2 mb-4">
          <div class="card" style="padding:12px">
            <div class="text-xs muted mb-1">ELE OFERECE:</div>
            ${formatItems(payload.offer.items)}
            ${payload.offer.money ? `<div class="text-sm">💰 ${payload.offer.money} moedas</div>` : ''}
          </div>
          <div class="card" style="padding:12px">
            <div class="text-xs muted mb-1">ELE QUER:</div>
            ${formatItems(payload.request.items)}
            ${payload.request.money ? `<div class="text-sm">💰 ${payload.request.money} moedas</div>` : ''}
          </div>
        </div>
        <div class="flex gap-2" style="justify-content:flex-end">
          <button class="btn btn-danger" id="trade-reject">Recusar</button>
          <button class="btn btn-primary" id="trade-accept">Aceitar troca</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#trade-accept').addEventListener('click', () => {
      const ws = window._roomClient;
      if (ws) respondTrade(ws, payload.tradeId, true);
      overlay.remove();
    });
    overlay.querySelector('#trade-reject').addEventListener('click', () => {
      const ws = window._roomClient;
      if (ws) respondTrade(ws, payload.tradeId, false);
      overlay.remove();
    });
  }

  function handleTradeUpdated(payload) {
    delete pendingTrades[payload.tradeId];
    // Atualização visual já vem via chat_message (sistema)
  }

  // Abre painel para criar proposta de troca
  function openTradeCreator(myCharacter, otherCharacters) {
    const existing = document.getElementById('trade-create-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'trade-create-overlay';
    overlay.className = 'modal-backdrop';
    overlay.style.display = 'grid';

    const otherOptions = otherCharacters.map(c =>
      `<option value="${c.ownerUserId}">${escapeHtml(c.name)} (${escapeHtml(c.ownerUsername)})</option>`
    ).join('');

    const myItems = (myCharacter.inventory || []).map((it, i) =>
      `<label class="text-sm"><input type="checkbox" data-item-idx="${i}"> ${escapeHtml(it.name)} ${it.qty > 1 ? '×' + it.qty : ''}</label>`
    ).join('');

    overlay.innerHTML = `
      <div class="modal-card" style="max-width:500px">
        <h3 style="margin:0 0 16px 0">🤝 Propor troca</h3>
        <div class="field">
          <label>Trocar com:</label>
          <select id="trade-target">${otherOptions}</select>
        </div>
        <div class="field">
          <label>Eu ofereço (itens):</label>
          <div style="max-height:120px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:8px;padding:8px">
            ${myItems || '<span class="muted text-sm">Sem itens</span>'}
          </div>
        </div>
        <div class="field">
          <label>Eu ofereço (moedas):</label>
          <input type="number" id="trade-offer-money" value="0" min="0">
        </div>
        <div class="field">
          <label>Eu quero (moedas):</label>
          <input type="number" id="trade-request-money" value="0" min="0">
        </div>
        <div class="flex gap-2" style="justify-content:flex-end">
          <button class="btn btn-ghost" id="trade-cancel">Cancelar</button>
          <button class="btn btn-primary" id="trade-send">Enviar proposta</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#trade-send').addEventListener('click', () => {
      const targetUserId = Number(overlay.querySelector('#trade-target').value);
      const offerItems = [];
      overlay.querySelectorAll('input[data-item-idx]:checked').forEach(cb => {
        const idx = Number(cb.dataset.itemIdx);
        const it = myCharacter.inventory[idx];
        if (it) offerItems.push({ name: it.name, qty: it.qty, description: it.description });
      });
      const offerMoney = Number(overlay.querySelector('#trade-offer-money').value) || 0;
      const requestMoney = Number(overlay.querySelector('#trade-request-money').value) || 0;

      const ws = window._roomClient;
      if (ws) proposeTrade(ws, targetUserId, { items: offerItems, money: offerMoney }, { items: [], money: requestMoney });
      overlay.remove();
    });
    overlay.querySelector('#trade-cancel').addEventListener('click', () => overlay.remove());
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  window.tradeSystem = { init, openTradeCreator, proposeTrade, respondTrade };
})();
