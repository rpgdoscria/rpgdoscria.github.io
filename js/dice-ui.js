// frontend/js/dice-ui.js — construtor de fórmula de dados + exibição de resultado
//
// Esta é a versão FRONTEND do parser — usada só para preview/sugestão ANTES
// de mandar pro backend. A rolagem real (com random criptográfico) sempre
// acontece no servidor (dice-parser.ts do Worker). Nunca confie no resultado
// calculado no cliente.

(function () {
  // ----- Parser de preview (mais permissivo — só pra feedback visual) -----
  // Mesma gramática do backend: NdS, +X, -X, NdSkhK, NdSklK, NdSdhK, NdSdlK
  function previewParse(input) {
    const trimmed = (input || "").trim().toLowerCase();
    if (!trimmed) return { ok: false, error: "Fórmula vazia." };
    if (trimmed.length > 200) return { ok: false, error: "Fórmula muito longa." };
    // Regex simples para validar — não rola, só valida formato.
    // Term: <count>d<sides>(kh|kl|dh|dl)<k>? | <number>
    const termRe = /(\d+)(?:d(\d+)(?:(kh|kl|dh|dl)(\d+))?)?/g;
    let matched = "";
    let lastIndex = 0;
    let m;
    let termCount = 0;
    const terms = [];
    while ((m = termRe.exec(trimmed)) !== null) {
      if (m.index !== lastIndex) {
        // Entre o último match e este, só pode ter + ou -
        const between = trimmed.slice(lastIndex, m.index).trim();
        if (between !== "+" && between !== "-") {
          return { ok: false, error: `Caractere inesperado perto de '${between}'.` };
        }
      }
      const count = parseInt(m[1], 10);
      const sides = m[2] ? parseInt(m[2], 10) : null;
      const mod = m[3];
      const modCount = m[4] ? parseInt(m[4], 10) : null;
      if (sides === null) {
        // modificador puro
        terms.push({ kind: "modifier", value: count });
      } else {
        if (count < 1) return { ok: false, error: "Deve rolar ao menos 1 dado." };
        if (count > 100) return { ok: false, error: "Máximo de 100 dados." };
        if (sides < 2) return { ok: false, error: "Dado deve ter ao menos 2 lados." };
        if (sides > 1000) return { ok: false, error: "Máximo de 1000 lados." };
        if (mod && (modCount < 1 || modCount >= count)) {
          return { ok: false, error: `Contagem de '${mod}' inválida.` };
        }
        terms.push({ kind: "dice", count, sides, mod, modCount });
      }
      matched += m[0];
      lastIndex = m.index + m[0].length;
      termCount++;
      if (termCount > 20) return { ok: false, error: "Máximo de 20 termos." };
    }
    if (lastIndex !== trimmed.length) {
      const rest = trimmed.slice(lastIndex);
      return { ok: false, error: `Token inesperado: '${rest}'.` };
    }
    if (terms.length === 0) return { ok: false, error: "Fórmula inválida." };
    return { ok: true, terms };
  }

  function isValid(input) {
    return previewParse(input).ok;
  }

  // ----- Construtor visual de fórmula -----
  // Monta uma fórmula a partir de botões rápidos. Devolve a string.
  function buildFromParts(parts) {
    // parts: [{ type: 'dice', count, sides }, { type: 'modifier', value }]
    let s = "";
    parts.forEach((p, i) => {
      if (i > 0) s += p.value >= 0 && p.type === "modifier" ? "+" : "";
      if (p.type === "dice") {
        s += `${p.count}d${p.sides}`;
        if (p.mod) s += `${p.mod}${p.modCount}`;
      } else {
        s += (p.value >= 0 ? "+" : "") + p.value;
      }
    });
    return s;
  }

  // ----- Formatação de resultado para exibição -----
  function formatResult(entry) {
    if (!entry) return "";
    const parts = [];
    parts.push(`<div class="dice-result-total">${entry.breakdown}</div>`);
    if (entry.label) parts.push(`<div class="dice-result-label">${escapeHtml(entry.label)}</div>`);
    parts.push(`<div class="dice-result-meta">${escapeHtml(entry.rollerUsername)} rolou <code>${escapeHtml(entry.formula)}</code></div>`);
    return parts.join("");
  }

  // Highlight visual temporário quando uma rolagem acontece
  function flashDiceResult(el, html) {
    el.innerHTML = html;
    el.classList.add("dice-flash");
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setTimeout(() => el.classList.remove("dice-flash"), 1500);
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  window.diceUI = {
    previewParse,
    isValid,
    buildFromParts,
    formatResult,
    flashDiceResult,
  };
})();
