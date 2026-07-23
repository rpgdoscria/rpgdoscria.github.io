// frontend/js/markdown.js — render markdown + sanitização + [[wikilinks]]
// Depende de marked (vendor) e DOMPurify (vendor) — ambos embutidos.

(function () {
  if (!window.marked || !window.DOMPurify) {
    console.error("markdown.js requer marked.js e DOMPurify.");
    return;
  }

  // Configura marked
  window.marked.setOptions({
    gfm: true,
    breaks: false,
    headerIds: true,
    mangle: false,
  });

  // Converte [[Title]] e [[Title|Label]] em <a class="wikilink" data-title="Title">Label</a>
  // Antes de marked processar — assim evitamos conflito com sintaxe markdown.
  // Depois, no pós-processamento, marcamos como "missing" as que ainda não existem.
  const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  function preProcessWikilinks(md) {
    return md.replace(WIKILINK_RE, (m, title, label) => {
      const t = title.trim();
      const l = (label || title).trim();
      // placeholder que DOMPurify deixa passar (atributo data + classes)
      return `<a class="wikilink" data-wiki-title="${escapeAttr(t)}" href="page.html?slug=${encodeURIComponent(slugify(t))}">${escapeHtml(l)}</a>`;
    });
  }

  // Pós-processamento: marcar wikilinks cuja página não existe (verificado
  // em runtime pela página que renderiza). Em vez de uma chamada por link,
  // a página que chama `renderMarkdown` pode passar um Set com slugs existentes.
  function postProcess(html, knownSlugs) {
    const container = document.createElement("div");
    container.innerHTML = html;
    container.querySelectorAll("a.wikilink").forEach(a => {
      const title = a.getAttribute("data-wiki-title") || "";
      const slug = slugify(title);
      if (knownSlugs && !knownSlugs.has(slug)) {
        a.classList.add("wikilink-missing");
        a.title = `A página "${title}" ainda não existe — clique para criar.`;
        // href continua apontando para page.html?slug=... que oferece a criação.
      }
    });
    return container.innerHTML;
  }

  function renderMarkdown(md, knownSlugs) {
    if (!md) return "";
    const pre = preProcessWikilinks(md);
    const raw = window.marked.parse(pre);
    const clean = window.DOMPurify.sanitize(raw, {
      ADD_ATTR: ["data-wiki-title", "target", "rel"],
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|#|\/)|data:image\/)/i,
    });
    return postProcess(clean, knownSlugs);
  }

  // helpers
  function slugify(input) {
    return input
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[m]);
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, "&#96;");
  }

  // ---- diff simples linha-a-linha ----
  // Devolve HTML para duas colunas (esquerda=antes, direita=depois).
  function diffHtml(oldText, newText) {
    const oldLines = (oldText || "").split("\n");
    const newLines = (newText || "").split("\n");
    const maxLen = Math.max(oldLines.length, newLines.length);
    const left = [];
    const right = [];
    for (let i = 0; i < maxLen; i++) {
      const o = i < oldLines.length ? oldLines[i] : null;
      const n = i < newLines.length ? newLines[i] : null;
      if (o === n) {
        left.push(escapeHtml(o ?? ""));
        right.push(escapeHtml(n ?? ""));
      } else {
        if (o !== null) left.push(`<span class="diff-del">${escapeHtml(o)}</span>`);
        if (n !== null) right.push(`<span class="diff-add">${escapeHtml(n)}</span>`);
      }
    }
    return {
      left: left.join("\n"),
      right: right.join("\n"),
    };
  }

  window.md = {
    render: renderMarkdown,
    slugify,
    diffHtml,
  };
})();
