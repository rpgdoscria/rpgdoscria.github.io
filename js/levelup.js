// frontend/js/levelup.js — sistema de pontos de atributo ao subir de nível
//
// Quando o mestre faz um personagem upar, o jogador recebe um modal
// para distribuir pontos entre seus status do tipo 'number'.

(function () {
  let pendingLevelUp = null;

  function init(wsClient) {
    if (wsClient) {
      const origOnEvent = wsClient.onEvent;
      wsClient.onEvent = (msg) => {
        if (msg.type === 'level_up_available') handleLevelUpAvailable(msg.payload);
        if (origOnEvent) origOnEvent(msg);
      };
    }
  }

  function handleLevelUpAvailable(payload) {
    pendingLevelUp = payload;
    const existing = document.getElementById('levelup-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'levelup-overlay';
    overlay.className = 'modal-backdrop';
    overlay.style.display = 'grid';

    const stats = payload.eligibleStats || [];
    const points = payload.points || 0;
    let allocations = {};
    stats.forEach(s => allocations[s.statId] = 0);

    function getRemaining() {
      const used = Object.values(allocations).reduce((a, b) => a + b, 0);
      return points - used;
    }

    overlay.innerHTML = `
      <div class="modal-card" style="max-width:420px">
        <h3 style="margin:0 0 8px 0;color:var(--success)">🎉 Subiu de nível!</h3>
        <p class="text-sm muted mb-4">Distribua ${points} pontos entre seus atributos.</p>
        <div id="levelup-stats"></div>
        <div class="flex items-center justify-between mt-4">
          <span class="text-sm">Pontos restantes: <strong id="levelup-remaining" style="color:var(--accent-hover)">${points}</strong></span>
          <button class="btn btn-primary" id="levelup-confirm">Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    function renderStats() {
      const container = overlay.querySelector('#levelup-stats');
      container.innerHTML = stats.map(s => `
        <div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px solid var(--border-soft)">
          <span>${escapeHtml(s.name)}</span>
          <div class="flex items-center gap-2">
            <button class="btn btn-sm btn-ghost" data-stat-id="${s.statId}" data-delta="-1">−</button>
            <span style="min-width:40px;text-align:center;font-family:var(--font-mono);font-weight:600">
              +<span id="alloc-${s.statId}">${allocations[s.statId]}</span>
            </span>
            <button class="btn btn-sm btn-ghost" data-stat-id="${s.statId}" data-delta="1">+</button>
          </div>
        </div>
      `).join('');

      container.querySelectorAll('button[data-stat-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          const statId = Number(btn.dataset.statId);
          const delta = Number(btn.dataset.delta);
          const newVal = allocations[statId] + delta;
          if (newVal < 0) return;
          if (delta > 0 && getRemaining() <= 0) return;
          allocations[statId] = newVal;
          overlay.querySelector(`#alloc-${statId}`).textContent = newVal;
          overlay.querySelector('#levelup-remaining').textContent = getRemaining();
        });
      });
    }
    renderStats();

    overlay.querySelector('#levelup-confirm').addEventListener('click', () => {
      if (getRemaining() > 0) {
        if (!confirm('Você ainda tem pontos não distribuídos. Confirmar mesmo assim?')) return;
      }
      const ws = window._roomClient;
      if (ws) ws.send('level_up_points', { allocations, characterId: payload.characterId });
      overlay.remove();
    });
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  window.levelUpSystem = { init };
})();
