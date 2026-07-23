// frontend/js/character-sheet-full.js — renderização da Ficha Completa (aba da sala)
//
// Layout dinâmico que se adapta a qualquer combinação de status:
// - Faixa superior: foto + nome + 2-3 primeiros bars em destaque + bars extras como pills
// - Painel "Atributos": grade de status number
// - Painel "Características": status text + tag_list
// - Painel "Inventário/Equipamento": separado entre equipado e mochila
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
    const canEdit = editable && (isOwn || isMaster);

    // Separa stats por tipo
    const bars = (ch.stats || []).filter(s => s.type === "bar").sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    const numbers = (ch.stats || []).filter(s => s.type === "number");
    const texts = (ch.stats || []).filter(s => s.type === "text");
    const tagLists = (ch.stats || []).filter(s => s.type === "tag_list");
    const checkboxes = (ch.stats || []).filter(s => s.type === "checkbox");
    const formulas = (ch.stats || []).filter(s => s.type === "formula");

    // Faixa superior
    const featuredBars = bars.slice(0, 3);
    const extraBars = bars.slice(3);
    const avatar = window.characterRender.renderAvatar(ch, 80);

    const featuredBarsHtml = featuredBars.map(s => {
      const cur = Number(s.valueCurrent ?? 0);
      const max = Number(s.valueMax ?? 0);
      const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
      const col = hpColor(cur, max);
      return `
        <div class="sheet-full-bar-featured">
          <div class="sheet-full-bar-featured-label">
            <span>${escapeHtml(s.name)}</span>
            <span style="color:${col}">${cur} / ${max}</span>
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

    // Atributos (number)
    const attrsHtml = numbers.length === 0
      ? `<div class="muted text-sm">Nenhum atributo numérico.</div>`
      : `<div class="sheet-full-attrs-grid">${numbers.map(s => `
          <div class="sheet-full-attr">
            <div class="sheet-full-attr-label">${escapeHtml(s.name)}</div>
            <div class="sheet-full-attr-value" style="color:${escapeHtml(s.color || "var(--text)")}">${s.valueCurrent ?? 0}</div>
          </div>
        `).join("")}</div>`;

    // Características (text + tag_list)
    const charsHtml = [...texts, ...tagLists].length === 0
      ? `<div class="muted text-sm">Nenhuma característica.</div>`
      : [...texts, ...tagLists].map(s => {
          let val = s.valueText || "";
          if (s.type === "tag_list") {
            try { const tags = JSON.parse(val || "[]"); val = tags.map(t => `<span class="sheet-full-bar-pill">${sanitizeText(t)}</span>`).join(" "); } catch {}
          }
          return `
            <div class="sheet-full-characteristic">
              <div class="sheet-full-characteristic-label">${escapeHtml(s.name)}</div>
              <div class="sheet-full-characteristic-value">${s.type === "tag_list" ? val : sanitizeText(val)}</div>
            </div>
          `;
        }).join("");

    // Inventário (equipado vs mochila)
    const equipped = (ch.inventory || []).filter(it => it.equipped);
    const backpack = (ch.inventory || []).filter(it => !it.equipped);
    const invHtml = (ch.inventory || []).length === 0
      ? `<div class="muted text-sm">Sem itens.</div>`
      : `
        ${equipped.length > 0 ? `
          <div class="sheet-full-inv-section">
            <h4>⚔️ Equipado (${equipped.length})</h4>
            ${equipped.map(it => `<div class="sheet-full-inv-item"><span class="sheet-full-inv-qty">${it.qty}×</span><span>${sanitizeText(it.name)}</span></div>`).join("")}
          </div>` : ""}
        ${backpack.length > 0 ? `
          <div class="sheet-full-inv-section">
            <h4>🎒 Mochila (${backpack.length})</h4>
            ${backpack.map(it => `<div class="sheet-full-inv-item"><span class="sheet-full-inv-qty">${it.qty}×</span><span>${sanitizeText(it.name)}</span></div>`).join("")}
          </div>` : ""}
      `;

    // Secundário (checkbox + formula)
    const secondaryHtml = (checkboxes.length === 0 && formulas.length === 0)
      ? ""
      : `<div class="sheet-full-secondary">
          ${checkboxes.length > 0 ? `
            <div class="sheet-full-section">
              <h3>Estados</h3>
              ${checkboxes.map(s => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0"><span class="stat-checkbox ${s.valueBool ? "on" : "off"}">${s.valueBool ? "✓" : "○"}</span><span>${escapeHtml(s.name)}</span></div>`).join("")}
            </div>` : ""}
          ${formulas.length > 0 ? `
            <div class="sheet-full-section">
              <h3>Fórmulas</h3>
              ${formulas.map(s => `<div style="padding:4px 0"><span class="text-sm muted">${escapeHtml(s.name)}:</span> <code class="stat-formula">${escapeHtml(s.valueText || "")}</code></div>`).join("")}
            </div>` : ""}
        </div>`;

    return `
      <div class="sheet-full" data-character-id="${ch.id}">
        <div class="sheet-full-header">
          ${avatar}
          <div>
            <h2 class="sheet-full-name">${escapeHtml(ch.name)}</h2>
            <div class="sheet-full-owner">jogador: ${escapeHtml(ch.ownerUsername)}${ch.pageId ? ` · <a href="page.html?id=${ch.pageId}">ver lore</a>` : ""}</div>
          </div>
          <div class="sheet-full-bars-featured">
            ${featuredBarsHtml}
            ${extraBarsHtml ? `<div class="sheet-full-bar-pills">${extraBarsHtml}</div>` : ""}
          </div>
        </div>
        <div class="sheet-full-section"><h3>📊 Atributos</h3>${attrsHtml}</div>
        <div class="sheet-full-section"><h3>📝 Características</h3>${charsHtml}</div>
        <div class="sheet-full-section"><h3>🎒 Inventário / Equipamento</h3>${invHtml}</div>
        ${secondaryHtml}
      </div>
    `;
  }

  window.characterSheetFull = { renderFull };
})();
