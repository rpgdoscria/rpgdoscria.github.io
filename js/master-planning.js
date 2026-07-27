// frontend/js/master-planning.js — aba de planejamento privado do mestre
//
// Tarefa 5 (final): 3 sub-abas — Anotações, Inimigos pré-prontos, Mini-wiki.
//   - Anotações/Inimigos: textarea com autosave (debounce 1s) no backend master_planning.
//   - Mini-wiki: CRUD de páginas da wiki usando endpoints /api/pages existentes.
//     Páginas marcadas como secretas ficam sempre visíveis pro mestre.

(function () {
  let initialized = false;
  let roomCode = null;
  const DEBOUNCE_MS = 1000;
  const timers = {};

  async function init(code) {
    if (initialized) return;
    roomCode = code;
    initialized = true;

    // === Sub-abas ===
    document.querySelectorAll(".planning-subtab").forEach(btn => {
      btn.addEventListener("click", () => {
        const sub = btn.dataset.subtab;
        document.querySelectorAll(".planning-subtab").forEach(b => b.classList.toggle("active", b === btn));
        document.querySelectorAll(".planning-subpanel").forEach(p => p.classList.toggle("active", p.dataset.subpanel === sub));
        // Carrega mini-wiki na primeira vez que abre
        if (sub === "wiki") loadWikiList();
      });
    });

    // === Anotações + Inimigos (autosave) ===
    try {
      const data = await window.api.get(`/api/rooms/${encodeURIComponent(code)}/planning`);
      const planning = data.planning || {};
      const notesEl = document.getElementById("planning-notes");
      const enemiesEl = document.getElementById("planning-enemies");
      if (notesEl) notesEl.value = planning.notes || "";
      if (enemiesEl) enemiesEl.value = planning.enemies || "";
      updateStatus("notes", "carregado ✓");
      updateStatus("enemies", "carregado ✓");
    } catch (e) {
      console.warn("master-planning: erro ao carregar:", e);
    }

    ["notes", "enemies"].forEach(section => {
      const el = document.getElementById(`planning-${section}`);
      if (!el) return;
      el.addEventListener("input", () => scheduleSave(section, el.value));
      el.addEventListener("change", () => scheduleSave(section, el.value, true));
    });

    // === Mini-wiki ===
    const newBtn = document.getElementById("planning-wiki-new");
    if (newBtn) newBtn.addEventListener("click", () => openWikiEditor(null));
    const refreshBtn = document.getElementById("planning-wiki-refresh");
    if (refreshBtn) refreshBtn.addEventListener("click", loadWikiList);
  }

  function scheduleSave(section, content, immediate = false) {
    if (timers[section]) clearTimeout(timers[section]);
    const delay = immediate ? 0 : DEBOUNCE_MS;
    updateStatus(section, "salvando…");
    timers[section] = setTimeout(async () => {
      try {
        await window.api.put(
          `/api/rooms/${encodeURIComponent(roomCode)}/planning/${section}`,
          { content }
        );
        updateStatus(section, "salvo ✓");
      } catch (e) {
        updateStatus(section, "erro ao salvar");
      }
    }, delay);
  }

  function updateStatus(section, msg) {
    const el = document.getElementById(`planning-${section}-status`);
    if (el) {
      const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      el.textContent = `${msg} · ${now}`;
    }
  }

  // ===== Mini-wiki =====
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  async function loadWikiList() {
    const list = document.getElementById("planning-wiki-list");
    if (!list) return;
    list.innerHTML = `<div class="muted text-sm">Carregando…</div>`;
    try {
      const data = await window.api.get("/api/pages");
      const pages = data.pages || [];
      if (pages.length === 0) {
        list.innerHTML = `<div class="muted text-sm">Nenhuma página na wiki ainda. Clique em "+ Nova página" pra criar.</div>`;
        return;
      }
      list.innerHTML = pages.map(p => `
        <div class="planning-wiki-row">
          <div class="planning-wiki-info">
            <strong>${esc(p.title)}</strong>
            ${p.secret ? '<span class="tag tag-off" title="secreta">🔒 secreta</span>' : ""}
            ${p.revealed ? '<span class="tag tag-on" title="revelada">👁 revelada</span>' : ""}
            <div class="text-xs muted">${esc(p.category || "")} · atualizada ${esc(p.updated_at || "")}</div>
          </div>
          <div class="flex gap-1">
            <button class="btn btn-sm btn-ghost" data-wiki-edit="${esc(p.slug)}">✎ Editar</button>
            <a class="btn btn-sm btn-ghost" href="wiki/pagina.html?slug=${encodeURIComponent(p.slug)}" target="_blank">↗ Ver</a>
          </div>
        </div>
      `).join("");
      // (secret/revealed vêm como 0/1 do banco — truthy/falsy funciona)
      list.querySelectorAll('button[data-wiki-edit]').forEach(b => {
        b.addEventListener("click", () => openWikiEditor(b.dataset.wikiEdit));
      });
    } catch (e) {
      list.innerHTML = `<div class="alert alert-error">Erro: ${esc(e.message)}</div>`;
    }
  }

  // Abre modal de criar/editar página da wiki — reutiliza endpoints /api/pages
  function openWikiEditor(slug) {
    const existing = document.getElementById("planning-wiki-editor-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "planning-wiki-editor-overlay";
    overlay.className = "modal-backdrop";
    overlay.style.display = "grid";
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:640px">
        <h3 id="pwe-title">Nova página da wiki</h3>
        <div id="pwe-alert"></div>
        <div class="field">
          <label>Título *</label>
          <input type="text" id="pwe-title-input" maxlength="200" placeholder="Ex: O Castelo de Blackmoor">
        </div>
        <div class="field">
          <label>Categoria</label>
          <select id="pwe-category">
            <option value="Lore/História">Lore/História</option>
            <option value="Personagens">Personagens</option>
            <option value="Locais">Locais</option>
            <option value="Itens & Equipamentos">Itens & Equipamentos</option>
            <option value="Sessões Jogadas">Sessões Jogadas</option>
            <option value="Regras da Casa">Regras da Casa</option>
            <option value="Criaturas">Criaturas</option>
          </select>
        </div>
        <div class="field">
          <label>Conteúdo (markdown)</label>
          <textarea id="pwe-content" rows="10" placeholder="Escreva em markdown. Use [[Título]] para links internos."></textarea>
        </div>
        <div class="field">
          <label class="text-sm"><input type="checkbox" id="pwe-secret"> Página secreta (só mestre vê; pode ser revelada durante sessão)</label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="pwe-cancel">Cancelar</button>
          <button class="btn btn-primary" id="pwe-save">Salvar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector("#pwe-cancel").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    // Se editando, carrega dados existentes
    if (slug) {
      overlay.querySelector("#pwe-title").textContent = "Editar página";
      window.api.get(`/api/pages/${encodeURIComponent(slug)}`).then(p => {
        overlay.querySelector("#pwe-title-input").value = p.title || "";
        overlay.querySelector("#pwe-category").value = p.category || "Lore/História";
        overlay.querySelector("#pwe-content").value = p.content_md || "";
        overlay.querySelector("#pwe-secret").checked = !!p.secret;
      }).catch(e => {
        overlay.querySelector("#pwe-alert").innerHTML = `<div class="alert alert-error">Erro: ${esc(e.message)}</div>`;
      });
    }

    overlay.querySelector("#pwe-save").addEventListener("click", async () => {
      const title = overlay.querySelector("#pwe-title-input").value.trim();
      const category = overlay.querySelector("#pwe-category").value;
      const content = overlay.querySelector("#pwe-content").value;
      const secret = overlay.querySelector("#pwe-secret").checked;
      if (!title) { overlay.querySelector("#pwe-alert").innerHTML = `<div class="alert alert-error">Título é obrigatório.</div>`; return; }
      const saveBtn = overlay.querySelector("#pwe-save");
      saveBtn.disabled = true;
      saveBtn.textContent = "Salvando…";
      try {
        if (slug) {
          // PUT /api/pages/:slug
          await window.api.put(`/api/pages/${encodeURIComponent(slug)}`, { title, category, content_md: content, secret });
        } else {
          // POST /api/pages
          await window.api.post("/api/pages", { title, category, content_md: content, secret });
        }
        overlay.remove();
        loadWikiList();
      } catch (e) {
        overlay.querySelector("#pwe-alert").innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
        saveBtn.disabled = false;
        saveBtn.textContent = "Salvar";
      }
    });
  }

  window.masterPlanning = { init, loadWikiList };
})();
