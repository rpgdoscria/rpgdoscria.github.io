// frontend/js/api.js — wrapper de fetch com Authorization + tratamento de 401

(function () {
  const TOKEN_KEY = "rpg_wiki_token";
  const USER_KEY = "rpg_wiki_user";

  const cfg = window.WIKI_CONFIG || {};
  const API_BASE = cfg.API_BASE || "";

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
  }
  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* ignore */ }
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; }
  }
  function setUser(u) {
    try {
      if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
      else localStorage.removeItem(USER_KEY);
    } catch { /* ignore */ }
  }

  async function apiFetch(path, opts = {}) {
    const token = getToken();
    const headers = Object.assign({}, opts.headers || {});
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (opts.body && !(opts.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const finalOpts = Object.assign({}, opts, { headers });
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, finalOpts);
    } catch (e) {
      throw new ApiError("Falha de rede ao contatar a API.", 0, e);
    }

    if (res.status === 401) {
      // Token inválido ou expirado — limpa e redireciona para login
      // (somente se não estivermos já em /login.html)
      setToken(null);
      setUser(null);
      const onLoginPage = location.pathname.endsWith("login.html");
      if (!onLoginPage) {
        const next = encodeURIComponent(location.pathname + location.search + location.hash);
        location.href = `login.html?next=${next}`;
        // Lança para parar o fluxo
        throw new ApiError("Sessão expirada.", 401);
      }
    }

    const ct = res.headers.get("Content-Type") || "";
    let data = null;
    if (ct.includes("application/json")) {
      try { data = await res.json(); } catch { data = null; }
    } else if (ct.includes("text/")) {
      data = await res.text();
    }
    if (!res.ok) {
      const msg = (data && data.error) || `Erro ${res.status}`;
      throw new ApiError(msg, res.status, data);
    }
    return data;
  }

  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.data = data;
    }
  }

  // Helpers por área
  const api = {
    fetch: apiFetch,
    get: (p) => apiFetch(p, { method: "GET" }),
    post: (p, body) => apiFetch(p, { method: "POST", body: JSON.stringify(body) }),
    put: (p, body) => apiFetch(p, { method: "PUT", body: JSON.stringify(body) }),
    patch: (p, body) => apiFetch(p, { method: "PATCH", body: JSON.stringify(body) }),
    del: (p) => apiFetch(p, { method: "DELETE" }),
    postForm: (p, form) => apiFetch(p, { method: "POST", body: form }),
    Error: ApiError,
    getToken, setToken, getUser, setUser,
    API_BASE,
  };

  window.api = api;
})();
