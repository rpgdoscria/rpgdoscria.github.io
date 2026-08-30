// frontend/js/admin.js — lógica do painel administrativo

(function () {
  window.auth.mountHeader("#header-mount", "admin");
  const sess = window.auth.requireAuth("admin");
  if (!sess) return;

  const alertMount = document.getElementById("alert-mount");
  const usersListEl = document.getElementById("users-list");
  const auditListEl = document.getElementById("audit-list");
  const btnNew = document.getElementById("btn-new-user");
  const newUserForm = document.getElementById("new-user-form");
  const btnCreateUser = document.getElementById("btn-create-user");
  const btnCancelNewUser = document.getElementById("btn-cancel-new-user");

  const editModal = document.getElementById("edit-modal");
  const emAlert = document.getElementById("em-alert");
  const emUsername = document.getElementById("em-username");
  const emRole = document.getElementById("em-role");
  const emActive = document.getElementById("em-active");
  const emMustChange = document.getElementById("em-must-change");
  const emPassword = document.getElementById("em-password");
  const emSave = document.getElementById("em-save");
  const emCancel = document.getElementById("em-cancel");
  const assetsModal = document.getElementById("user-assets-modal");
  const assetsTitle = document.getElementById("assets-title");
  const assetsSubtitle = document.getElementById("assets-subtitle");
  const assetsAlert = document.getElementById("assets-alert");
  const assetsSummary = document.getElementById("assets-summary");
  const assetsCharacters = document.getElementById("assets-characters");
  const assetsPages = document.getElementById("assets-pages");
  const assetsChronicles = document.getElementById("assets-chronicles");
  const assetsOther = document.getElementById("assets-other");
  let editingId = null;
  let assetsUserId = null;

  function showAlert(type, msg) {
    alertMount.innerHTML = `<div class="alert alert-${type}">${escapeHtml(msg)}</div>`;
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }
  function formatDate(s) {
    if (!s) return "—";
    const d = new Date(s.endsWith("Z") ? s : s.replace(" ", "T") + "Z");
    return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }
  function normalizeName(value) {
    return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function renderAssetList(target, rows, emptyMessage, renderRow) {
    target.innerHTML = rows.length ? rows.map(renderRow).join("") : `<div class="admin-assets-empty">${escapeHtml(emptyMessage)}</div>`;
  }

  // ---- Users ----
  let showDeleted = false;
  async function loadUsers() {
    usersListEl.innerHTML = `<div class="muted text-sm">Carregando…</div>`;
    try {
      const url = showDeleted ? "/api/admin/users?includeDeleted=1" : "/api/admin/users";
      const data = await window.api.get(url);
      const users = data.users || [];
      if (!users.length) {
        usersListEl.innerHTML = `<div class="muted">Nenhum usuário.</div>`;
        return;
      }
      usersListEl.innerHTML = users.map(u => {
        const isDeleted = !!u.deleted_at;
        const isSelf = u.id === sess.user.id;
        return `
        <div class="list-row" ${isDeleted ? 'style="opacity:0.5"' : ''}>
          <div>
            <div class="title">
              ${escapeHtml(u.username)}
              ${isSelf ? `<span class="tag" style="margin-left:8px">você</span>` : ""}
              ${isDeleted ? `<span class="tag tag-off" style="margin-left:8px">excluída ${formatDate(u.deleted_at)}</span>` : ""}
            </div>
            <div class="meta">criado em ${formatDate(u.created_at)} · último login ${formatDate(u.last_login)}</div>
          </div>
          <div class="spacer"></div>
          <span class="tag tag-${u.role}">${u.role}</span>
          <span class="tag ${u.active ? "tag-on" : "tag-off"}">${u.active ? "ativo" : "inativo"}</span>
          ${u.must_change_password ? `<span class="tag">trocar senha</span>` : ""}
          ${!isDeleted ? `<div class="admin-user-actions"><button class="btn btn-sm" data-assets="${u.id}">Ver conteúdo</button><button class="btn btn-sm" data-edit="${u.id}">Editar</button></div>` : ""}
          ${!isDeleted && !isSelf ? `<button class="btn btn-sm btn-danger" data-del="${u.id}">Excluir</button>` : ""}
        </div>
      `;
      }).join("");

      // bind editar
      usersListEl.querySelectorAll('button[data-edit]').forEach(b => {
        b.addEventListener("click", () => openEditModal(Number(b.dataset.edit)));
      });
      usersListEl.querySelectorAll('button[data-assets]').forEach(b => {
        b.addEventListener("click", () => openAssetsModal(Number(b.dataset.assets)));
      });
      // bind excluir (abre modal de confirmação, não pergunta via confirm())
      usersListEl.querySelectorAll('button[data-del]').forEach(b => {
        b.addEventListener("click", () => openDeleteModal(Number(b.dataset.del), users));
      });
    } catch (e) {
      usersListEl.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
    }
  }

  // ---- Modal de exclusão ----
  let pendingDeleteId = null;
  function openDeleteModal(id, users) {
    const target = users.find(u => u.id === id);
    if (!target) return;
    pendingDeleteId = id;
    document.getElementById("del-username").textContent = `Conta: ${target.username} (${target.role})`;
    document.getElementById("del-alert").innerHTML = "";
    document.getElementById("delete-modal").classList.remove("hidden");
    document.getElementById("delete-modal").style.display = "grid";
  }
  document.getElementById("del-cancel").addEventListener("click", () => {
    document.getElementById("delete-modal").classList.add("hidden");
    document.getElementById("delete-modal").style.display = "";
    pendingDeleteId = null;
  });
  document.getElementById("del-confirm").addEventListener("click", async () => {
    if (!pendingDeleteId) return;
    try {
      const res = await window.api.del(`/api/admin/users/${pendingDeleteId}`);
      // api.del retorna o JSON parsed; res.mode diz se foi 'deleted' ou 'anonymized'
      const msg = res.message || "Conta excluída.";
      const mode = res.mode ? ` (${res.mode === "deleted" ? "exclusão real" : "anonimizada"})` : "";
      showAlert("success", msg + mode);
      document.getElementById("delete-modal").classList.add("hidden");
      document.getElementById("delete-modal").style.display = "";
      pendingDeleteId = null;
      loadUsers();
      loadAudit();
    } catch (e) {
      document.getElementById("del-alert").innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
    }
  });

  // ---- Toggle mostrar excluídas ----
  document.getElementById("show-deleted").addEventListener("change", (e) => {
    showDeleted = e.target.checked;
    loadUsers();
  });

  // ---- Audit ----
  async function loadAudit() {
    auditListEl.innerHTML = `<div class="muted text-sm">Carregando…</div>`;
    try {
      const data = await window.api.get("/api/admin/audit-log?limit=200");
      const entries = data.entries || [];
      if (!entries.length) {
        auditListEl.innerHTML = `<div class="muted">Sem registros.</div>`;
        return;
      }
      auditListEl.innerHTML = entries.map(a => `
        <div class="list-row">
          <div>
            <div class="title">
              <code>${escapeHtml(a.action)}</code>
              ${a.target ? `· <span>${escapeHtml(a.target)}</span>` : ""}
            </div>
            <div class="meta">
              ${a.username ? escapeHtml(a.username) : "—"} · ${formatDate(a.created_at)}
              ${a.details ? ` · <span class="faint">${escapeHtml(a.details)}</span>` : ""}
            </div>
          </div>
        </div>
      `).join("");
    } catch (e) {
      auditListEl.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
    }
  }

  // ---- Novo usuário ----
  btnNew.addEventListener("click", () => newUserForm.classList.remove("hidden"));
  btnCancelNewUser.addEventListener("click", () => newUserForm.classList.add("hidden"));
  btnCreateUser.addEventListener("click", async () => {
    const username = document.getElementById("nu-username").value.trim();
    const password = document.getElementById("nu-password").value;
    const role = document.getElementById("nu-role").value;
    const must_change_password = document.getElementById("nu-must-change").value === "1";
    if (!username || password.length < 8) {
      showAlert("error", "Preencha usuário e senha (mín. 8 caracteres).");
      return;
    }
    try {
      await window.api.post("/api/admin/users", { username, password, role, must_change_password });
      showAlert("success", `Usuário "${username}" criado.`);
      newUserForm.classList.add("hidden");
      document.getElementById("nu-username").value = "";
      document.getElementById("nu-password").value = "";
      loadUsers();
      loadAudit();
    } catch (e) { showAlert("error", e.message); }
  });

  // ---- Modal de edição ----
  function openEditModal(id) {
    editingId = id;
    emAlert.innerHTML = "";
    emPassword.value = "";
    // Busca dados atuais
    window.api.get("/api/admin/users").then(data => {
      const u = (data.users || []).find(x => x.id === id);
      if (!u) return;
      emUsername.value = u.username;
      emRole.value = u.role;
      emActive.value = String(u.active);
      emMustChange.value = String(u.must_change_password ? 1 : 0);
      editModal.classList.remove("hidden");
      editModal.style.display = "grid";
    }).catch(e => showAlert("error", e.message));
  }
  emCancel.addEventListener("click", () => {
    editModal.classList.add("hidden");
    editModal.style.display = "";
    editingId = null;
  });
  emSave.addEventListener("click", async () => {
    const body = {
      role: emRole.value,
      active: emActive.value === "1",
      must_change_password: emMustChange.value === "1",
    };
    if (emPassword.value.trim().length >= 8) {
      body.password = emPassword.value.trim();
      body.must_change_password = true;
    }
    try {
      await window.api.patch(`/api/admin/users/${editingId}`, body);
      showAlert("success", "Usuário atualizado.");
      editModal.classList.add("hidden");
      editModal.style.display = "";
      loadUsers();
      loadAudit();
    } catch (e) {
      emAlert.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
    }
  });

  // ---- Conteúdo associado a um usuário ----
  async function openAssetsModal(id) {
    assetsUserId = id;
    assetsTitle.textContent = "Conteúdo do usuário";
    assetsSubtitle.textContent = "Carregando informações…";
    assetsAlert.innerHTML = "";
    assetsSummary.innerHTML = "";
    assetsCharacters.innerHTML = '<div class="admin-assets-empty">Carregando…</div>';
    assetsPages.innerHTML = "";
    assetsChronicles.innerHTML = "";
    assetsOther.innerHTML = "";
    assetsModal.classList.remove("hidden");
    assetsModal.style.display = "grid";

    try {
      const data = await window.api.get("/api/admin/users/" + encodeURIComponent(id) + "/overview");
      const user = data.user || {};
      assetsTitle.textContent = "Conteúdo de " + (user.username || ("usuário #" + id));
      assetsSubtitle.textContent = "ID #" + id + " · papel " + user.role + " · criado em " + formatDate(user.createdAt);

      const counts = data.summary || {};
      const summaryItems = [
        ["characters", "Personagens"],
        ["pages", "Páginas"],
        ["chroniclesCreated", "Crônicas criadas"],
        ["rooms", "Salas"],
        ["dicePresets", "Presets"],
        ["statTemplates", "Status criados"],
        ["revisions", "Revisões"],
        ["diceRolls", "Rolagens"],
        ["ruleSets", "Sets de regras"],
        ["sessions", "Participações"],
        ["trades", "Trocas"],
        ["purchaseOffers", "Ofertas"],
        ["polls", "Enquetes"],
        ["pollVotes", "Votos"],
        ["chatMessages", "Mensagens"],
        ["masterPlanning", "Planejamento"],
        ["auditEntries", "Auditoria"],
      ];
      assetsSummary.innerHTML = summaryItems.map(item =>
        '<div class="admin-assets-stat"><strong>' + Number(counts[item[0]] || 0) + '</strong><span>' + item[1] + '</span></div>'
      ).join("");

      const characters = data.characters || [];
      const nameCounts = new Map();
      characters.forEach(character => {
        const key = normalizeName(character.name);
        nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
      });
      const duplicateNames = new Set(
        Array.from(nameCounts.entries()).filter(entry => entry[1] > 1).map(entry => entry[0])
      );
      renderAssetList(assetsCharacters, characters, "Nenhum personagem associado a este usuário.", character => {
        const isDuplicate = duplicateNames.has(normalizeName(character.name));
        const inventory = (character.inventoryItems || []).map(item =>
          escapeHtml(item.name) + " ×" + Number(item.qty || 0)
        ).join(", ");
        const legacyInventory = (character.legacyInventory || []).map(item =>
          escapeHtml(item.name || item.label || "item") + " ×" + Number(item.qty || item.quantity || 0)
        ).join(", ");
        const effects = (character.statusEffects || []).map(effect =>
          escapeHtml(effect.name || effect.label || effect.title || "efeito")
        ).join(", ");
        const bars = (character.bars || []).map(bar =>
          escapeHtml(bar.name || bar.label || "barra") + " " + Number(bar.current ?? bar.value ?? 0) +
          "/" + Number(bar.max ?? bar.maximum ?? 0)
        ).join(", ");
        const stats = (character.stats || []).map(stat => {
          let value = stat.type === "bar"
            ? Number(stat.valueCurrent ?? 0) + "/" + Number(stat.valueMax ?? 0)
            : stat.type === "checkbox"
              ? (stat.valueBool ? "sim" : "não")
              : (stat.valueText !== "" ? stat.valueText : (stat.valueCurrent ?? "—"));
          return escapeHtml(stat.name) + ": " + escapeHtml(value);
        }).join(" · ");
        const duplicateTag = isDuplicate
          ? '<span class="tag admin-duplicate-tag">possível duplicado</span>'
          : "";
        return '<div class="admin-asset-row">' +
          '<div class="asset-main">' +
            '<div class="asset-title">#' + Number(character.id) + ' · ' + escapeHtml(character.name) + ' ' + duplicateTag + '</div>' +
            '<div class="asset-meta">Nível ' + Number(character.level || 1) +
              ' · XP ' + Number(character.xp || 0) +
              ' · ' + Number(character.statsCount || 0) + ' status' +
              ' · ' + Number(character.inventoryItemsCount || 0) + ' itens' +
              ' · ' + Number((character.statusEffects || []).length) + ' efeitos' +
              ' · atualizado em ' + formatDate(character.updatedAt) + '</div>' +
            (inventory ? '<div class="asset-meta">Inventário: ' + inventory + '</div>' : "") +
            (!inventory && legacyInventory ? '<div class="asset-meta">Inventário: ' + legacyInventory + '</div>' : "") +
            (bars ? '<div class="asset-meta">Barras: ' + bars + '</div>' : "") +
            (effects ? '<div class="asset-meta">Efeitos: ' + effects + '</div>' : "") +
            (stats ? '<div class="asset-meta">Status: ' + stats + '</div>' : "") +
          '</div>' +
          '<div class="spacer"></div>' +
          '<a class="btn btn-sm" href="/criar-personagem?id=' + encodeURIComponent(character.id) + '">Editar ficha</a>' +
          '<button class="btn btn-sm btn-danger" data-delete-character="' + Number(character.id) + '">' +
            (isDuplicate ? "Excluir duplicado" : "Excluir ficha") +
          '</button>' +
        '</div>';
      });
      assetsCharacters.querySelectorAll("button[data-delete-character]").forEach(button => {
        button.addEventListener("click", () => deleteCharacterFromAssets(Number(button.dataset.deleteCharacter), characters));
      });

      const pages = data.pages || [];
      renderAssetList(assetsPages, pages, "Nenhuma página criada por este usuário.", page =>
        '<div class="admin-asset-row">' +
          '<div class="asset-main"><div class="asset-title">' + escapeHtml(page.title) + '</div>' +
          '<div class="asset-meta">' + escapeHtml(page.category) + ' · atualizado em ' + formatDate(page.updatedAt) + '</div></div>' +
          '<div class="spacer"></div>' +
          '<a class="btn btn-sm" href="/wiki/pagina?slug=' + encodeURIComponent(page.slug) + '">Abrir</a>' +
        '</div>'
      );

      const chronicles = data.chronicles || [];
      renderAssetList(assetsChronicles, chronicles, "Nenhuma crônica relacionada a este usuário.", chronicle =>
        '<div class="admin-asset-row">' +
          '<div class="asset-main"><div class="asset-title">' + escapeHtml(chronicle.title) + '</div>' +
          '<div class="asset-meta">' + escapeHtml(chronicle.characterName) + ' · criada por ' +
            escapeHtml(chronicle.createdByUsername) + ' · ' + formatDate(chronicle.updatedAt) + '</div></div>' +
          '<div class="spacer"></div>' +
          '<a class="btn btn-sm" href="/cronicas?characterId=' + encodeURIComponent(chronicle.characterId) + '">Abrir</a>' +
        '</div>'
      );

      const otherRows = [];
      (data.rooms || []).forEach(room => otherRows.push(
        '<div class="admin-asset-row"><div class="asset-main"><div class="asset-title">🎲 ' +
          escapeHtml(room.name || "Sala " + room.code) + '</div><div class="asset-meta">código ' +
          escapeHtml(room.code) + ' · ' + (room.isActive ? "ativa" : "encerrada") + '</div></div></div>'
      ));
      (data.dicePresets || []).forEach(preset => otherRows.push(
        '<div class="admin-asset-row"><div class="asset-main"><div class="asset-title">🎲 ' +
          escapeHtml(preset.label) + '</div><div class="asset-meta">' + escapeHtml(preset.formula) +
          (preset.isPublic ? " · público" : " · privado") + '</div></div></div>'
      ));
      (data.statTemplates || []).forEach(template => otherRows.push(
        '<div class="admin-asset-row"><div class="asset-main"><div class="asset-title">📊 ' +
          escapeHtml(template.name) + '</div><div class="asset-meta">' + escapeHtml(template.type) +
          ' · máximo padrão ' + escapeHtml(template.defaultMax) + (template.active ? " · ativo" : " · inativo") +
          '</div></div></div>'
      ));
      renderAssetList(assetsOther, otherRows, "Nenhuma sala, preset ou status criado por este usuário.", row => row);
    } catch (e) {
      assetsAlert.innerHTML = '<div class="alert alert-error">' + escapeHtml(e.message) + '</div>';
      assetsSubtitle.textContent = "Não foi possível carregar o conteúdo.";
    }
  }

  async function deleteCharacterFromAssets(id, characters) {
    const character = characters.find(item => Number(item.id) === id);
    if (!character) return;
    const confirmName = window.prompt(
      'Para excluir "' + character.name + '", digite o nome exato do personagem:'
    );
    if (confirmName === null) return;
    if (confirmName.trim() !== character.name) {
      assetsAlert.innerHTML = '<div class="alert alert-error">O nome digitado não confere. A ficha não foi excluída.</div>';
      return;
    }
    try {
      await window.api.del("/api/admin/characters/" + encodeURIComponent(id), { confirmName: confirmName.trim() });
      showAlert("success", 'Personagem "' + character.name + '" excluído.');
      await openAssetsModal(assetsUserId);
      loadUsers();
      loadAudit();
    } catch (e) {
      assetsAlert.innerHTML = '<div class="alert alert-error">' + escapeHtml(e.message) + '</div>';
    }
  }

  document.getElementById("assets-close").addEventListener("click", () => {
    assetsModal.classList.add("hidden");
    assetsModal.style.display = "";
    assetsUserId = null;
  });

  // ---- Boot ----
  loadUsers();
  loadAudit();
})();
