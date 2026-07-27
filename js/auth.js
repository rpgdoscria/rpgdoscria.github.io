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
    // Desde a migration 0005, mestre === admin (mesmo cargo). isGameMaster no
    // objeto do user é mantido por compat com checagens existentes no frontend,
    // mas agora é só um alias de role === 'admin'.
    window.api.setUser({
      id: 0,
      username: data.username,
      role: data.role,
      isGameMaster: data.role === "admin",
      mustChangePassword: !!data.mustChangePassword,
      expiresAt: data.expiresAt,
    });
    try {
      const me = await window.api.get("/api/auth/me");
      window.api.setUser(Object.assign({}, window.api.getUser(), me, {
        isGameMaster: me.role === "admin",
      }));
    } catch (e) {
      // silencioso: ainda temos o básico do login
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
  // Refatorado (v5): menu dropdown categorizado em vez de links soltos.
  // Categorias: Wiki, Personagens, Salas, Admin (se admin), Conta.
  // Em mobile (<768px), vira menu hamburguer.
  function renderHeader(active = "") {
    const sess = currentSession();
    const user = sess ? sess.user : null;
    const inWiki = location.pathname.includes("/wiki/");
    const rel = (p) => inWiki ? "../" + p : p;
    const wikiHref = inWiki ? "index.html" : "wiki/index.html";

    const isAdmin = user && user.role === "admin";
    const isMaster = user && (user.role === "admin" || user.isGameMaster);

    // Definição das categorias com sub-itens
    const categories = [];
    categories.push({
      key: "wiki",
      label: "Wiki",
      items: [
        { href: wikiHref, label: "Página Inicial", key: "wiki" },
        { href: inWiki ? "editar.html?new=true" : "wiki/editar.html?new=true", label: "Criar Página", key: "new", minRole: "editor" },
      ],
    });
    categories.push({
      key: "characters",
      label: "Personagens",
      items: [
        { href: rel("meus-personagens.html"), label: "Meus Personagens", key: "characters" },
        { href: rel("criar-personagem.html"), label: "Criar Personagem" },
        { href: rel("gerenciar-sets-regras.html"), label: "Sets de Regras", key: "rulesets", minMaster: true },
      ],
    });
    categories.push({
      key: "rooms",
      label: "Salas",
      items: [
        { href: rel("criar-sala.html"), label: "Criar Sala", key: "rooms", minMaster: true },
        { href: rel("entrar-sala.html"), label: "Entrar em Sala", key: "join" },
        { href: rel("perfil.html"), label: "Minhas Salas", minMaster: true },
      ],
    });
    if (isAdmin) {
      categories.push({
        key: "admin",
        label: "Admin",
        items: [
          { href: rel("admin.html"), label: "Painel Admin", key: "admin" },
          { href: rel("gerenciar-status.html"), label: "Gerenciar Status", key: "stats" },
        ],
      });
    }

    // Filtra categorias vazias (após filtrar sub-itens por permissão)
    const visibleCats = categories.map(cat => {
      const items = cat.items.filter(it => {
        if (it.minRole && !(user && roleRank(user.role) >= roleRank(it.minRole))) return false;
        if (it.minMaster && !isMaster) return false;
        return true;
      });
      return { ...cat, items };
    }).filter(cat => cat.items.length > 0);

    // Renderiza cada categoria como <li class="nav-cat"> com dropdown
    const navHtml = visibleCats.map(cat => {
      const hasActive = cat.items.some(it => it.key === active);
      const itemsHtml = cat.items.map(it =>
        `<a href="${it.href}" class="${it.key === active ? "active" : ""}">${escapeHtml(it.label)}</a>`
      ).join("");
      return `
        <li class="nav-cat ${hasActive ? "has-active" : ""}">
          <button class="nav-cat-btn" type="button" aria-haspopup="true" aria-expanded="false">
            ${escapeHtml(cat.label)} <span class="nav-caret">▾</span>
          </button>
          <div class="nav-dropdown">${itemsHtml}</div>
        </li>
      `;
    }).join("");

    // User chip + conta (sempre visível, não em dropdown)
    const userChip = user
      ? `<a class="user-chip" href="${rel("perfil.html")}" style="text-decoration:none;color:inherit">
           <span>${escapeHtml(user.username)}</span>
           <span class="role-badge ${user.role}">${user.role}</span>
         </a>
         <button class="btn btn-ghost btn-sm" id="btn-logout" title="Sair">⎋</button>`
      : `<a class="btn btn-primary btn-sm" href="${rel("login.html")}">Entrar</a>`;

    return `
      <header class="site-header">
        <a class="brand" href="${rel("index.html")}">
          <span class="mark">R</span>
          <span>${escapeHtml(SITE_NAME)}</span>
        </a>
        <button class="nav-hamburger" id="nav-hamburger" aria-label="Menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
        <nav class="site-nav" id="site-nav" aria-label="Navegação principal">
          <ul class="nav-menu">${navHtml}</ul>
        </nav>
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
        if (q) {
          const inWiki = location.pathname.includes("/wiki/");
          location.href = (inWiki ? "index.html" : "wiki/index.html") + `?q=${encodeURIComponent(q)}`;
        }
      });
    }

    // ===== Dropdowns (desktop) =====
    el.querySelectorAll(".nav-cat").forEach(cat => {
      const btn = cat.querySelector(".nav-cat-btn");
      const dropdown = cat.querySelector(".nav-dropdown");
      if (!btn || !dropdown) return;
      // Click toggla (mobile + desktop acessível)
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = cat.classList.contains("open");
        // Fecha outros
        el.querySelectorAll(".nav-cat.open").forEach(c => {
          if (c !== cat) { c.classList.remove("open"); c.querySelector(".nav-cat-btn")?.setAttribute("aria-expanded", "false"); }
        });
        cat.classList.toggle("open", !isOpen);
        btn.setAttribute("aria-expanded", String(!isOpen));
      });
      // Hover abre (desktop só)
      cat.addEventListener("mouseenter", () => {
        if (window.innerWidth >= 768) {
          el.querySelectorAll(".nav-cat.open").forEach(c => { c.classList.remove("open"); c.querySelector(".nav-cat-btn")?.setAttribute("aria-expanded", "false"); });
          cat.classList.add("open");
          btn.setAttribute("aria-expanded", "true");
        }
      });
      cat.addEventListener("mouseleave", () => {
        if (window.innerWidth >= 768) {
          cat.classList.remove("open");
          btn.setAttribute("aria-expanded", "false");
        }
      });
    });
    // Fecha dropdown ao clicar fora
    document.addEventListener("click", () => {
      el.querySelectorAll(".nav-cat.open").forEach(c => { c.classList.remove("open"); c.querySelector(".nav-cat-btn")?.setAttribute("aria-expanded", "false"); });
    });

    // ===== Menu hamburguer (mobile) =====
    const hamburger = document.getElementById("nav-hamburger");
    const nav = document.getElementById("site-nav");
    if (hamburger && nav) {
      hamburger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = nav.classList.contains("mobile-open");
        nav.classList.toggle("mobile-open", !isOpen);
        hamburger.setAttribute("aria-expanded", String(!isOpen));
        hamburger.classList.toggle("active", !isOpen);
      });
      // Fecha ao clicar num link
      nav.addEventListener("click", (e) => {
        if (e.target.tagName === "A" && window.innerWidth < 768) {
          nav.classList.remove("mobile-open");
          hamburger.classList.remove("active");
          hamburger.setAttribute("aria-expanded", "false");
        }
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
  // Padrão (sem ?next=): vai pra perfil.html (dashboard pessoal) em vez de index.html.
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
      location.href = "perfil.html";
    }
  }

  window.auth = {
    currentSession, login, logout,
    requireAuth, mountHeader, redirectToNext,
    renderHeader, roleRank,
  };
})();
