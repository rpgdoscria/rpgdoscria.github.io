// frontend/js/character-render.js — componente único de card/ficha de personagem
//
// USADO EM 3+ LUGARES (sem duplicar HTML):
//   1. meus-personagens.html (lista de personagens do usuário)
//   2. sala-mestre.html (grade de jogadores na visão do mestre)
//   3. sala-jogador.html (grade de jogadores na visão do jogador — leitura dos outros, editável do próprio)
//   4. criar-personagem.html (preview final do wizard)
//
// Sabe desenhar cada type de stat: bar, number, text, tag_list, checkbox, formula.
// Toda string vinda do usuário passa por escapeHtml/sanitizeText (DOMPurify).

(function () {
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }
  function sanitizeText(s) {
    if (!window.DOMPurify) return escapeHtml(s);
    return escapeHtml(window.DOMPurify.sanitize(String(s ?? ""), { ALLOWED_TAGS: [] }));
  }

  // Avatar do personagem — usa photoUrl se houver, senão placeholder com inicial
  function renderAvatar(ch, size = 80) {
    const initial = (ch.name || "?").charAt(0).toUpperCase();
    if (ch.photoUrl) {
      return `<img src="${escapeHtml(ch.photoUrl)}" alt="${escapeHtml(ch.name)}" class="char-avatar" style="width:${size}px;height:${size}px" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'char-avatar-placeholder',style:'width:${size}px;height:${size}px;font-size:${Math.floor(size/2.5)}px',textContent:'${initial}'}))">`;
    }
    return `<div class="char-avatar-placeholder" style="width:${size}px;height:${size}px;font-size:${Math.floor(size/2.5)}px">${escapeHtml(initial)}</div>`;
  }

  // Render de UM stat — depende do tipo
  function renderStat(stat, opts = {}) {
    const { editable, isMaster, isOwn, onAction } = opts;
    const canEdit = editable && (isOwn || isMaster);
    const color = stat.color || "#a78bfa";
    const name = escapeHtml(stat.name);
    const customBadge = stat.isCustom ? `<span class="stat-custom-badge" title="Customizado">★</span>` : "";

    let valueHtml = "";
    switch (stat.type) {
      case "bar": {
        const cur = Number(stat.valueCurrent ?? 0);
        const max = Number(stat.valueMax ?? 0);
        const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
        const colorVal = cur > max * 0.6 ? "var(--success)" : cur > max * 0.3 ? "var(--warning)" : "var(--danger)";
        valueHtml = `
          <div class="stat-bar-row">
            <div class="stat-bar-track">
              <div class="stat-bar-fill" style="width:${pct}%;background:${colorVal}"></div>
            </div>
            <span class="stat-bar-values" style="color:${colorVal}">${cur} / ${max}</span>
            ${canEdit ? `
              <div class="stat-quick-actions">
                <button class="btn-stat-quick" data-stat-id="${stat.id}" data-delta="-1" title="-1">−</button>
                <button class="btn-stat-quick" data-stat-id="${stat.id}" data-delta="-5" title="-5">−5</button>
                <button class="btn-stat-quick" data-stat-id="${stat.id}" data-delta="1" title="+1">+</button>
                <button class="btn-stat-quick" data-stat-id="${stat.id}" data-delta="5" title="+5">+5</button>
              </div>` : ""}
          </div>`;
        break;
      }
      case "number": {
        const v = Number(stat.valueCurrent ?? 0);
        valueHtml = `
          <div class="stat-number-row">
            <span class="stat-number-value" style="color:${escapeHtml(color)}">${v}</span>
            ${canEdit ? `
              <div class="stat-quick-actions">
                <button class="btn-stat-quick" data-stat-id="${stat.id}" data-delta="-1">−</button>
                <button class="btn-stat-quick" data-stat-id="${stat.id}" data-delta="1">+</button>
              </div>` : ""}
          </div>`;
        break;
      }
      case "text": {
        valueHtml = `<div class="stat-text-value">${sanitizeText(stat.valueText || "")}</div>`;
        break;
      }
      case "tag_list": {
        let tags = [];
        try { tags = JSON.parse(stat.valueText || "[]"); } catch { tags = []; }
        if (!Array.isArray(tags)) tags = [];
        valueHtml = `<div class="stat-tag-list">${tags.map(t => `<span class="stat-tag">${sanitizeText(t)}</span>`).join("")}${tags.length === 0 ? `<span class="muted text-xs">—</span>` : ""}</div>`;
        break;
      }
      case "checkbox": {
        const on = !!stat.valueBool;
        valueHtml = `<span class="stat-checkbox ${on ? "on" : "off"}" title="${on ? "Ativo" : "Inativo"}">${on ? "✓" : "○"}</span>`;
        break;
      }
      case "formula": {
        valueHtml = `<code class="stat-formula">${escapeHtml(stat.valueText || "")}</code>`;
        break;
      }
      default:
        valueHtml = `<span class="muted">?</span>`;
    }

    return `
      <div class="stat-row" data-stat-id="${stat.id}" data-stat-type="${stat.type}">
        <div class="stat-label">${name}${customBadge}</div>
        <div class="stat-value">${valueHtml}</div>
      </div>
    `;
  }

  // Render de card de personagem (versão compacta pra grade na sala)
  // opts: { editable, isMaster, isOwn, showActions }
  function renderCharacterCard(ch, opts = {}) {
    const { editable = false, isMaster = false, isOwn = false, showActions = true } = opts;
    const canEdit = editable && (isOwn || isMaster);

    const avatarHtml = renderAvatar(ch, 64);
    const statsHtml = (ch.stats || []).map(s => renderStat(s, { editable, isMaster, isOwn })).join("");

    const statusEffects = (ch.statusEffects || []).map(s => `
      <span class="status-tag">${sanitizeText(s.text)}${isMaster ? `<button class="status-remove" data-status-id="${escapeHtml(s.id)}">×</button>` : ""}</span>
    `).join("");

    const inventoryHtml = (ch.inventory || []).length === 0
      ? `<div class="muted text-xs">Sem itens</div>`
      : (ch.inventory || []).map(it => `
        <div class="inv-item"><span class="inv-qty">${it.qty}×</span><span>${sanitizeText(it.name)}</span></div>
      `).join("");

    return `
      <div class="card character-card ${isOwn ? "own" : ""}" data-character-id="${ch.id}">
        <div class="character-header">
          <div style="display:flex;gap:12px;align-items:center">
            ${avatarHtml}
            <div>
              <div class="character-name">${escapeHtml(ch.name)}</div>
              <div class="character-owner muted text-xs">jogador: ${escapeHtml(ch.ownerUsername)}</div>
              ${ch.pageId ? `<a href="page.html?slug=personagem-${ch.id}" class="text-xs">📄 Ver lore</a>` : ""}
            </div>
          </div>
          <div class="character-actions">
            ${canEdit && showActions ? `<button class="btn btn-sm" data-action="edit-character" data-character-id="${ch.id}">✎</button>` : ""}
            ${isMaster && !isOwn && showActions ? `<button class="btn btn-sm btn-ghost" data-action="gm-edit-character" data-character-id="${ch.id}">Editar como mestre</button>` : ""}
            ${isMaster && showActions ? `<button class="btn btn-sm btn-ghost" data-action="add-status" data-target-type="character" data-target-id="${ch.id}">+ Status</button>` : ""}
          </div>
        </div>
        <div class="stats-section">${statsHtml || `<div class="muted text-sm">Sem status definidos.</div>`}</div>
        ${statusEffects ? `<div class="status-list">${statusEffects}</div>` : ""}
        <details class="inventory-section">
          <summary class="muted text-xs">Inventário (${(ch.inventory || []).length})</summary>
          <div class="inventory-list">${inventoryHtml}</div>
        </details>
      </div>
    `;
  }

  // Render de ficha completa (versão detalhada pra meus-personagens.html)
  function renderCharacterSheet(ch, opts = {}) {
    const { editable = false, isOwn = false } = opts;
    const avatarHtml = renderAvatar(ch, 120);
    const statsHtml = (ch.stats || []).map(s => renderStat(s, { editable, isOwn, isMaster: false })).join("");
    return `
      <div class="card character-sheet" data-character-id="${ch.id}">
        <div class="sheet-header" style="display:flex;gap:16px;align-items:center;margin-bottom:16px">
          ${avatarHtml}
          <div>
            <div class="character-name" style="font-size:24px">${escapeHtml(ch.name)}</div>
            <div class="muted text-sm">jogador: ${escapeHtml(ch.ownerUsername)}${ch.isActive ? " · ⭐ ativo" : ""}</div>
            ${ch.pageId ? `<a href="page.html?id=${ch.pageId}" class="text-sm">📄 Ver página de lore vinculada</a>` : ""}
          </div>
        </div>
        <div class="stats-section">${statsHtml || `<div class="muted">Sem status definidos.</div>`}</div>
      </div>
    `;
  }

  window.characterRender = {
    renderCharacterCard,
    renderCharacterSheet,
    renderStat,
    renderAvatar,
  };
})();
