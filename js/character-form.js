// frontend/js/character-form.js — wizard de criação/edição de personagem
//
// BUG CORRIGIDO: na edição, os valores atuais dos stats agora são
// pré-preenchidos corretamente. Antes, o coletor de stats só pegava
// avulsos e customizados, ignorando os valores dos stats de rule sets.
// Agora, TODOS os stats existentes são carregados com seus valores atuais.
//
// NOVO: stats do tipo 'formula' mostram campo de fórmula editável e
// valor calculado em tempo real.

(function () {
  let allTemplates = [];
  let allRuleSets = [];
  let selectedRuleSetIds = new Set();
  let existingStats = []; // stats já salvos no banco (modo edição)
  let selectedTemplates = {};
  let customStats = [];
  let inventory = [];
  let photoUrl = null;
  let pageId = null;
  let characterName = "";

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  async function loadTemplates() {
    try {
      const [tplData, rsData] = await Promise.all([
        window.api.get("/api/stat-templates"),
        window.api.get("/api/rule-sets"),
      ]);
      allTemplates = tplData.templates || [];
      allRuleSets = rsData.ruleSets || [];
    } catch { allTemplates = []; allRuleSets = []; }
  }

  function templateIdsFromSelectedSets() {
    const ids = new Set();
    allRuleSets.forEach(rs => {
      if (selectedRuleSetIds.has(rs.id)) rs.stats.forEach(s => ids.add(s.id));
    });
    return ids;
  }

  function renderStep(step) {
    const container = document.getElementById("wizard-step");
    let html = "";
    switch (step) {
      case 1:
        html = `
          <h2>1. Identidade</h2>
          <p class="muted text-sm mb-4">Nome e foto do seu personagem.</p>
          <div class="field">
            <label>Nome do personagem *</label>
            <input type="text" id="f-name" value="${escapeHtml(characterName)}" maxlength="100">
          </div>
          <div class="field">
            <label>Foto (opcional)</label>
            <div class="flex items-center gap-3">
              <div id="photo-preview" style="width:80px;height:80px;border-radius:8px;background:var(--surface);display:grid;place-items:center;font-size:24px;color:var(--text-muted);overflow:hidden">
                ${photoUrl ? `<img src="${escapeHtml(photoUrl)}" style="width:100%;height:100%;object-fit:cover">` : "👤"}
              </div>
              <input type="file" id="f-photo" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden">
              <button type="button" class="btn" id="btn-upload-photo">📷 Escolher foto</button>
              ${photoUrl ? `<button type="button" class="btn btn-ghost" id="btn-remove-photo">Remover</button>` : ""}
            </div>
          </div>
        `;
        break;
      case 2:
        html = `
          <h2>2. Vínculo com a wiki (opcional)</h2>
          <div class="field">
            <label>Página de lore vinculada</label>
            <select id="f-page"><option value="">— sem vínculo —</option></select>
          </div>
        `;
        break;
      case 3:
        html = `
          <h2>3. Sets de Regras *</h2>
          <p class="muted text-sm mb-4">Escolha pelo menos 1 set. Os status do set são aplicados automaticamente.</p>
          ${allRuleSets.filter(rs => rs.active).map(rs => `
            <div class="card mb-2" style="padding:12px;${selectedRuleSetIds.has(rs.id) ? 'border-color:var(--accent)' : ''}">
              <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
                <input type="checkbox" data-ruleset-id="${rs.id}" ${selectedRuleSetIds.has(rs.id) ? "checked" : ""} style="margin-top:4px">
                <div>
                  <strong>${escapeHtml(rs.name)}</strong>
                  <div class="text-xs muted">Inclui: ${rs.stats.map(s => escapeHtml(s.name)).join(", ") || "—"}</div>
                </div>
              </label>
            </div>
          `).join("")}
        `;
        break;
      case 4: {
        // Se editando, mostra TODOS os stats existentes com valores atuais
        // Se criando, mostra apenas avulsos (fora de sets)
        const isEditing = existingStats.length > 0;
        if (isEditing) {
          html = `<h2>4. Status atuais do personagem</h2>
            <p class="muted text-sm mb-4">Valores atuais carregados do banco. Edite conforme necessário. Stats de formula 🔒 são calculados automaticamente.</p>`;
          existingStats.forEach((s, i) => {
            html += renderExistingStatEditor(s, i);
          });
        } else {
          const fromSets = templateIdsFromSelectedSets();
          const available = allTemplates.filter(t => !fromSets.has(t.id));
          html = `<h2>4. Status base (avulsos)</h2>
            <p class="muted text-sm mb-4">Status que não vieram dos sets escolhidos.</p>`;
          if (available.length === 0) {
            html += `<div class="alert alert-info">Todos os status base já foram incluídos pelos sets.</div>`;
          } else {
            available.forEach(t => {
              html += `
                <div class="card mb-2" style="padding:12px">
                  <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                    <input type="checkbox" data-template-id="${t.id}" ${selectedTemplates[t.id] ? "checked" : ""}>
                    <strong>${escapeHtml(t.name)}</strong>
                    <span class="tag" style="font-size:10px">${escapeHtml(t.type)}</span>
                  </label>
                  <div class="template-fields" data-template-id="${t.id}" style="display:${selectedTemplates[t.id] ? "block" : "none"};margin-top:8px;padding-left:24px">
                    ${renderTemplateFields(t, selectedTemplates[t.id] || {})}
                  </div>
                </div>`;
            });
          }
        }
        break;
      }
      case 5:
        html = `<h2>5. Status customizados</h2>
          <p class="muted text-sm mb-4">Crie status exclusivos. Tipo "formula" calcula valor a partir de outros status: ex: <code>{"Constituição"} * 2 + 10</code></p>
          <button type="button" class="btn btn-sm btn-primary mb-4" id="btn-add-custom">+ Adicionar</button>
          <div id="custom-list">
            ${customStats.map((s, i) => renderCustomStatEditor(s, i)).join("")}
          </div>`;
        break;
      case 6:
        html = `<h2>6. Inventário inicial</h2>
          <p class="muted text-sm mb-4">Marque "equipado" para itens em uso.</p>
          <button type="button" class="btn btn-sm btn-primary mb-4" id="btn-add-item">+ Adicionar item</button>
          <div id="inv-list">
            ${inventory.map((it, i) => `
              <div class="card mb-2" style="padding:12px" data-inv-idx="${i}">
                <div class="flex gap-2 mb-2 items-center">
                  <input type="text" placeholder="Nome" value="${escapeHtml(it.name)}" data-inv-field="name" style="flex:1">
                  <input type="number" placeholder="Qtd" value="${it.qty}" data-inv-field="qty" min="1" style="width:80px">
                  <label class="text-xs muted"><input type="checkbox" data-inv-field="equipped" ${it.equipped ? "checked" : ""}> equipado</label>
                  <button type="button" class="btn btn-sm btn-danger" data-remove-inv="${i}">🗑</button>
                </div>
                <input type="text" placeholder="Descrição" value="${escapeHtml(it.description || "")}" data-inv-field="description" style="width:100%">
              </div>`).join("")}
          </div>`;
        break;
      case 7: {
        // Preview
        const allStatsForPreview = isEditingMode() ? existingStats : [...collectSetStats(), ...collectAvulsoStats(), ...customStats.map(s => ({ ...s, isCustom: true }))];
        const previewCh = { id: 0, name: characterName || "(sem nome)", ownerUsername: "você", photoUrl, pageId, stats: allStatsForPreview, inventory, statusEffects: [] };
        html = `<h2>7. Revisão final</h2>
          <div id="preview-container"></div>`;
        setTimeout(() => {
          const c = document.getElementById("preview-container");
          if (c && window.characterRender) c.innerHTML = window.characterRender.renderCharacterCard(previewCh, { editable: false, showActions: false });
        }, 50);
        break;
      }
    }
    container.innerHTML = html;
    bindStepEvents(step);
  }

  function isEditingMode() { return existingStats.length > 0; }

  // Render de um stat existente (modo edição) — PRÉ-PREENCHIDO com valores do banco
  function renderExistingStatEditor(s, i) {
    const isFormula = s.type === "formula";
    const locked = isFormula ? `<span class="tag" style="background:rgba(167,139,250,0.15);color:var(--accent-hover);font-size:10px">🔒 calculado</span>` : "";
    let valueField = "";
    switch (s.type) {
      case "bar":
        valueField = `<div class="flex gap-2">
          <input type="number" placeholder="Atual" value="${s.valueCurrent ?? 0}" data-stat-idx="${i}" data-stat-field="valueCurrent" style="width:120px">
          <span style="align-self:center">/</span>
          <input type="number" placeholder="Máximo" value="${s.valueMax ?? 0}" data-stat-idx="${i}" data-stat-field="valueMax" style="width:120px">
        </div>`;
        break;
      case "number":
        valueField = `<input type="number" value="${s.valueCurrent ?? 0}" data-stat-idx="${i}" data-stat-field="valueCurrent" style="width:200px">`;
        break;
      case "text":
        valueField = `<textarea data-stat-idx="${i}" data-stat-field="valueText" style="width:100%;min-height:60px">${escapeHtml(s.valueText || "")}</textarea>`;
        break;
      case "tag_list":
        valueField = `<input type="text" value="${escapeHtml(s.valueText || "")}" data-stat-idx="${i}" data-stat-field="valueText" style="width:100%">`;
        break;
      case "checkbox":
        valueField = `<label><input type="checkbox" data-stat-idx="${i}" data-stat-field="valueBool" ${s.valueBool ? "checked" : ""}> Ativado</label>`;
        break;
      case "formula":
        // Fórmula: campo editável para a expressão + valor calculado (somente leitura)
        valueField = `
          <input type="text" value="${escapeHtml(s.valueText || "")}" data-stat-idx="${i}" data-stat-field="valueText" placeholder="ex: {Constituição} * 2 + 10" style="width:100%;font-family:var(--font-mono)">
          <div class="text-sm muted mt-1">Valor calculado: <strong style="color:var(--accent-hover)">${s.valueCurrent ?? "—"}</strong></div>`;
        break;
    }
    return `
      <div class="card mb-2" style="padding:12px" data-stat-idx="${i}">
        <div class="flex gap-2 mb-2 items-center">
          <strong>${escapeHtml(s.name)}</strong>
          <span class="tag" style="font-size:10px">${escapeHtml(s.type)}</span>
          ${locked}
          ${s.isCustom ? `<span class="tag" style="font-size:10px">★ custom</span>` : ""}
        </div>
        ${valueField}
      </div>`;
  }

  function renderTemplateFields(t, vals) {
    switch (t.type) {
      case "bar": return `<div class="flex gap-2"><input type="number" placeholder="Atual" value="${vals.valueCurrent ?? t.defaultMax ?? 0}" data-tpl-field="valueCurrent" style="width:120px"><span style="align-self:center">/</span><input type="number" placeholder="Máximo" value="${vals.valueMax ?? t.defaultMax ?? 0}" data-tpl-field="valueMax" style="width:120px"></div>`;
      case "number": return `<input type="number" value="${vals.valueCurrent ?? 0}" data-tpl-field="valueCurrent" style="width:200px">`;
      case "text": return `<textarea data-tpl-field="valueText" style="width:100%;min-height:60px">${escapeHtml(vals.valueText || "")}</textarea>`;
      case "tag_list": return `<input type="text" value="${escapeHtml(vals.valueText || "")}" data-tpl-field="valueText" style="width:100%">`;
      case "checkbox": return `<label><input type="checkbox" ${vals.valueBool ? "checked" : ""} data-tpl-field="valueBool"> Ativado</label>`;
      case "formula": return `<input type="text" value="${escapeHtml(vals.valueText || "")}" data-tpl-field="valueText" placeholder="ex: {Constituição} * 2 + 10" style="width:100%;font-family:var(--font-mono)">`;
      default: return "";
    }
  }

  function renderCustomStatEditor(s, i) {
    return `<div class="card mb-2" style="padding:12px" data-custom-idx="${i}">
      <div class="flex gap-2 mb-2">
        <input type="text" placeholder="Nome" value="${escapeHtml(s.name)}" data-field="name" style="flex:1">
        <select data-field="type" style="width:140px">
          <option value="bar" ${s.type === "bar" ? "selected" : ""}>Bar</option>
          <option value="number" ${s.type === "number" ? "selected" : ""}>Número</option>
          <option value="text" ${s.type === "text" ? "selected" : ""}>Texto</option>
          <option value="tag_list" ${s.type === "tag_list" ? "selected" : ""}>Tags</option>
          <option value="checkbox" ${s.type === "checkbox" ? "selected" : ""}>Checkbox</option>
          <option value="formula" ${s.type === "formula" ? "selected" : ""}>Fórmula</option>
        </select>
        <button type="button" class="btn btn-sm btn-danger" data-remove-custom="${i}">🗑</button>
      </div>
      ${renderCustomFields(s)}
    </div>`;
  }

  function renderCustomFields(s) {
    switch (s.type) {
      case "bar": return `<div class="flex gap-2"><input type="number" placeholder="Atual" value="${s.valueCurrent ?? 0}" data-field="valueCurrent" style="width:120px"><span style="align-self:center">/</span><input type="number" placeholder="Máximo" value="${s.valueMax ?? 0}" data-field="valueMax" style="width:120px"></div>`;
      case "number": return `<input type="number" value="${s.valueCurrent ?? 0}" data-field="valueCurrent" style="width:200px">`;
      case "text": return `<textarea data-field="valueText" style="width:100%;min-height:60px">${escapeHtml(s.valueText || "")}</textarea>`;
      case "tag_list": return `<input type="text" value="${escapeHtml(s.valueText || "")}" data-field="valueText" style="width:100%">`;
      case "checkbox": return `<label><input type="checkbox" ${s.valueBool ? "checked" : ""} data-field="valueBool"> Ativado</label>`;
      case "formula": return `<input type="text" value="${escapeHtml(s.valueText || "")}" data-field="valueText" placeholder="ex: {Constituição} * 2 + 10" style="width:100%;font-family:var(--font-mono)"><div class="text-xs muted mt-1">Use {"Nome do Status"} pra referenciar outro status.</div>`;
      default: return "";
    }
  }

  function bindStepEvents(step) {
    if (step === 1) {
      const nameInput = document.getElementById("f-name");
      nameInput.addEventListener("input", () => { characterName = nameInput.value; });
      const fileInput = document.getElementById("f-photo");
      document.getElementById("btn-upload-photo").addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const allowedTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
        if (!allowedTypes.has(file.type)) { alert("Tipo não permitido."); fileInput.value = ""; return; }
        if (file.size > 5 * 1024 * 1024) { alert("Máximo 5 MB."); fileInput.value = ""; return; }
        if (window.PhotoCropper) {
          const cropper = new window.PhotoCropper({ maxSize: 5 * 1024 * 1024 });
          cropper.open(file, async (blob) => {
            const fd = new FormData();
            fd.append("file", blob, `avatar-${Date.now()}.png`);
            try { const res = await window.api.postForm("/api/upload", fd); if (res.url) { photoUrl = res.url; renderStep(1); } else { alert(res.warning || "Upload falhou"); } }
            catch (e) { alert(e.message); }
          });
        } else {
          const fd = new FormData(); fd.append("file", file);
          try { const res = await window.api.postForm("/api/upload", fd); if (res.url) { photoUrl = res.url; renderStep(1); } } catch (e) { alert(e.message); }
        }
        fileInput.value = "";
      });
      const rmBtn = document.getElementById("btn-remove-photo");
      if (rmBtn) rmBtn.addEventListener("click", () => { photoUrl = null; renderStep(1); });
    }
    if (step === 2) {
      const sel = document.getElementById("f-page");
      window.api.get("/api/pages?category=Personagens").then(data => {
        (data.pages || []).forEach(p => { const opt = document.createElement("option"); opt.value = p.id; opt.textContent = p.title; if (p.id === pageId) opt.selected = true; sel.appendChild(opt); });
      }).catch(() => {});
      sel.addEventListener("change", () => { pageId = sel.value ? Number(sel.value) : null; });
    }
    if (step === 3) {
      document.querySelectorAll('input[data-ruleset-id]').forEach(cb => {
        cb.addEventListener("change", () => {
          const id = Number(cb.dataset.rulesetId);
          if (cb.checked) selectedRuleSetIds.add(id); else selectedRuleSetIds.delete(id);
          renderStep(3);
        });
      });
    }
    if (step === 4) {
      if (isEditingMode()) {
        // Modo edição: atualiza valores dos stats existentes
        document.querySelectorAll('[data-stat-idx][data-stat-field]').forEach(inp => {
          inp.addEventListener("input", () => {
            const idx = Number(inp.dataset.statIdx);
            const field = inp.dataset.statField;
            if (inp.type === "checkbox") existingStats[idx][field] = inp.checked;
            else if (inp.type === "number") existingStats[idx][field] = inp.value === "" ? null : Number(inp.value);
            else existingStats[idx][field] = inp.value;
          });
        });
      } else {
        // Modo criação: avulsos
        document.querySelectorAll('input[data-template-id]').forEach(cb => {
          cb.addEventListener("change", () => {
            const id = Number(cb.dataset.templateId);
            if (cb.checked) selectedTemplates[id] = selectedTemplates[id] || {}; else delete selectedTemplates[id];
            renderStep(4);
          });
        });
        document.querySelectorAll('[data-tpl-field]').forEach(inp => {
          inp.addEventListener("input", () => {
            const card = inp.closest(".card");
            const tid = Number(card.querySelector("input[type=checkbox]").dataset.templateId);
            if (!selectedTemplates[tid]) selectedTemplates[tid] = {};
            const field = inp.dataset.tplField;
            if (inp.type === "checkbox") selectedTemplates[tid][field] = inp.checked;
            else if (inp.type === "number") selectedTemplates[tid][field] = inp.value === "" ? null : Number(inp.value);
            else selectedTemplates[tid][field] = inp.value;
          });
        });
      }
    }
    if (step === 5) {
      document.getElementById("btn-add-custom").addEventListener("click", () => { customStats.push({ name: "", type: "bar", valueCurrent: 0, valueMax: 0, valueText: "", valueBool: false }); renderStep(5); });
      document.querySelectorAll('[data-remove-custom]').forEach(b => { b.addEventListener("click", () => { customStats.splice(Number(b.dataset.removeCustom), 1); renderStep(5); }); });
      document.querySelectorAll("[data-custom-idx] [data-field]").forEach(inp => {
        inp.addEventListener("input", () => {
          const card = inp.closest("[data-custom-idx]");
          const idx = Number(card.dataset.customIdx);
          const field = inp.dataset.field;
          if (inp.type === "checkbox") customStats[idx][field] = inp.checked;
          else if (inp.type === "number") customStats[idx][field] = inp.value === "" ? null : Number(inp.value);
          else if (field === "type") { customStats[idx].type = inp.value; renderStep(5); }
          else customStats[idx][field] = inp.value;
        });
      });
    }
    if (step === 6) {
      document.getElementById("btn-add-item").addEventListener("click", () => { inventory.push({ name: "", qty: 1, description: "", equipped: false }); renderStep(6); });
      document.querySelectorAll('[data-remove-inv]').forEach(b => { b.addEventListener("click", () => { inventory.splice(Number(b.dataset.removeInv), 1); renderStep(6); }); });
      document.querySelectorAll("[data-inv-idx] [data-inv-field]").forEach(inp => {
        const update = () => { const card = inp.closest("[data-inv-idx]"); const idx = Number(card.dataset.invIdx); const field = inp.dataset.invField; if (inp.type === "checkbox") inventory[idx][field] = inp.checked; else if (inp.type === "number") inventory[idx][field] = Number(inp.value); else inventory[idx][field] = inp.value; };
        inp.addEventListener("input", update); inp.addEventListener("change", update);
      });
    }
  }

  function collectSetStats() {
    const stats = [];
    allRuleSets.forEach(rs => { if (selectedRuleSetIds.has(rs.id)) rs.stats.forEach(s => stats.push({ statTemplateId: s.id, isCustom: false, name: s.name, type: s.type, valueCurrent: s.defaultMax, valueMax: s.defaultMax, color: s.color, displayOrder: 0 })); });
    return stats;
  }
  function collectAvulsoStats() {
    const stats = [];
    allTemplates.forEach(t => { if (selectedTemplates[t.id]) stats.push({ statTemplateId: t.id, isCustom: false, name: t.name, type: t.type, valueCurrent: selectedTemplates[t.id].valueCurrent ?? t.defaultMax ?? 0, valueMax: selectedTemplates[t.id].valueMax ?? t.defaultMax ?? 0, valueText: selectedTemplates[t.id].valueText, valueBool: selectedTemplates[t.id].valueBool, color: t.color, displayOrder: 0 }); });
    return stats;
  }

  // Coleta stats para enviar no PUT (modo edição)
  // Envia TODOS os stats existentes com seus valores atuais (incluindo os de rule sets)
  function collectExistingStatsForUpdate() {
    return existingStats.map(s => ({
      id: s.id, // inclui ID pra o backend fazer UPSERT ao invés de INSERT
      statTemplateId: s.statTemplateId,
      isCustom: s.isCustom,
      name: s.name, type: s.type,
      valueCurrent: s.valueCurrent, valueMax: s.valueMax,
      valueText: s.valueText, valueBool: s.valueBool,
      color: s.color, displayOrder: s.displayOrder,
    }));
  }

  window.characterForm = {
    async init(editingCharacterId) {
      await loadTemplates();
      if (editingCharacterId) {
        try {
          const ch = await window.api.get(`/api/characters/${editingCharacterId}`);
          characterName = ch.name; photoUrl = ch.photoUrl; pageId = ch.pageId;
          inventory = (ch.inventory || []).map(it => ({ ...it, equipped: !!it.equipped }));
          // CARREGA TODOS os stats existentes com seus valores atuais
          existingStats = (ch.stats || []).map(s => ({ ...s }));
        } catch (e) { alert("Erro ao carregar personagem: " + e.message); }
      }
    },
    renderStep,
    getName: () => characterName,
    getPhotoUrl: () => photoUrl,
    getPageId: () => pageId,
    getInventory: () => inventory,
    getRuleSetIds: () => Array.from(selectedRuleSetIds),
    hasSelectedRuleSet: () => selectedRuleSetIds.size > 0,
    isEditing: () => isEditingMode(),
    save: async (editingCharacterId) => {
      const payload = { name: characterName, photoUrl, pageId, inventory };
      if (editingCharacterId) {
        // MODO EDIÇÃO: envia TODOS os stats existentes com ID (UPSERT, não DELETE)
        payload.stats = collectExistingStatsForUpdate();
        // Adiciona customizados novos
        customStats.forEach(s => { if (s.name && s.name.trim()) payload.stats.push({ ...s, name: s.name.trim(), isCustom: true }); });
      } else {
        // MODO CRIAÇÃO: envia ruleSetIds + avulsos + customizados
        payload.ruleSetIds = Array.from(selectedRuleSetIds);
        payload.stats = [...collectAvulsoStats(), ...customStats.filter(s => s.name && s.name.trim()).map(s => ({ ...s, name: s.name.trim(), isCustom: true }))];
      }
      if (editingCharacterId) {
        await window.api.put(`/api/characters/${editingCharacterId}`, payload);
        return editingCharacterId;
      } else {
        const res = await window.api.post("/api/characters", payload);
        return res.id;
      }
    },
  };
})();
