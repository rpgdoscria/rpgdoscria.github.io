// frontend/js/character-render.js — componente único de card/ficha de personagem
//
// v10 (este patch): permissões por stat + inventário como popup + ícone de item.
//   - Cada stat tem badge de permissão: 🔒 (só mestre edita) ou 🔓 (jogador pode editar)
//   - Mestre vê botões 🗛 (deletar stat) e 🔒/🔓 (alternar permissão) em cada stat
//   - Jogador só vê botões +/- em stats com playerEditable=true
//   - Inventário não é mais <details> inline; é um botão que abre modal (ver sala/index.html)
//
// USADO EM 3+ LUGARES (sem duplicar HTML):
//   1. meus-personagens (lista de personagens do usuário)
//   2. sala (grade de jogadores — mestre vê todos editáveis, jogador vê só o próprio)
//   3. criar-personagem (preview final do wizard)

(function () {
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }
  function sanitizeText(s) {
    if (!window.DOMPurify) return escapeHtml(s);
    return escapeHtml(window.DOMPurify.sanitize(String(s ?? ""), { ALLOWED_TAGS: [] }));
  }

  // Avatar do personagem — usa photoUrl se houver, senão placeholder com inicial.
  // Se symbolUrl existir, mostra miniatura do símbolo sobreposta no canto.
  function renderAvatar(ch, size = 80) {
    const initial = (ch.name || "?").charAt(0).toUpperCase();
    const symSize = Math.floor(size * 0.4);
    let avatarHtml;
    if (ch.photoUrl) {
      avatarHtml = `<img src="${escapeHtml(ch.photoUrl)}" alt="${escapeHtml(ch.name)}" class="char-avatar" style="width:${size}px;height:${size}px" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'char-avatar-placeholder',style:'width:${size}px;height:${size}px;font-size:${Math.floor(size/2.5)}px',textContent:'${initial}'}))">`;
    } else {
      avatarHtml = `<div class="char-avatar-placeholder" style="width:${size}px;height:${size}px;font-size:${Math.floor(size/2.5)}px">${escapeHtml(initial)}</div>`;
    }
    if (ch.symbolUrl) {
      avatarHtml = `<div style="position:relative;width:${size}px;height:${size}px;display:inline-block">
        ${avatarHtml}
        <img src="${escapeHtml(ch.symbolUrl)}" alt="símbolo" style="position:absolute;bottom:-${Math.floor(symSize*0.15)}px;right:-${Math.floor(symSize*0.15)}px;width:${symSize}px;height:${symSize}px;background:#0a0a0a;border-radius:4px;padding:2px;box-shadow:0 2px 6px rgba(0,0,0,0.5)">
      </div>`;
    }
    return avatarHtml;
  }

  // Render de UM stat — depende do tipo
  // opts: { editable, isMaster, isOwn, onAction, compact }
  function renderStat(stat, opts = {}) {
    const { editable, isMaster, isOwn, compact = false } = opts;
    // Jogador só pode editar stat se for o dono E stat.playerEditable for true.
    // Mestre pode editar qualquer stat.
    const playerCanEdit = isOwn && stat.playerEditable;
    const canEdit = editable && (isMaster || playerCanEdit);

    const color = stat.color || "#a78bfa";
    const name = escapeHtml(stat.name);
    const customBadge = stat.isCustom ? `<span class="stat-custom-badge" title="Customizado">★</span>` : "";
    // Badge de permissão: 🔒 (só mestre) ou 🔓 (jogador pode editar)
    const permBadge = isMaster
      ? `<button class="stat-perm-toggle ${stat.playerEditable ? "editable" : "locked"}" data-action="toggle-perm" data-stat-id="${stat.id}" title="${stat.playerEditable ? "Jogador pode editar (clique para bloquear)" : "Só mestre edita (clique para liberar pro jogador)"}">${stat.playerEditable ? "🔓" : "🔒"}</button>`
      : (isOwn && !stat.playerEditable ? `<span class="stat-perm-locked" title="Só o mestre pode editar este status">🔒</span>` : "");
    // Botão deletar (só mestre)
    const deleteBtn = isMaster
      ? `<button class="stat-delete-btn" data-action="delete-stat" data-stat-id="${stat.id}" title="Deletar este status da ficha">×</button>`
      : "";

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
      <div class="stat-row ${compact ? "compact" : ""}" data-stat-id="${stat.id}" data-stat-type="${stat.type}">
        <div class="stat-label">
          <span class="stat-label-name">${name}${customBadge}</span>
          <span class="stat-label-actions">${permBadge}${deleteBtn}</span>
        </div>
        <div class="stat-value">${valueHtml}</div>
      </div>
    `;
  }

  // Render de card de personagem (versão compacta pra grade na sala)
  // v12: visual embelezado — header com gradient sutil, avatar com borda colorida,
  // badges de permissão integradas, botões de ação com tooltips.
  // opts: { editable, isMaster, isOwn, showActions }
  function renderCharacterCard(ch, opts = {}) {
    const { editable = false, isMaster = false, isOwn = false, showActions = true } = opts;
    const canEdit = editable && (isOwn || isMaster);

    const avatarHtml = renderAvatar(ch, 56);
    // Stats em layout compacto (2 colunas para bar/numbers, 1 coluna para textos)
    const statsHtml = (ch.stats || []).map(s => renderStat(s, { editable, isMaster, isOwn, compact: true })).join("");

    const statusEffects = (ch.statusEffects || []).map(s => `
      <span class="status-tag">${sanitizeText(s.text)}${isMaster ? `<button class="status-remove" data-status-id="${escapeHtml(s.id)}">×</button>` : ""}</span>
    `).join("");

    // Inventário como BOTÃO que abre modal
    const invCount = (ch.inventory || []).length;
    const invBtn = `<button class="btn btn-sm btn-ghost inventory-open-btn" data-action="open-inventory" data-character-id="${ch.id}" data-character-name="${escapeHtml(ch.name)}" title="Ver inventário">
      🎒 <span class="inv-count-badge">${invCount}</span>
    </button>`;

    // v12: contadores rápidos no header (stats total, equipped items)
    const statsCount = (ch.stats || []).length;
    const equippedCount = (ch.inventory || []).filter(it => it.equipped).length;

    // v12: botão "Propor item" só aparece para o jogador dono do personagem (não mestre)
    const proposeBtn = isOwn && !isMaster
      ? `<button class="btn btn-sm btn-ghost" data-action="propose-item" title="Propor item ao mestre">📦</button>`
      : "";

    return `
      <div class="card character-card ${isOwn ? "own" : ""}" data-character-id="${ch.id}">
        <div class="character-header">
          <div class="character-header-left">
            ${avatarHtml}
            <div class="character-header-info">
              <div class="character-name">${escapeHtml(ch.name)}</div>
              <div class="character-owner muted text-xs">jogador: ${escapeHtml(ch.ownerUsername)}</div>
              <div class="character-meta-pills">
                <span class="char-meta-pill" title="Status">${statsCount} 📊</span>
                <span class="char-meta-pill" title="Itens equipados">${equippedCount} ⚔️</span>
                <span class="char-meta-pill" title="Total itens">${invCount} 🎒</span>
              </div>
            </div>
          </div>
          <div class="character-actions">
            ${canEdit && showActions ? `<button class="btn btn-sm" data-action="edit-character" data-character-id="${ch.id}" title="Editar ficha">✎</button>` : ""}
            ${isMaster && !isOwn && showActions ? `<button class="btn btn-sm btn-ghost" data-action="gm-edit-character" data-character-id="${ch.id}" title="Editar como mestre">M</button>` : ""}
            ${isMaster && showActions ? `<button class="btn btn-sm btn-ghost" data-action="add-status" data-target-type="character" data-target-id="${ch.id}" title="Adicionar status effect">+</button>` : ""}
            ${proposeBtn}
            ${invBtn}
          </div>
        </div>
        <div class="stats-section stats-grid-compact">${statsHtml || `<div class="muted text-sm">Sem status definidos.</div>`}</div>
        ${statusEffects ? `<div class="status-list">${statusEffects}</div>` : ""}
      </div>
    `;
  }

  // Render de ficha completa (versão detalhada pra meus-personagens)
  function renderCharacterSheet(ch, opts = {}) {
    const { editable = false, isOwn = false } = opts;
    const avatarHtml = renderAvatar(ch, 96);
    const statsHtml = (ch.stats || []).map(s => renderStat(s, { editable, isOwn, isMaster: false, compact: true })).join("");
    const invCount = (ch.inventory || []).length;
    return `
      <div class="card character-sheet" data-character-id="${ch.id}">
        <div class="sheet-header">
          ${avatarHtml}
          <div>
            <div class="character-name" style="font-size:22px">${escapeHtml(ch.name)}</div>
            <div class="muted text-sm">jogador: ${escapeHtml(ch.ownerUsername)}${ch.isActive ? " · ⭐ ativo" : ""}</div>
          </div>
          <button class="btn btn-sm btn-ghost inventory-open-btn" data-action="open-inventory" data-character-id="${ch.id}" data-character-name="${escapeHtml(ch.name)}" title="Ver inventário">
            🎒 Inventário <span class="inv-count-badge">${invCount}</span>
          </button>
        </div>
        <div class="stats-section stats-grid-compact">${statsHtml || `<div class="muted">Sem status definidos.</div>`}</div>
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
