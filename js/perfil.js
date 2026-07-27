// frontend/js/perfil.js — dashboard pessoal após login
//
// Mostra:
//  1. Meus personagens (mini cards com foto, nome, link pra editar)
//  2. Minhas edições recentes na wiki (5 últimas páginas criadas/editadas)
//  3. (Mestres) Minhas salas ativas e encerradas — com botões Reabrir/Encerrar/Excluir
//
// Usa endpoints já existentes: /api/characters, /api/pages?author=USER, /api/rooms
// Não cria novos endpoints no backend — agrega dados no cliente.

(function () {
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }
  function formatTime(s) {
    if (!s) return "";
    const d = new Date(s.replace(" ", "T") + "Z");
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  function avatarHtml(ch, size = 40) {
    const initial = (ch.name || "?").charAt(0).toUpperCase();
    if (ch.photoUrl) {
      return `<div class="perfil-char-mini-avatar" style="width:${size}px;height:${size}px"><img src="${escapeHtml(ch.photoUrl)}" alt="${escapeHtml(ch.name)}"></div>`;
    }
    return `<div class="perfil-char-mini-avatar" style="width:${size}px;height:${size}px;font-size:${Math.floor(size/2)}px">${escapeHtml(initial)}</div>`;
  }

  async function init(sess) {
    const userInfo = document.getElementById("user-info");
    const grid = document.getElementById("perfil-grid");
    const alertMount = document.getElementById("alert-mount");

    userInfo.textContent = `@${sess.user.username} · ${sess.user.role}`;
    const isMaster = sess.user.role === "admin" || sess.user.isGameMaster;

    function showAlert(type, msg) {
      alertMount.innerHTML = `<div class="alert alert-${type}">${escapeHtml(msg)}</div>`;
    }

    grid.innerHTML = `<div class="perfil-card"><h3>⏳ Carregando…</h3></div>`;

    // Carrega tudo em paralelo
    const [charsRes, pagesRes, roomsRes] = await Promise.allSettled([
      window.api.get("/api/characters"),
      window.api.get("/api/pages"),
      isMaster ? window.api.get("/api/rooms") : Promise.resolve({ rooms: [] }),
    ]);

    // === Personagens ===
    let charsHtml = "";
    if (charsRes.status === "fulfilled" && charsRes.value.characters) {
      const chars = charsRes.value.characters;
      if (chars.length === 0) {
        charsHtml = `
          <p class="muted text-sm">Você ainda não tem personagens.</p>
          <a href="/criar-personagem" class="btn btn-primary btn-sm">+ Criar primeiro personagem</a>
        `;
      } else {
        charsHtml = chars.map(c => `
          <a href="/criar-personagem?id=${c.id}" class="perfil-char-mini">
            ${avatarHtml(c)}
            <div class="perfil-char-mini-info">
              <div class="perfil-char-mini-name">${escapeHtml(c.name)}${c.isActive ? " ⭐" : ""}</div>
              <div class="perfil-char-mini-meta">${(c.stats || []).length} status · ${(c.inventory || []).length} itens · atualizado ${formatTime(c.updatedAt)}</div>
            </div>
          </a>
        `).join("");
      }
    } else {
      charsHtml = `<div class="alert alert-error">Erro ao carregar personagens.</div>`;
    }

    // === Edições recentes na wiki ===
    let wikiHtml = "";
    if (pagesRes.status === "fulfilled") {
      const data = pagesRes.value;
      // data.recent é uma lista de revisões recentes; filtramos só as do usuário atual
      const myRecent = (data.recent || []).filter(r => r.editor_id === sess.user.id || r.editorId === sess.user.id).slice(0, 5);
      if (myRecent.length === 0) {
        wikiHtml = `<p class="muted text-sm">Você ainda não editou páginas da wiki.</p>
                    <a href="/wiki" class="btn btn-ghost btn-sm">Explorar wiki →</a>`;
      } else {
        wikiHtml = myRecent.map(r => {
          const slug = r.slug || r.page_slug || "";
          const title = r.title || r.page_title || "(sem título)";
          const date = formatTime(r.created_at || r.created || r.updated_at);
          return `<a href="/wiki/pagina?slug=${encodeURIComponent(slug)}" class="perfil-list-item">
            <div class="perfil-list-item-title">${escapeHtml(title)}</div>
            <div class="perfil-list-item-meta">editada em ${date} · ${escapeHtml(r.comment || "sem comentário")}</div>
          </a>`;
        }).join("");
      }
    } else {
      wikiHtml = `<div class="alert alert-error">Erro ao carregar edições wiki.</div>`;
    }

    // === Salas (mestre only) ===
    let roomsHtml = "";
    if (isMaster) {
      if (roomsRes.status === "fulfilled" && roomsRes.value.rooms) {
        const rooms = roomsRes.value.rooms;
        if (rooms.length === 0) {
          roomsHtml = `<p class="muted text-sm">Você ainda não criou salas.</p>
                       <a href="/criar-sala" class="btn btn-primary btn-sm">+ Criar primeira sala</a>`;
        } else {
          roomsHtml = rooms.slice(0, 10).map(r => `
            <div class="perfil-room-row ${r.isActive ? "" : "inactive"}">
              <div class="perfil-room-name">${escapeHtml(r.name || "Sala sem nome")}</div>
              <code class="perfil-room-code">${escapeHtml(r.code)}</code>
              ${r.isActive ? `<a class="btn btn-sm btn-primary" href="/sala?code=${encodeURIComponent(r.code)}">Reabrir</a>` : `<span class="tag tag-off">encerrada</span>`}
            </div>
          `).join("");
          if (rooms.length > 10) {
            roomsHtml += `<p class="text-xs muted mt-2">+${rooms.length - 10} salas anteriores — <a href="/criar-sala">ver todas</a></p>`;
          }
        }
      } else {
        roomsHtml = `<div class="alert alert-error">Erro ao carregar salas.</div>`;
      }
    }

    // === Render final ===
    grid.innerHTML = `
      <div class="perfil-card">
        <h3>🧙 Meus personagens</h3>
        ${charsHtml}
      </div>

      <div class="perfil-card">
        <h3>📚 Edições recentes na wiki</h3>
        ${wikiHtml}
      </div>

      ${isMaster ? `
        <div class="perfil-card">
          <h3>🎪 Minhas salas</h3>
          ${roomsHtml}
        </div>
      ` : ""}

      <div class="perfil-card">
        <h3>⚡ Ações rápidas</h3>
        <div class="flex flex-wrap gap-2">
          <a href="/wiki" class="btn btn-ghost btn-sm">📚 Wiki</a>
          <a href="/entrar-sala" class="btn btn-ghost btn-sm">🔗 Entrar em sala</a>
          ${isMaster ? `<a href="/criar-sala" class="btn btn-ghost btn-sm">🎪 Criar sala</a>` : ""}
          ${sess.user.role === "admin" ? `<a href="/admin" class="btn btn-ghost btn-sm">⚙️ Admin</a>` : ""}
        </div>
      </div>
    `;
  }

  window.perfil = { init };
})();
