// frontend/js/purchase.js — sistema de compras com prompt do mestre
//
// O mestre pode criar uma oferta de compra para um jogador específico.
// O jogador vê um popup e pode aceitar/recusar.

(function () {
  function init(wsClient) {
    if (wsClient) {
      const origOnEvent = wsClient.onEvent;
      wsClient.onEvent = (msg) => {
        if (msg.type === 'purchase_offer') handlePurchaseOffer(msg.payload);
        if (origOnEvent) origOnEvent(msg);
      };
    }
  }

  // Jogador recebe oferta de compra do mestre
  function handlePurchaseOffer(payload) {
    const existing = document.getElementById('purchase-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'purchase-overlay';
    overlay.className = 'modal-backdrop';
    overlay.style.display = 'grid';

    overlay.innerHTML = `
      <div class="modal-card" style="max-width:380px;text-align:center">
        <h3 style="margin:0 0 8px 0">🛒 Oferta do mestre</h3>
        <div style="font-size:48px;margin:16px 0">📦</div>
        <h4 style="margin:0 0 4px 0">${escapeHtml(payload.item)}</h4>
        ${payload.description ? `<p class="text-sm muted mb-3">${escapeHtml(payload.description)}</p>` : ''}
        <div class="card" style="padding:12px;margin-bottom:16px">
          <div class="text-sm muted">Preço:</div>
          <div style="font-size:24px;font-weight:700;color:var(--warning)">
            💰 ${payload.price} ${escapeHtml(payload.priceType || 'moedas')}
          </div>
        </div>
        <div class="flex gap-2" style="justify-content:center">
          <button class="btn btn-ghost" id="purchase-reject">Não, obrigado</button>
          <button class="btn btn-primary" id="purchase-accept">Comprar!</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#purchase-accept').addEventListener('click', () => {
      const ws = window._roomClient;
      if (ws) ws.send('respond_purchase', { offerId: payload.offerId, accept: true });
      overlay.remove();
    });
    overlay.querySelector('#purchase-reject').addEventListener('click', () => {
      const ws = window._roomClient;
      if (ws) ws.send('respond_purchase', { offerId: payload.offerId, accept: false });
      overlay.remove();
    });
  }

  // Mestre cria oferta de compra para um jogador
  function openPurchaseCreator(targetCharacters) {
    const existing = document.getElementById('purchase-create-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'purchase-create-overlay';
    overlay.className = 'modal-backdrop';
    overlay.style.display = 'grid';

    const targets = targetCharacters.map(c =>
      `<option value="${c.ownerUserId}">${escapeHtml(c.name)} (${escapeHtml(c.ownerUsername)})</option>`
    ).join('');

    overlay.innerHTML = `
      <div class="modal-card" style="max-width:420px">
        <h3 style="margin:0 0 16px 0">🛒 Oferecer compra a jogador</h3>
        <div class="field">
          <label>Jogador:</label>
          <select id="purchase-target">${targets}</select>
        </div>
        <div class="field">
          <label>Item:</label>
          <input type="text" id="purchase-item" placeholder="Ex: Espada Longa">
        </div>
        <div class="field">
          <label>Descrição (opcional):</label>
          <input type="text" id="purchase-desc" placeholder="Ex: Aço élfico, +1 dano">
        </div>
        <div class="grid-2">
          <div class="field">
            <label>Preço:</label>
            <input type="number" id="purchase-price" value="10" min="0">
          </div>
          <div class="field">
            <label>Tipo de pagamento:</label>
            <select id="purchase-price-type">
              <option value="moedas">Moedas</option>
              <option value="xp">XP</option>
            </select>
          </div>
        </div>
        <div class="flex gap-2" style="justify-content:flex-end">
          <button class="btn btn-ghost" id="purchase-cancel">Cancelar</button>
          <button class="btn btn-primary" id="purchase-send">Enviar oferta</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#purchase-send').addEventListener('click', () => {
      const targetUserId = Number(overlay.querySelector('#purchase-target').value);
      const item = overlay.querySelector('#purchase-item').value.trim();
      const desc = overlay.querySelector('#purchase-desc').value.trim();
      const price = Number(overlay.querySelector('#purchase-price').value) || 0;
      const priceType = overlay.querySelector('#purchase-price-type').value;
      if (!item) { alert('Digite o nome do item.'); return; }

      const ws = window._roomClient;
      if (ws) ws.send('create_purchase', { targetUserId, itemName: item, itemDescription: desc, price, priceType });
      overlay.remove();
    });
    overlay.querySelector('#purchase-cancel').addEventListener('click', () => overlay.remove());
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  window.purchaseSystem = { init, openPurchaseCreator };
})();
