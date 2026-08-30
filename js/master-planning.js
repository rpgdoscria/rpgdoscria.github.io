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
        // Carrega conteúdo específico de cada sub-aba
        if (sub === "wiki") loadWikiList();
        if (sub === "enemies") { bindEnemyButtons(); loadEnemiesList(); }
      });
    });
    // Bind inicial dos botões de inimigo (caso a sub-aba enemies já esteja ativa)
    bindEnemyButtons();

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

  // ===== Mini-wiki (Tarefa 6 v5: mostra APENAS páginas secretas) =====
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  async function loadWikiList() {
    const list = document.getElementById("planning-wiki-list");
    if (!list) return;
    list.innerHTML = `<div class="muted text-sm">Carregando páginas secretas…</div>`;
    try {
      // Usa endpoint /api/pages/secrets/list — só retorna páginas com secret=1
      const data = await window.api.get("/api/pages/secrets/list");
      const secrets = data.secrets || [];
      if (secrets.length === 0) {
        list.innerHTML = `<div class="muted text-sm">Nenhuma página secreta ainda. Clique em "+ Nova página" pra criar uma.</div>`;
        return;
      }
      list.innerHTML = secrets.map(p => `
        <div class="planning-wiki-row">
          <div class="planning-wiki-info">
            <strong>${esc(p.title)}</strong>
            ${p.revealed ? '<span class="tag tag-on" title="revelada">👁 revelada</span>' : '<span class="tag tag-off" title="secreta">🔒 secreta</span>'}
            <div class="text-xs muted">${esc(p.category || "")} · atualizada ${esc(p.updatedAt || p.updated_at || "")}</div>
          </div>
          <div class="flex gap-1">
            <button class="btn btn-sm btn-ghost" data-wiki-edit="${esc(p.slug)}">✎ Editar</button>
            <a class="btn btn-sm btn-ghost" href="/wiki/pagina?slug=${encodeURIComponent(p.slug)}" target="_blank">↗ Ver</a>
          </div>
        </div>
      `).join("");
      list.querySelectorAll('button[data-wiki-edit]').forEach(b => {
        b.addEventListener("click", () => openWikiEditor(b.dataset.wikiEdit));
      });
    } catch (e) {
      list.innerHTML = `<div class="alert alert-error">Erro: ${esc(e.message)}</div>`;
    }
  }

  // Abre modal de criar/editar página SECRETA da wiki — reutiliza /api/pages
  // Por padrão, novas páginas criadas daqui têm secret=true.
  function openWikiEditor(slug) {
    const existing = document.getElementById("planning-wiki-editor-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "planning-wiki-editor-overlay";
    overlay.className = "modal-backdrop";
    overlay.style.display = "grid";
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:640px">
        <h3 id="pwe-title">Nova página secreta</h3>
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
          <label class="text-sm">
            <input type="checkbox" id="pwe-secret" checked disabled> Página secreta (só mestre vê; pode ser revelada durante sessão)
          </label>
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
      overlay.querySelector("#pwe-title").textContent = "Editar página secreta";
      window.api.get(`/api/pages/${encodeURIComponent(slug)}`).then(p => {
        overlay.querySelector("#pwe-title-input").value = p.title || "";
        overlay.querySelector("#pwe-category").value = p.category || "Lore/História";
        overlay.querySelector("#pwe-content").value = p.content_md || "";
      }).catch(e => {
        overlay.querySelector("#pwe-alert").innerHTML = `<div class="alert alert-error">Erro: ${esc(e.message)}</div>`;
      });
    }

    overlay.querySelector("#pwe-save").addEventListener("click", async () => {
      const title = overlay.querySelector("#pwe-title-input").value.trim();
      const category = overlay.querySelector("#pwe-category").value;
      const content = overlay.querySelector("#pwe-content").value;
      const secret = true;  // sempre secreta quando criada daqui
      if (!title) { overlay.querySelector("#pwe-alert").innerHTML = `<div class="alert alert-error">Título é obrigatório.</div>`; return; }
      const saveBtn = overlay.querySelector("#pwe-save");
      saveBtn.disabled = true;
      saveBtn.textContent = "Salvando…";
      try {
        if (slug) {
          await window.api.put(`/api/pages/${encodeURIComponent(slug)}`, { title, category, content_md: content, secret });
        } else {
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

  // ===== Inimigos pré-prontos (Tarefa 6 v5: 2 modos básico/avançado) =====
  // Inimigos são armazenados como array JSON no master_planning.scenarios
  // (aproveitando a section existente pra não precisar de nova coluna).
  // Cada inimigo: { id, name, description, mode: 'basic'|'advanced', hpMode, hpMax, hpCurrent, description, ruleSetId?, stats?: [] }

  let enemiesList = [];
  let allRuleSets = [];

  async function loadRuleSets() {
    try {
      const data = await window.api.get("/api/rule-sets");
      allRuleSets = (data.ruleSets || []).filter(rs => rs.active);
    } catch (e) {
      console.warn("loadRuleSets:", e);
      allRuleSets = [];
    }
  }

  async function loadEnemiesList() {
    const list = document.getElementById("planning-enemies-list");
    if (!list) return;
    if (allRuleSets.length === 0) await loadRuleSets();
    // Carrega do backend (section 'scenarios' reaproveitada pra inimigos)
    try {
      const data = await window.api.get(`/api/rooms/${encodeURIComponent(roomCode)}/planning`);
      const raw = (data.planning || {}).scenarios || "";
      try { enemiesList = JSON.parse(raw); } catch { enemiesList = []; }
    } catch (e) { enemiesList = []; }

    if (!Array.isArray(enemiesList) || enemiesList.length === 0) {
      list.innerHTML = `<div class="muted text-sm">Nenhum inimigo criado ainda. Use os botões acima pra criar.</div>`;
      return;
    }
    list.innerHTML = enemiesList.map((en, i) => {
      const ruleSetName = en.ruleSetId ? (allRuleSets.find(rs => rs.id === en.ruleSetId)?.name || "?") : null;
      const hpLabel = en.hpMode === "description"
        ? (en.description || "Ileso")
        : `HP ${en.hpCurrent ?? "?"}/${en.hpMax ?? "?"}`;
      return `
        <div class="planning-enemy-card">
          <div class="enemy-name">${esc(en.name)} ${en.mode === 'advanced' ? '<span class="tag" style="font-size:10px">NPC avançado</span>' : '<span class="tag tag-off" style="font-size:10px">básico</span>'}</div>
          <div class="enemy-stats">${esc(hpLabel)}${ruleSetName ? ` · set: ${esc(ruleSetName)}` : ""}${en.description && en.hpMode === 'numeric' ? ` · ${esc(en.description)}` : ""}</div>
          <div class="flex gap-1 mt-2">
            <button class="btn btn-sm btn-primary" data-enemy-launch="${i}">🚀 Lançar na sala</button>
            <button class="btn btn-sm btn-ghost" data-enemy-edit="${i}">✎ Editar</button>
            <button class="btn btn-sm btn-danger" data-enemy-del="${i}">🗑</button>
          </div>
        </div>
      `;
    }).join("");
    // Bind botões
    list.querySelectorAll('button[data-enemy-launch]').forEach(b => {
      b.addEventListener("click", () => launchEnemy(Number(b.dataset.enemyLaunch)));
    });
    list.querySelectorAll('button[data-enemy-edit]').forEach(b => {
      b.addEventListener("click", () => openEnemyEditor(Number(b.dataset.enemyEdit)));
    });
    list.querySelectorAll('button[data-enemy-del]').forEach(b => {
      b.addEventListener("click", () => {
        const i = Number(b.dataset.enemyDel);
        if (!confirm(`Excluir "${enemiesList[i]?.name}"?`)) return;
        enemiesList.splice(i, 1);
        saveEnemiesList();
      });
    });
  }

  async function saveEnemiesList() {
    try {
      await window.api.put(
        `/api/rooms/${encodeURIComponent(roomCode)}/planning/scenarios`,
        { content: JSON.stringify(enemiesList) }
      );
      loadEnemiesList();
    } catch (e) {
      alert("Erro ao salvar inimigo: " + e.message);
    }
  }

  function launchEnemy(i) {
    const en = enemiesList[i];
    if (!en) return;
    // Envia via WebSocket pra criar inimigo na aba Inimigos
    const client = window._roomClient;
    if (!client) { alert("WebSocket não conectado."); return; }
    const payload = {
      name: en.name,
      kind: en.mode === "advanced" ? "complex" : "filler",
      hpMode: en.hpMode || "numeric",
      hpMax: en.hpMax ?? 10,
      hpCurrent: en.hpCurrent ?? en.hpMax ?? 10,
      description: en.description || "Ileso",
    };
    client.send("create_enemy", payload);
    showAlert("success", `🚀 "${en.name}" lançado na aba Inimigos!`);
    setTimeout(() => { document.getElementById("alert-mount").innerHTML = ""; }, 3000);
  }

  function showAlert(type, msg) {
    const mount = document.getElementById("alert-mount");
    if (mount) {
      mount.innerHTML = `<div class="alert alert-${type}">${esc(msg)}</div>`;
    }
  }

  // Modal de criar/editar inimigo — mode = 'basic' | 'advanced'
  function openEnemyEditor(editIdx, presetMode) {
    const editing = editIdx !== null && editIdx !== undefined && enemiesList[editIdx];
    const mode = editing ? editing.mode : (presetMode || "basic");
    const existing = document.getElementById("planning-enemy-editor-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "planning-enemy-editor-overlay";
    overlay.className = "modal-backdrop";
    overlay.style.display = "grid";

    // Campos do modo avançado: set de regras + stats
    const ruleSetOptions = allRuleSets.map(rs => `<option value="${rs.id}" ${editing?.ruleSetId === rs.id ? "selected" : ""}>${esc(rs.name)}</option>`).join("");
    const advancedFields = mode === "advanced" ? `
      <div class="field">
        <label>Set de regras (filler complexo)</label>
        <select id="pe-ruleset">
          <option value="">— sem set (stats manuais) —</option>
          ${ruleSetOptions}
        </select>
        <p class="text-xs muted mt-1">Ao escolher um set, os status base serão preenchidos automaticamente quando o inimigo for lançado na sala.</p>
      </div>
      <div class="field">
        <label>Notas do NPC (atributos especiais, magias, fraquezas…)</label>
        <textarea id="pe-npc-notes" rows="4" placeholder="Ex: Imune a fogo. Vulnerável a gelo. Conjura 2x/dia Bola de Fogo (6d6).">${esc(editing?.npcNotes || "")}</textarea>
      </div>
    ` : "";

    overlay.innerHTML = `
      <div class="modal-card" style="max-width:560px">
        <h3>${editing ? "Editar" : "Criar"} inimigo — modo ${mode === "advanced" ? "filler complexo" : "filler básico"}</h3>
        <div id="pe-alert"></div>
        <div class="field">
          <label>Nome *</label>
          <input type="text" id="pe-name" maxlength="100" value="${esc(editing?.name || "")}" placeholder="Ex: Goblin Chefe">
        </div>
        ${mode === "basic" ? `
          <div class="field">
            <label>Modo de vida</label>
            <select id="pe-hpmode">
              <option value="numeric" ${editing?.hpMode !== "description" ? "selected" : ""}>HP numérico</option>
              <option value="description" ${editing?.hpMode === "description" ? "selected" : ""}>Descrição qualitativa</option>
            </select>
          </div>
          <div class="field" id="pe-numeric-fields">
            <div class="grid-2">
              <div class="field">
                <label>HP máximo</label>
                <input type="number" id="pe-hpmax" value="${editing?.hpMax ?? 10}" min="0">
              </div>
              <div class="field">
                <label>HP atual (padrão = máximo)</label>
                <input type="number" id="pe-hpcurrent" value="${editing?.hpCurrent ?? editing?.hpMax ?? 10}" min="0">
              </div>
            </div>
          </div>
          <div class="field hidden" id="pe-desc-fields">
            <label>Descrição de status</label>
            <input type="text" id="pe-description" value="${esc(editing?.description || "Ileso")}" placeholder="Ex: Ileso, Ferido, À beira da morte">
          </div>
          <div class="field">
            <label>Notas (opcional)</label>
            <input type="text" id="pe-notes" value="${esc(editing?.description && editing?.hpMode === "numeric" ? editing.description : "")}" placeholder="Ex: Ataque +5 (1d6+3), CA 14">
          </div>
        ` : ""}
        ${advancedFields}
        <div class="modal-actions">
          <button class="btn btn-ghost" id="pe-cancel">Cancelar</button>
          <button class="btn btn-primary" id="pe-save">Salvar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector("#pe-cancel").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    // Toggle campos HP básico
    const hpModeSel = overlay.querySelector("#pe-hpmode");
    if (hpModeSel) {
      const toggle = () => {
        const isDesc = hpModeSel.value === "description";
        overlay.querySelector("#pe-numeric-fields").classList.toggle("hidden", isDesc);
        overlay.querySelector("#pe-desc-fields").classList.toggle("hidden", !isDesc);
      };
      hpModeSel.addEventListener("change", toggle);
      toggle();
    }

    overlay.querySelector("#pe-save").addEventListener("click", async () => {
      const name = overlay.querySelector("#pe-name").value.trim();
      if (!name) { overlay.querySelector("#pe-alert").innerHTML = `<div class="alert alert-error">Nome é obrigatório.</div>`; return; }
      const enemy = { id: editing?.id || ("en" + Date.now()), name, mode };
      if (mode === "basic") {
        enemy.hpMode = overlay.querySelector("#pe-hpmode").value;
        if (enemy.hpMode === "numeric") {
          enemy.hpMax = parseInt(overlay.querySelector("#pe-hpmax").value, 10) || 10;
          enemy.hpCurrent = parseInt(overlay.querySelector("#pe-hpcurrent").value, 10);
          if (isNaN(enemy.hpCurrent)) enemy.hpCurrent = enemy.hpMax;
          const notes = overlay.querySelector("#pe-notes").value.trim();
          if (notes) enemy.description = notes;
        } else {
          enemy.description = overlay.querySelector("#pe-description").value.trim() || "Ileso";
        }
      } else {
        // Avançado
        enemy.hpMode = "numeric";
        enemy.hpMax = parseInt(overlay.querySelector("#pe-hpmax")?.value || "20", 10) || 20;
        enemy.hpCurrent = enemy.hpMax;
        enemy.ruleSetId = overlay.querySelector("#pe-ruleset").value ? Number(overlay.querySelector("#pe-ruleset").value) : null;
        enemy.npcNotes = overlay.querySelector("#pe-npc-notes").value.trim();
        enemy.description = enemy.npcNotes;
      }
      if (editing) {
        enemiesList[editIdx] = enemy;
      } else {
        enemiesList.push(enemy);
      }
      overlay.remove();
      await saveEnemiesList();
    });
  }

  // Expõe init adicional pros botões de inimigo
  function bindEnemyButtons() {
    const newBasic = document.getElementById("planning-enemy-new-basic");
    if (newBasic) newBasic.addEventListener("click", () => openEnemyEditor(null, "basic"));
    const newAdv = document.getElementById("planning-enemy-new-advanced");
    if (newAdv) newAdv.addEventListener("click", () => openEnemyEditor(null, "advanced"));
  }

  window.masterPlanning = { init, loadWikiList, loadEnemiesList, openEnemyEditor };
})();
