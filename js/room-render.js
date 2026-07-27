// frontend/js/room-render.js — renderização da sala (fichas, inimigos, status)
//
// Renderiza o estado da sala em HTML. Toda string vinda do usuário (nome de
// personagem, descrição de inimigo, texto de status, label de fórmula) passa
// por escapeHtml antes de virar innerHTML. Status/descrição customizada
// também passam por DOMPurify (defesa em profundidade — mesmo vindo do
// backend, que já sanitiza, jamais confiamos no cliente).

(function () {
  const ENEMY_PRESETS = ["Ileso", "Arranhado", "Ferido", "Gravemente ferido", "À beira da morte", "Derrotado"];

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  function sanitizeText(s) {
    if (!window.DOMPurify) return escapeHtml(s);
    // Sanitiza e depois escapa — texto livre nunca vira HTML estruturado.
    return escapeHtml(window.DOMPurify.sanitize(String(s ?? ""), { ALLOWED_TAGS: [] }));
  }

  function hpColor(current, max) {
    if (max <= 0) return "var(--text-muted)";
    const pct = current / max;
    if (pct > 0.6) return "var(--success)";
    if (pct > 0.3) return "var(--warning)";
    return "var(--danger)";
  }

  function hpPct(current, max) {
    if (max <= 0) return 0;
    return Math.max(0, Math.min(100, (current / max) * 100));
  }

  // ----- Ficha de personagem -----
  // opts: { editable: bool, isMaster: bool, isOwn: bool, onAction: (type, payload) => void }
  function renderCharacter(ch, opts = {}) {
    const { editable, isMaster, isOwn, onAction } = opts;
    const canEdit = editable && (isOwn || isMaster);
    const hpCol = hpColor(ch.hpCurrent, ch.hpMax);
    const hpWidth = hpPct(ch.hpCurrent, ch.hpMax);

    const barsHtml = (ch.bars || []).map((b, i) => {
      const pct = b.max > 0 ? Math.max(0, Math.min(100, (b.current / b.max) * 100)) : 0;
      return `
        <div class="bar-row">
          <div class="bar-label">
            <span>${escapeHtml(b.name)}</span>
            <span class="bar-values">${b.current}/${b.max}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width: ${pct}%; background: ${escapeHtml(b.color || "#3498db")}"></div>
          </div>
        </div>
      `;
    }).join("");

    const statusHtml = (ch.statusEffects || []).map(s => `
      <span class="status-tag" data-status-id="${escapeHtml(s.id)}">
        ${sanitizeText(s.text)}
        ${isMaster ? `<button class="status-remove" data-action="remove-status" data-target-type="character" data-target-id="${ch.id}" data-status-id="${escapeHtml(s.id)}" title="Remover">×</button>` : ""}
      </span>
    `).join("");

    const inventoryHtml = (ch.inventory || []).length === 0
      ? `<div class="muted text-xs">Sem itens</div>`
      : (ch.inventory || []).map(it => `
        <div class="inv-item">
          <span class="inv-qty">${it.qty}×</span>
          <span class="inv-name">${sanitizeText(it.name)}</span>
          ${it.description ? `<span class="inv-desc muted text-xs">${sanitizeText(it.description)}</span>` : ""}
        </div>
      `).join("");

    return `
      <div class="card character-card ${isOwn ? "own" : ""}" data-character-id="${ch.id}">
        <div class="character-header">
          <div>
            <div class="character-name">${escapeHtml(ch.name)}</div>
            <div class="character-owner muted text-xs">jogador: ${escapeHtml(ch.ownerUsername)}</div>
          </div>
          <div class="character-actions">
            ${canEdit ? `<button class="btn btn-sm" data-action="edit-character" data-character-id="${ch.id}">✎ Editar</button>` : ""}
            ${isMaster && !isOwn ? `<button class="btn btn-sm btn-ghost" data-action="gm-edit-character" data-character-id="${ch.id}">Editar como mestre</button>` : ""}
            ${isMaster ? `<button class="btn btn-sm btn-ghost" data-action="add-status" data-target-type="character" data-target-id="${ch.id}">+ Status</button>` : ""}
          </div>
        </div>

        <div class="hp-row">
          <div class="hp-label">
            <span>HP</span>
            <span class="hp-values" style="color: ${hpCol}">
              ${ch.hpCurrent} / ${ch.hpMax}
            </span>
          </div>
          <div class="hp-track">
            <div class="hp-fill" style="width: ${hpWidth}%; background: ${hpCol}"></div>
          </div>
        </div>

        ${barsHtml ? `<div class="bars-section">${barsHtml}</div>` : ""}

        <div class="money-row">
          <span class="muted text-xs">Dinheiro</span>
          <span class="money-value">${escapeHtml(String(ch.money))}</span>
        </div>

        ${statusHtml ? `<div class="status-list">${statusHtml}</div>` : ""}

        <details class="inventory-section">
          <summary class="muted text-xs">Inventário (${(ch.inventory || []).length})</summary>
          <div class="inventory-list">${inventoryHtml}</div>
        </details>
      </div>
    `;
  }

  // ----- Inimigo -----
  // v12: agora suporta ilustração (illustrationUrl) e stats avançados (stats[]).
  function renderEnemy(en, opts = {}) {
    const { isMaster } = opts;
    const statusHtml = (en.statusEffects || []).map(s => `
      <span class="status-tag enemy-status" data-status-id="${escapeHtml(s.id)}">
        ${sanitizeText(s.text)}
        ${isMaster ? `<button class="status-remove" data-action="remove-status" data-target-type="enemy" data-target-id="${escapeHtml(en.id)}" data-status-id="${escapeHtml(s.id)}" title="Remover">×</button>` : ""}
      </span>
    `).join("");

    let hpBlock = "";
    if (en.hpMode === "numeric") {
      const hpCol = hpColor(en.hpCurrent ?? 0, en.hpMax ?? 0);
      const hpWidth = hpPct(en.hpCurrent ?? 0, en.hpMax ?? 0);
      hpBlock = `
        <div class="hp-row">
          <div class="hp-label">
            <span>HP</span>
            <span class="hp-values" style="color: ${hpCol}">${en.hpCurrent ?? 0} / ${en.hpMax ?? 0}</span>
          </div>
          <div class="hp-track">
            <div class="hp-fill" style="width: ${hpWidth}%; background: ${hpCol}"></div>
          </div>
        </div>
      `;
    } else {
      const presetBadge = ENEMY_PRESETS.includes(en.description)
        ? `<span class="preset-badge ${en.description === "Derrotado" ? "defeated" : ""}">${escapeHtml(en.description)}</span>`
        : `<span class="preset-badge custom">${sanitizeText(en.description)}</span>`;
      hpBlock = `<div class="enemy-description-row">${presetBadge}</div>`;
    }

    // v12: stats avançados do inimigo (barras, números, etc.)
    const enemyStatsHtml = (en.stats || []).length > 0
      ? `<div class="enemy-stats-section">${(en.stats || []).map(s => renderEnemyStat(s, isMaster, en.id)).join("")}</div>`
      : "";

    // v12: ilustração do inimigo (se houver)
    const illustrationHtml = en.illustrationUrl
      ? `<div class="enemy-illustration-wrap">
          <img src="${escapeHtml(en.illustrationUrl)}" alt="${escapeHtml(en.name)}" class="enemy-illustration">
          ${isMaster ? `<button class="btn btn-sm btn-ghost enemy-edit-illustration" data-action="edit-enemy-illustration" data-enemy-id="${escapeHtml(en.id)}" title="Editar ilustração">🎨</button>` : ""}
        </div>`
      : (isMaster
        ? `<div class="enemy-illustration-placeholder" data-action="edit-enemy-illustration" data-enemy-id="${escapeHtml(en.id)}" title="Adicionar ilustração">
            <span class="muted text-xs">+ ilustração</span>
          </div>`
        : "");

    return `
      <div class="card enemy-card ${en.illustrationUrl ? "has-illustration" : ""}" data-enemy-id="${escapeHtml(en.id)}">
        <div class="enemy-header">
          <div class="enemy-header-left">
            ${illustrationHtml}
            <div>
              <div class="enemy-name">${escapeHtml(en.name)}</div>
              <div class="muted text-xs">inimigo</div>
            </div>
          </div>
          <div class="enemy-actions">
            ${isMaster ? `<button class="btn btn-sm" data-action="edit-enemy" data-enemy-id="${escapeHtml(en.id)}" title="Editar">✎</button>` : ""}
            ${isMaster ? `<button class="btn btn-sm btn-ghost" data-action="add-status" data-target-type="enemy" data-target-id="${escapeHtml(en.id)}" title="+ Status">+</button>` : ""}
            ${isMaster ? `<button class="btn btn-sm btn-danger" data-action="delete-enemy" data-enemy-id="${escapeHtml(en.id)}" title="Remover">🗑</button>` : ""}
          </div>
        </div>
        ${hpBlock}
        ${enemyStatsHtml}
        ${statusHtml ? `<div class="status-list">${statusHtml}</div>` : ""}
      </div>
    `;
  }

  // v12: render de UM stat de inimigo (inline editável pelo mestre).
  function renderEnemyStat(stat, isMaster, enemyId) {
    const color = stat.color || "#a78bfa";
    let valueHtml = "";
    switch (stat.type) {
      case "bar": {
        const cur = Number(stat.valueCurrent ?? 0);
        const max = Number(stat.valueMax ?? 0);
        const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
        const colVal = cur > max * 0.6 ? "var(--success)" : cur > max * 0.3 ? "var(--warning)" : "var(--danger)";
        valueHtml = `
          <div class="stat-bar-row">
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%;background:${colVal}"></div></div>
            <span class="stat-bar-values" style="color:${colVal}">${cur}/${max}</span>
            ${isMaster ? `
              <div class="stat-quick-actions">
                <button class="btn-stat-quick" data-enemy-stat-id="${escapeHtml(stat.id)}" data-enemy-id="${escapeHtml(enemyId)}" data-delta="-1">−</button>
                <button class="btn-stat-quick" data-enemy-stat-id="${escapeHtml(stat.id)}" data-enemy-id="${escapeHtml(enemyId)}" data-delta="1">+</button>
              </div>` : ""}
          </div>`;
        break;
      }
      case "number": {
        const v = Number(stat.valueCurrent ?? 0);
        valueHtml = `
          <div class="stat-number-row">
            <span class="stat-number-value" style="color:${escapeHtml(color)}">${v}</span>
            ${isMaster ? `
              <div class="stat-quick-actions">
                <button class="btn-stat-quick" data-enemy-stat-id="${escapeHtml(stat.id)}" data-enemy-id="${escapeHtml(enemyId)}" data-delta="-1">−</button>
                <button class="btn-stat-quick" data-enemy-stat-id="${escapeHtml(stat.id)}" data-enemy-id="${escapeHtml(enemyId)}" data-delta="1">+</button>
              </div>` : ""}
          </div>`;
        break;
      }
      case "text": {
        valueHtml = `<div class="stat-text-value">${sanitizeText(stat.valueText || "")}</div>`;
        break;
      }
      case "checkbox": {
        const on = !!stat.valueBool;
        valueHtml = `<span class="stat-checkbox ${on ? "on" : "off"}">${on ? "✓" : "○"}</span>`;
        break;
      }
      default:
        valueHtml = `<span class="muted text-xs">—</span>`;
    }
    return `
      <div class="stat-row compact" data-enemy-stat-id="${escapeHtml(stat.id)}" data-stat-type="${stat.type}">
        <div class="stat-label"><span class="stat-label-name">${escapeHtml(stat.name)}</span></div>
        <div class="stat-value">${valueHtml}</div>
      </div>
    `;
  }

  // ----- Log de dados -----
  function renderDiceLog(entries) {
    if (!entries || !entries.length) {
      return `<div class="muted text-sm">Nenhuma rolagem ainda.</div>`;
    }
    return entries.slice().reverse().map(e => `
      <div class="dice-log-entry">
        <div class="dice-log-time text-xs muted">${formatTime(e.timestamp)}</div>
        <div class="dice-log-main">
          <span class="dice-log-roller">${escapeHtml(e.rollerUsername)}</span>
          ${e.label ? `<span class="dice-log-label">${sanitizeText(e.label)}</span>` : ""}
          <code class="dice-log-formula">${escapeHtml(e.formula)}</code>
        </div>
        <div class="dice-log-breakdown">${escapeHtml(e.breakdown)}</div>
      </div>
    `).join("");
  }

  // ----- Caixa de sugestões (só mestre vê) -----
  function renderSuggestions(suggestions, opts = {}) {
    if (!suggestions || !suggestions.length) return "";
    return suggestions.map(s => `
      <div class="suggestion-card" data-suggestion-id="${escapeHtml(s.id)}">
        <div class="suggestion-header">
          <strong>${escapeHtml(s.fromUsername)}</strong> sugeriu:
        </div>
        <div class="suggestion-body">
          <div class="suggestion-label">${sanitizeText(s.label)}</div>
          <code class="suggestion-formula">${escapeHtml(s.formula)}</code>
        </div>
        ${opts.isMaster ? `
          <div class="suggestion-actions">
            <button class="btn btn-sm btn-primary" data-action="accept-suggestion" data-suggestion-id="${escapeHtml(s.id)}" data-formula="${escapeHtml(s.formula)}" data-label="${escapeHtml(s.label)}">Rolar agora</button>
            <button class="btn btn-sm btn-ghost" data-action="dismiss-suggestion" data-suggestion-id="${escapeHtml(s.id)}">Dispensar</button>
          </div>
        ` : ""}
      </div>
    `).join("");
  }

  // ----- Indicador de conectividade -----
  function renderConnectivity(status) {
    const map = {
      connected: { label: "Conectado", class: "conn-connected" },
      reconnecting: { label: "Reconectando…", class: "conn-reconnecting" },
      closed: { label: "Desconectado", class: "conn-closed" },
      error: { label: "Erro de conexão", class: "conn-error" },
    };
    const m = map[status] || map.closed;
    return `<span class="conn-indicator ${m.class}"><span class="conn-dot"></span>${m.label}</span>`;
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  window.roomRender = {
    renderCharacter,
    renderEnemy,
    renderDiceLog,
    renderSuggestions,
    renderConnectivity,
    ENEMY_PRESETS,
  };
})();
