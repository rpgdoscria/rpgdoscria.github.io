// frontend/js/character-sheet-full.js — renderização da Ficha Completa (aba da sala)
//
// v10 (este patch): LAYOUT COMPACTO + inventário como popup + permissões por stat.
//   - Layout em 2 colunas (atributos | características) em vez de empilhado
//   - Menos padding/margens para caber mais info na tela
//   - Inventário virou botão que abre modal (não mais seção inline)
//   - Stats mostram badge de permissão (🔒/🔓) e mestre vê botão deletar
//
// Layout dinâmico que se adapta a qualquer combinação de status:
// - Faixa superior: foto + nome + 2-3 primeiros bars em destaque + bars extras como pills
// - Painel "Atributos": grade de status number
// - Painel "Características": status text + tag_list
// - Área secundária: checkbox + formula

(function () {
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }
  function sanitizeText(s) {
    if (!window.DOMPurify) return escapeHtml(s);
    return escapeHtml(window.DOMPurify.sanitize(String(s ?? ""), { ALLOWED_TAGS: [] }));
  }

  function hpColor(cur, max) {
    if (!max || max <= 0) return "var(--text-muted)";
    const pct = cur / max;
    if (pct > 0.6) return "var(--success)";
    if (pct > 0.3) return "var(--warning)";
    return "var(--danger)";
  }

  function renderFull(ch, opts = {}) {
    const { editable = false, isMaster = false, isOwn = false, onStatUpdate } = opts;

    // Separa stats por tipo
    const bars = (ch.stats || []).filter(s => s.type === "bar").sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    const numbers = (ch.stats || []).filter(s => s.type === "number");
    const texts = (ch.stats || []).filter(s => s.type === "text");
    const tagLists = (ch.stats || []).filter(s => s.type === "tag_list");
    const checkboxes = (ch.stats || []).filter(s => s.type === "checkbox");
    const formulas = (ch.stats || []).filter(s => s.type === "formula");

    // Faixa superior — bars em destaque (até 2, era 3)
    const featuredBars = bars.slice(0, 2);
    const extraBars = bars.slice(2);
    const avatar = window.characterRender.renderAvatar(ch, 64);

    const featuredBarsHtml = featuredBars.map(s => {
      const cur = Number(s.valueCurrent ?? 0);
      const max = Number(s.valueMax ?? 0);
      const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
      const col = hpColor(cur, max);
      return `
        <div class="sheet-full-bar-featured">
          <div class="sheet-full-bar-featured-label">
            <span>${escapeHtml(s.name)}</span>
            <span style="color:${col}">${cur}/${max}</span>
          </div>
          <div class="sheet-full-bar-featured-track">
            <div class="sheet-full-bar-featured-fill" style="width:${pct}%;background:${col}"></div>
          </div>
        </div>
      `;
    }).join("");

    const extraBarsHtml = extraBars.map(s => {
      return `<span class="sheet-full-bar-pill">${escapeHtml(s.name)} <strong>${s.valueCurrent ?? 0}/${s.valueMax ?? 0}</strong></span>`;
    }).join("");

    // Atributos (number) — grade compacta 4 colunas
    const attrsHtml = numbers.length === 0
      ? ``
      : `<div class="sheet-full-attrs-grid">${numbers.map(s => `
          <div class="sheet-full-attr">
            <div class="sheet-full-attr-label">${escapeHtml(s.name)}</div>
            <div class="sheet-full-attr-value" style="color:${escapeHtml(s.color || "var(--text)")}">${s.valueCurrent ?? 0}</div>
          </div>
        `).join("")}</div>`;

    // Características (text + tag_list) — uma linha cada, compacto
    const charsHtml = [...texts, ...tagLists].length === 0
      ? ``
      : [...texts, ...tagLists].map(s => {
          let val = s.valueText || "";
          if (s.type === "tag_list") {
            try { const tags = JSON.parse(val || "[]"); val = tags.map(t => `<span class="sheet-full-bar-pill">${sanitizeText(t)}</span>`).join(" "); } catch {}
          }
          return `
            <div class="sheet-full-characteristic">
              <span class="sheet-full-characteristic-label">${escapeHtml(s.name)}:</span>
              <span class="sheet-full-characteristic-value">${s.type === "tag_list" ? val : sanitizeText(val)}</span>
            </div>
          `;
        }).join("");

    // Secundário (checkbox + formula) — em linha, compacto
    const checkboxesHtml = checkboxes.length === 0
      ? ""
      : `<div class="sheet-full-checkbox-row">${checkboxes.map(s => `<span class="sheet-full-checkbox-item"><span class="stat-checkbox ${s.valueBool ? "on" : "off"}">${s.valueBool ? "✓" : "○"}</span> ${escapeHtml(s.name)}</span>`).join("")}</div>`;

    const formulasHtml = formulas.length === 0
      ? ""
      : `<div class="sheet-full-formula-row">${formulas.map(s => `<span class="sheet-full-formula-item"><span class="text-xs muted">${escapeHtml(s.name)}:</span> <code class="stat-formula">${escapeHtml(s.valueText || "")}</code></span>`).join("")}</div>`;

    // Inventário como botão (não mais seção inline)
    const invCount = (ch.inventory || []).length;
    const invBtn = `<button class="btn btn-sm btn-ghost inventory-open-btn" data-action="open-inventory" data-character-id="${ch.id}" data-character-name="${escapeHtml(ch.name)}" title="Ver inventário">
      🎒 Inventário <span class="inv-count-badge">${invCount}</span>
    </button>`;

    // Verifica se há conteúdo em cada seção pra decidir se mostra
    const hasAttrs = numbers.length > 0;
    const hasChars = [...texts, ...tagLists].length > 0;
    const hasSecondary = checkboxes.length > 0 || formulas.length > 0;
    const hasBars = bars.length > 0;

    // Layout compacto: 2 colunas quando há ambos atributos e características
    const twoColLayout = hasAttrs && hasChars;

    return `
      <div class="sheet-full sheet-full-compact" data-character-id="${ch.id}">
        <div class="sheet-full-header">
          ${avatar}
          <div class="sheet-full-header-info">
            <h2 class="sheet-full-name">${escapeHtml(ch.name)}</h2>
            <div class="sheet-full-owner">jogador: ${escapeHtml(ch.ownerUsername)}</div>
          </div>
          <div class="sheet-full-header-actions">
            ${invBtn}
          </div>
        </div>
        ${hasBars ? `
          <div class="sheet-full-bars-featured">
            ${featuredBarsHtml}
            ${extraBarsHtml ? `<div class="sheet-full-bar-pills">${extraBarsHtml}</div>` : ""}
          </div>` : ""}
        ${twoColLayout ? `
          <div class="sheet-full-two-col">
            <div class="sheet-full-section"><h3>📊 Atributos</h3>${attrsHtml}</div>
            <div class="sheet-full-section"><h3>📝 Características</h3>${charsHtml}</div>
          </div>
        ` : `
          ${hasAttrs ? `<div class="sheet-full-section"><h3>📊 Atributos</h3>${attrsHtml}</div>` : ""}
          ${hasChars ? `<div class="sheet-full-section"><h3>📝 Características</h3>${charsHtml}</div>` : ""}
        `}
        ${hasSecondary ? `
          <div class="sheet-full-secondary">
            ${checkboxesHtml}
            ${formulasHtml}
          </div>` : ""}
      </div>
    `;
  }

  window.characterSheetFull = { renderFull };
})();
