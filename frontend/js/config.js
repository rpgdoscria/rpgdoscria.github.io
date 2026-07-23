// frontend/js/config.js — configuração do frontend
// APENAS este arquivo precisa ser editado para apontar para o seu Worker.
// Não comitar secrets aqui — só a URL pública do seu Worker.

window.WIKI_CONFIG = {
  // URL pública do seu Cloudflare Worker (depois de `wrangler deploy`).
  // Em dev local, troque por http://localhost:8787 (ou a porta do `wrangler dev`).
  API_BASE: "https://rpg-wiki-api.SEU_SUBDOMAIN.workers.dev",

  // Nome exibido no header e na tela de login.
  SITE_NAME: "Crônicas RPG",

  // Mostrar botão "Tema" no header? (true/false) — extra opcional
  ENABLE_THEME_TOGGLE: false,
};
