// frontend/js/admin.js — lógica do painel administrativo

(function () {
  window.auth.mountHeader("#header-mount");
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
  const emPassword = document.getElementById("em-password");
  const emSave = document.getElementById("em-save");
  const emCancel = document.getElementById("em-cancel");
  let editingId = null;

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
          ${!isDeleted ? `<button class="btn btn-sm" data-edit="${u.id}">Editar</button>` : ""}
          ${!isDeleted && !isSelf ? `<button class="btn btn-sm btn-danger" data-del="${u.id}">Excluir</button>` : ""}
        </div>
      `;
      }).join("");

      // bind editar
      usersListEl.querySelectorAll('button[data-edit]').forEach(b => {
        b.addEventListener("click", () => openEditModal(Number(b.dataset.edit)));
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

  // ---- Boot ----
  loadUsers();
  loadAudit();
})();
