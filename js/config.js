// frontend/js/config.js — configuração do frontend
// APENAS este arquivo precisa ser editado para apontar para o seu Worker.
// Não comitar secrets aqui — só a URL pública do seu Worker.
//
// Ordem de resolução da API_BASE (primeira que existir vence):
//   1. <meta name="rpg-api-base" content="https://..."> no <head> do HTML
//      (permite mudar a URL sem recompilar config.js)
//   2. window.RPG_API_BASE (variável global — útil pra injetar via build script)
//   3. Detecção automática por hostname:
//      - localhost / 127.0.0.1 → http://localhost:8787 (wrangler dev padrão)
//      - *.github.io → https://rpg-wiki-api.genericbr-paypal.workers.dev
//      - outros → usa a URL hardcoded abaixo (mantida pra compat)
//   4. Hardcoded padrão (produção)

(function () {
  // Tenta meta tag primeiro
  let API_BASE = "";
  const meta = document.querySelector('meta[name="rpg-api-base"]');
  if (meta && meta.getAttribute("content")) {
    API_BASE = meta.getAttribute("content");
  } else if (typeof window !== "undefined" && window.RPG_API_BASE) {
    API_BASE = window.RPG_API_BASE;
  } else {
    // Detecção automática por hostname
    const host = (typeof location !== "undefined" && location.hostname) || "";
    if (host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.") || host.startsWith("10.")) {
      // Desenvolvimento local — wrangler dev roda em 8787 por padrão
      API_BASE = "http://localhost:8787";
    } else {
      // Produção — URL pública do Worker (hardcoded padrão)
      // Se você mudou o nome do Worker no wrangler.toml, atualize aqui OU
      // use a meta tag <meta name="rpg-api-base" content="..."> nos HTMLs.
      API_BASE = "https://rpg-wiki-api.genericbr-paypal.workers.dev";
    }
  }

  // Remove barra trailing pra evitar // ao concatenar paths
  API_BASE = API_BASE.replace(/\/+$/, "");

  window.WIKI_CONFIG = {
    API_BASE: API_BASE,
    SITE_NAME: "Rpg dos Cria",
    ENABLE_THEME_TOGGLE: false,
  };

  // Log em dev pra facilitar debug
  if (typeof console !== "undefined" && console.log) {
    const host = (typeof location !== "undefined" && location.hostname) || "";
    if (host === "localhost" || host === "127.0.0.1") {
      console.log(`[config] API_BASE = ${API_BASE} (mude via <meta name="rpg-api-base" content="...">)`);
    }
  }
})();
