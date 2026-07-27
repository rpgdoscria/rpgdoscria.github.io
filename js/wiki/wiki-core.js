// js/wiki/wiki-core.js — lógica comum à Wiki (navegação, busca, helpers)
//
// v10 (este patch): TODAS as URLs geradas são ABSOLUTAS (/wiki/...).
// Antes usavam URLs relativas (pagina?slug=...) que quebravam quando a página
// era acessada de contexts diferentes (ex: /wiki/pagina vs /wiki). Breadcrumb
// também usava href="." que resolvia para o diretório atual, não para /wiki.

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

  // Gera URL de página da wiki — ABSOLUTA, funciona de qualquer contexto.
  function pageUrl(slug) {
    return `/wiki/pagina?slug=${encodeURIComponent(slug)}`;
  }
  function editUrl(slug) {
    return `/wiki/editar?slug=${encodeURIComponent(slug)}`;
  }
  function editNewUrl(title) {
    return `/wiki/editar?new=true&title=${encodeURIComponent(title)}`;
  }
  function historyUrl(slug) {
    return `/wiki/historico?slug=${encodeURIComponent(slug)}`;
  }
  // URL da home da wiki, opcionalmente filtrada por categoria ou busca.
  function homeUrl(params) {
    const q = new URLSearchParams();
    if (params) {
      if (params.category) q.set("category", params.category);
      if (params.q) q.set("q", params.q);
    }
    const qs = q.toString();
    return qs ? `/wiki?${qs}` : `/wiki`;
  }

  // Renderiza breadcrumb: Wiki > Categoria > Página
  // Todos os links são ABSOLUTOS — funciona de qualquer URL.
  function breadcrumb(parts) {
    return `<div class="wiki-breadcrumb">
      <a href="/wiki">Wiki</a>
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
    homeUrl,
    breadcrumb,
  };
})();
