// frontend/js/character-render.js — componente único de card/ficha de personagem
//
// v13: REFACTORAÇÃO VISUAL COMPLETA.
//   - Removidos botões minúsculos (🔒/🔓/×) de cada stat row (poluiam visual)
//   - Stats agora são LIMPOS: só nome + valor + botões +/- (quando editável)
//   - Permissões e delete de stat movidos para um PAINEL DE GESTÃO separado
//     (abre via botão "Gerenciar" no header do card — só mestre vê)
//   - Header refatorado: avatar + nome + OWNER em coluna limpa, ações em
//     toolbar horizontal com botões de tamanho consistente (não minúsculos)
//   - Removidos "meta-pills" que flutuavam sem clareza
//   - Grid de stats com alinhamento consistente (baseline igual)
//
// USADO EM 3+ LUGARES:
//   1. meus-personagens (lista de personagens do usuário)
//   2. sala (grade de jogadores — mestre vê todos, jogador vê só o próprio)
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

  // v13: Render de UM stat — LIMPO, sem botões minúsculos de permissão/delete.
  // Permissões e delete são gerenciados no painel de gestão (botão "Gerenciar").
  function renderStat(stat, opts = {}) {
    const { editable, isMaster, isOwn, compact = false } = opts;
    const playerCanEdit = isOwn && stat.playerEditable;
    const canEdit = editable && (isMaster || playerCanEdit);
    const color = stat.color || "#a78bfa";
    const name = escapeHtml(stat.name);
    const customBadge = stat.isCustom ? `<span class="stat-custom-badge" title="Customizado">★</span>` : "";
    // Indicador visual sutil de permissão (não é botão — é só um ícone pequeno)
    // Só aparece para o JOGADOR (pra saber quais ele pode editar). Mestre não precisa ver.
    const permIndicator = (isOwn && !isMaster)
      ? (stat.playerEditable ? `<span class="stat-perm-indicator editable" title="Você pode editar">🔓</span>` : `<span class="stat-perm-indicator locked" title="Só o mestre edita">🔒</span>`)
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
                <button class="btn-stat-quick" data-stat-id="${stat.id}" data-delta="1" title="+1">+</button>
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
          ${permIndicator}
        </div>
        <div class="stat-value">${valueHtml}</div>
      </div>
    `;
  }

  // v13: Render de card de personagem — header limpo com toolbar de ações organizada.
  // opts: { editable, isMaster, isOwn, showActions }
  function renderCharacterCard(ch, opts = {}) {
    const { editable = false, isMaster = false, isOwn = false, showActions = true } = opts;
    const canEdit = editable && (isOwn || isMaster);

    const avatarHtml = renderAvatar(ch, 56);
    const statsHtml = (ch.stats || []).map(s => renderStat(s, { editable, isMaster, isOwn, compact: true })).join("");

    const statusEffects = (ch.statusEffects || []).map(s => `
      <span class="status-tag">${sanitizeText(s.text)}${isMaster ? `<button class="status-remove" data-status-id="${escapeHtml(s.id)}">×</button>` : ""}</span>
    `).join("");

    const invCount = (ch.inventory || []).length;
    const equippedCount = (ch.inventory || []).filter(it => it.equipped).length;

    // v13: Toolbar de ações — botões de tamanho CONSISTENTE, com labels claras.
    // Mestre vê: Gerenciar (abre painel), + Status, Inventário
    // Jogador dono vê: Editar (ficha), Propor item, Inventário
    // Jogador outro: só Inventário (leitura)
    let actionsHtml = "";
    if (showActions) {
      if (isMaster) {
        actionsHtml = `
          <button class="char-action-btn" data-action="manage-character" data-character-id="${ch.id}" title="Gerenciar ficha, permissões e stats">
            ⚙️ <span class="char-action-label">Gerenciar</span>
          </button>
          <button class="char-action-btn" data-action="add-status" data-target-type="character" data-target-id="${ch.id}" title="Adicionar status effect temporário">
            ✨ <span class="char-action-label">Status</span>
          </button>
        `;
      } else if (isOwn) {
        actionsHtml = `
          <button class="char-action-btn" data-action="edit-character" data-character-id="${ch.id}" title="Editar ficha">
            ✎ <span class="char-action-label">Editar</span>
          </button>
          <button class="char-action-btn" data-action="propose-item" title="Propor item ao mestre">
            📦 <span class="char-action-label">Propor item</span>
          </button>
        `;
      }
      actionsHtml += `
        <button class="char-action-btn" data-action="open-inventory" data-character-id="${ch.id}" data-character-name="${escapeHtml(ch.name)}" title="Ver inventário (${invCount} itens, ${equippedCount} equipados)">
          🎒 <span class="char-action-label">Inventário</span>
          <span class="inv-count-badge">${invCount}</span>
        </button>
      `;
    }

    return `
      <div class="card character-card ${isOwn ? "own" : ""}" data-character-id="${ch.id}">
        <div class="character-header">
          <div class="character-header-left">
            ${avatarHtml}
            <div class="character-header-info">
              <div class="character-name">${escapeHtml(ch.name)}</div>
              <div class="character-owner muted text-xs">jogador: ${escapeHtml(ch.ownerUsername)}</div>
            </div>
          </div>
        </div>
        <div class="character-actions-bar">
          ${actionsHtml}
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

  // v13: Render do PAINEL DE GESTÃO (modal) — mestre gerencia permissões e deleta stats.
  // É chamado quando o mestre clica em "Gerenciar" no card do personagem.
  function renderManagePanel(ch) {
    const statsHtml = (ch.stats || []).map(s => {
      const valDisplay = s.type === "bar" ? `${s.valueCurrent ?? 0}/${s.valueMax ?? 0}`
        : s.type === "number" ? `${s.valueCurrent ?? 0}`
        : s.type === "checkbox" ? (s.valueBool ? "✓" : "○")
        : s.type === "tag_list" ? "tags"
        : (s.valueText || "—");
      return `
        <div class="manage-stat-row" data-stat-id="${s.id}">
          <div class="manage-stat-info">
            <span class="manage-stat-name">${escapeHtml(s.name)}</span>
            ${s.isCustom ? `<span class="stat-custom-badge" title="Customizado">★</span>` : ""}
            <span class="manage-stat-type muted text-xs">${s.type}</span>
            <span class="manage-stat-value muted text-xs">${escapeHtml(String(valDisplay))}</span>
          </div>
          <div class="manage-stat-actions">
            <button class="manage-perm-btn ${s.playerEditable ? "editable" : "locked"}" data-action="toggle-perm" data-stat-id="${s.id}" title="${s.playerEditable ? "Jogador pode editar — clique para bloquear" : "Só mestre edita — clique para liberar"}">
              ${s.playerEditable ? "🔓 Editável" : "🔒 Bloqueado"}
            </button>
            <button class="manage-delete-btn" data-action="delete-stat" data-stat-id="${s.id}" title="Deletar este stat da ficha">
              🗑 Deletar
            </button>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="manage-panel-content" data-character-id="${ch.id}">
        <div class="manage-panel-header">
          <div class="manage-panel-char-info">
            ${renderAvatar(ch, 48)}
            <div>
              <div class="manage-panel-char-name">${escapeHtml(ch.name)}</div>
              <div class="muted text-xs">jogador: ${escapeHtml(ch.ownerUsername)}</div>
            </div>
          </div>
        </div>
        <div class="manage-panel-stats">
          <h4 class="manage-panel-section-title">📊 Status da ficha (${(ch.stats || []).length})</h4>
          <p class="muted text-xs mb-2">Controle quais status o jogador pode editar. Status bloqueados (🔒) só o mestre modifica. Status liberados (🔓) o jogador pode ajustar.</p>
          ${statsHtml || `<div class="muted text-sm">Sem status definidos.</div>`}
        </div>
      </div>
    `;
  }

  window.characterRender = {
    renderCharacterCard,
    renderCharacterSheet,
    renderStat,
    renderAvatar,
    renderManagePanel,
  };
})();
