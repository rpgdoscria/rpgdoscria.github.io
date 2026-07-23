// js/wiki/wiki-core.js — lógica comum à Wiki (navegação, busca, helpers)

(function () {
  const DEFAULT_CATEGORIES = [
    "Personagens", "Locais", "Itens & Equipamentos", "Lore/História",
    "Sessões Jogadas", "Regras da Casa", "Criaturas"
  ];

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  function formatDate(s) {
    if (!s) return "—";
    const d = new Date(s.endsWith("Z") ? s : s.replace(" ", "T") + "Z");
    return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  // Gera URL de página da wiki no novo formato
  function pageUrl(slug) {
    return `pagina.html?slug=${encodeURIComponent(slug)}`;
  }
  function editUrl(slug) {
    return `editar.html?slug=${encodeURIComponent(slug)}`;
  }
  function editNewUrl(title) {
    return `editar.html?new=true&title=${encodeURIComponent(title)}`;
  }
  function historyUrl(slug) {
    return `historico.html?slug=${encodeURIComponent(slug)}`;
  }

  // Renderiza breadcrumb: Wiki > Categoria > Página
  function breadcrumb(parts) {
    return `<div class="wiki-breadcrumb">
      <a href="index.html">Wiki</a>
      ${parts.map(p => `<span class="sep">›</span>${p.href ? `<a href="${p.href}">${escapeHtml(p.label)}</a>` : `<span>${escapeHtml(p.label)}</span>`}`).join("")}
    </div>`;
  }

  window.wikiCore = {
    DEFAULT_CATEGORIES,
    escapeHtml,
    formatDate,
    pageUrl,
    editUrl,
    editNewUrl,
    historyUrl,
    breadcrumb,
  };
})();
