// frontend/js/auth.js — login/logout/checagem de sessão + render do header

(function () {
  const cfg = window.WIKI_CONFIG || {};
  const SITE_NAME = cfg.SITE_NAME || "Wiki RPG";

  // ---- sessão ----
  function currentSession() {
    const user = window.api.getUser();
    const token = window.api.getToken();
    if (!user || !token) return null;
    return { user, token };
  }

  function logout() {
    window.api.setToken(null);
    window.api.setUser(null);
    location.href = "login.html";
  }

  async function login(username, password) {
    const data = await window.api.post("/api/auth/login", { username, password });
    window.api.setToken(data.token);
    window.api.setUser({
      id: 0, // preenchido por /me na sequência
      username: data.username,
      role: data.role,
      mustChangePassword: !!data.mustChangePassword,
      expiresAt: data.expiresAt,
    });
    // Busca dados completos
    try {
      const me = await window.api.get("/api/auth/me");
      window.api.setUser(Object.assign({}, window.api.getUser(), me));
    } catch (e) {
      // silencioso: ainda temos o básico
    }
    return data;
  }

  // ---- proteção de página ----
  // Chamar em páginas que exigem login. minRole = 'viewer'|'editor'|'admin'.
  function requireAuth(minRole = "viewer") {
    const sess = currentSession();
    const RANK = { viewer: 1, editor: 2, admin: 3 };
    if (!sess) {
      const next = encodeURIComponent(location.pathname + location.search + location.hash);
      location.href = `login.html?next=${next}`;
      return null;
    }
    if (RANK[sess.user.role] < RANK[minRole]) {
      alert(`Acesso restrito a ${minRole}.`);
      history.back();
      return null;
    }
    // BUG CORRIGIDO: se o usuário tem mustChangePassword=1, força a troca antes
    // de qualquer outra tela (exceto na própria tela de troca e no logout).
    const onChangePage = location.pathname.endsWith("change-password.html");
    if (sess.user.mustChangePassword && !onChangePage) {
      location.href = "change-password.html";
      return null;
    }
    return sess;
  }

  // ---- header comum ----
  function renderHeader(active = "") {
    const sess = currentSession();
    const user = sess ? sess.user : null;
    const links = [
      { href: "index.html", label: "Início", key: "home" },
      { href: "meus-personagens.html", label: "Personagens", key: "characters" },
      { href: "sala-criar.html", label: "Sala", key: "rooms" },
      { href: "edit.html", label: "Nova página", key: "new", minRole: "editor" },
      { href: "admin.html", label: "Admin", key: "admin", minRole: "admin" },
    ].filter(l => !l.minRole || (user && roleRank(user.role) >= roleRank(l.minRole)));

    const navHtml = links.map(l =>
      `<a href="${l.href}" class="${active === l.key ? "active" : ""}">${l.label}</a>`
    ).join("");

    const userChip = user
      ? `<div class="user-chip">
           <span>${escapeHtml(user.username)}</span>
           <span class="role-badge ${user.role}">${user.role}</span>
         </div>
         <button class="btn btn-ghost btn-sm" id="btn-logout">Sair</button>`
      : `<a class="btn btn-primary btn-sm" href="login.html">Entrar</a>`;

    return `
      <header class="site-header">
        <a class="brand" href="index.html">
          <span class="mark">R</span>
          <span>${escapeHtml(SITE_NAME)}</span>
        </a>
        <nav>${navHtml}</nav>
        <div class="spacer"></div>
        <form class="search-box" id="search-form" role="search" autocomplete="off">
          <span aria-hidden="true">⌕</span>
          <input type="search" id="search-input" placeholder="Buscar na wiki…" aria-label="Buscar">
        </form>
        ${userChip}
      </header>
    `;
  }

  function mountHeader(containerSelector, active) {
    const el = document.querySelector(containerSelector);
    if (!el) return;
    el.innerHTML = renderHeader(active);
    const btn = document.getElementById("btn-logout");
    if (btn) btn.addEventListener("click", (e) => { e.preventDefault(); logout(); });
    const form = document.getElementById("search-form");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = document.getElementById("search-input").value.trim();
        if (q) location.href = `index.html?q=${encodeURIComponent(q)}`;
      });
    }
  }

  // ---- helpers ----
  function roleRank(r) { return { viewer: 1, editor: 2, admin: 3 }[r] || 0; }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[m]);
  }

  // ---- redirect após login ----
  // Se o usuário tem mustChangePassword, força troca antes de ir ao destino.
  function redirectToNext() {
    const sess = currentSession();
    if (sess && sess.user && sess.user.mustChangePassword) {
      location.href = "change-password.html";
      return;
    }
    const params = new URLSearchParams(location.search);
    const next = params.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      location.href = next;
    } else {
      location.href = "index.html";
    }
  }

  window.auth = {
    currentSession, login, logout,
    requireAuth, mountHeader, redirectToNext,
    renderHeader, roleRank,
  };
})();
