// frontend/js/character-form.js — wizard de criação de personagem
//
// Wizard em 6 etapas:
// 1. Identidade (nome + foto)
// 2. Vínculo com wiki (opcional)
// 3. Status base (seleciona dos stat_templates ativos)
// 4. Status customizados (cria do zero)
// 5. Inventário inicial
// 6. Revisão final + salvar

(function () {
  let allTemplates = [];
  let selectedTemplates = {};  // templateId -> { ...values }
  let customStats = [];         // array de { name, type, ...values }
  let inventory = [];
  let photoUrl = null;
  let pageId = null;
  let characterName = "";

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  // Carrega templates ativos da campanha
  async function loadTemplates() {
    try {
      const data = await window.api.get("/api/stat-templates");
      allTemplates = data.templates || [];
    } catch (e) {
      allTemplates = [];
    }
  }

  // Render da etapa atual
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
              <div id="photo-preview" style="width:80px;height:80px;border-radius:50%;background:var(--surface);display:grid;place-items:center;font-size:24px;color:var(--text-muted);overflow:hidden">
                ${photoUrl ? `<img src="${escapeHtml(photoUrl)}" style="width:100%;height:100%;object-fit:cover">` : "👤"}
              </div>
              <input type="file" id="f-photo" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden">
              <button type="button" class="btn" id="btn-upload-photo">📷 Escolher foto</button>
              ${photoUrl ? `<button type="button" class="btn btn-ghost" id="btn-remove-photo">Remover</button>` : ""}
            </div>
            <p class="text-xs muted mt-2">PNG, JPEG, WebP ou GIF. Máx 5 MB.</p>
          </div>
        `;
        break;
      case 2:
        html = `
          <h2>2. Vínculo com a wiki (opcional)</h2>
          <p class="muted text-sm mb-4">Se já existe uma página de lore/biografia para este personagem, vincule-a aqui.</p>
          <div class="field">
            <label>Página de lore vinculada</label>
            <select id="f-page">
              <option value="">— sem vínculo —</option>
            </select>
          </div>
          <p class="text-xs muted">Você pode criar a página de lore depois e voltar pra vincular.</p>
        `;
        break;
      case 3:
        html = `
          <h2>3. Status base da campanha</h2>
          <p class="muted text-sm mb-4">Marque quais status da campanha se aplicam a este personagem e defina os valores iniciais.</p>
          ${allTemplates.length === 0
            ? `<div class="alert alert-info">Nenhum status base definido pelo mestre ainda. Peça ao mestre para configurar em "Status base" — ou pule esta etapa e use apenas status customizados.</div>`
            : allTemplates.map(t => `
              <div class="card mb-2" style="padding:12px">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input type="checkbox" data-template-id="${t.id}" ${selectedTemplates[t.id] ? "checked" : ""}>
                  <strong>${escapeHtml(t.name)}</strong>
                  <span class="tag" style="font-size:10px">${escapeHtml(t.type)}</span>
                  ${t.description ? `<span class="text-xs muted">${escapeHtml(t.description)}</span>` : ""}
                </label>
                <div class="template-fields" data-template-id="${t.id}" style="display:${selectedTemplates[t.id] ? "block" : "none"};margin-top:8px;padding-left:24px">
                  ${renderTemplateFields(t, selectedTemplates[t.id] || {})}
                </div>
              </div>
            `).join("")}
        `;
        break;
      case 4:
        html = `
          <h2>4. Status customizados</h2>
          <p class="muted text-sm mb-4">Crie status exclusivos deste personagem (inventados por você). Quantos quiser.</p>
          <button type="button" class="btn btn-sm btn-primary mb-4" id="btn-add-custom">+ Adicionar status customizado</button>
          <div id="custom-list">
            ${customStats.length === 0 ? `<div class="muted text-sm">Nenhum status customizado ainda.</div>` : ""}
            ${customStats.map((s, i) => `
              <div class="card mb-2" style="padding:12px" data-custom-idx="${i}">
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
                ${renderCustomFields(s, i)}
              </div>
            `).join("")}
          </div>
        `;
        break;
      case 5:
        html = `
          <h2>5. Inventário inicial</h2>
          <p class="muted text-sm mb-4">Itens que o personagem começa com.</p>
          <button type="button" class="btn btn-sm btn-primary mb-4" id="btn-add-item">+ Adicionar item</button>
          <div id="inv-list">
            ${inventory.length === 0 ? `<div class="muted text-sm">Sem itens ainda.</div>` : ""}
            ${inventory.map((it, i) => `
              <div class="card mb-2" style="padding:12px" data-inv-idx="${i}">
                <div class="flex gap-2 mb-2">
                  <input type="text" placeholder="Nome do item" value="${escapeHtml(it.name)}" data-inv-field="name" style="flex:1">
                  <input type="number" placeholder="Qtd" value="${it.qty}" data-inv-field="qty" min="1" style="width:80px">
                  <button type="button" class="btn btn-sm btn-danger" data-remove-inv="${i}">🗑</button>
                </div>
                <input type="text" placeholder="Descrição (opcional)" value="${escapeHtml(it.description || "")}" data-inv-field="description" style="width:100%">
              </div>
            `).join("")}
          </div>
        `;
        break;
      case 6: {
        // Constrói um objeto character temporário pra preview
        const stats = [];
        allTemplates.forEach(t => {
          if (selectedTemplates[t.id]) {
            stats.push(buildStatFromTemplate(t, selectedTemplates[t.id]));
          }
        });
        stats.push(...customStats.map(s => ({ ...s, isCustom: true })));
        const previewCh = {
          id: 0,
          name: characterName || "(sem nome)",
          ownerUsername: "você",
          photoUrl,
          pageId,
          stats,
          inventory,
          statusEffects: [],
        };
        html = `
          <h2>6. Revisão final</h2>
          <p class="muted text-sm mb-4">Confira como a ficha vai ficar antes de salvar.</p>
          <div id="preview-container"></div>
        `;
        setTimeout(() => {
          const c = document.getElementById("preview-container");
          if (c && window.characterRender) {
            c.innerHTML = window.characterRender.renderCharacterCard(previewCh, { editable: false, showActions: false });
          }
        }, 50);
        break;
      }
    }
    container.innerHTML = html;
    bindStepEvents(step);
  }

  function renderTemplateFields(t, vals) {
    switch (t.type) {
      case "bar":
        return `
          <div class="flex gap-2">
            <input type="number" placeholder="Atual" value="${vals.valueCurrent ?? t.default_max ?? 0}" data-tpl-field="valueCurrent" style="width:120px">
            <span style="align-self:center">/</span>
            <input type="number" placeholder="Máximo" value="${vals.valueMax ?? t.default_max ?? 0}" data-tpl-field="valueMax" style="width:120px">
          </div>`;
      case "number":
        return `<input type="number" placeholder="Valor" value="${vals.valueCurrent ?? 0}" data-tpl-field="valueCurrent" style="width:200px">`;
      case "text":
        return `<textarea placeholder="Texto livre" data-tpl-field="valueText" style="width:100%;min-height:60px">${escapeHtml(vals.valueText || "")}</textarea>`;
      case "tag_list":
        return `<input type="text" placeholder="tags separadas por vírgula" value="${escapeHtml(vals.valueText || "")}" data-tpl-field="valueText" style="width:100%">`;
      case "checkbox":
        return `<label><input type="checkbox" ${vals.valueBool ? "checked" : ""} data-tpl-field="valueBool"> Ativado</label>`;
      case "formula":
        return `<input type="text" placeholder="ex: 1d20+5" value="${escapeHtml(vals.valueText || "")}" data-tpl-field="valueText" style="width:100%;font-family:var(--font-mono)">`;
      default:
        return "";
    }
  }

  function renderCustomFields(s, idx) {
    switch (s.type) {
      case "bar":
        return `<div class="flex gap-2"><input type="number" placeholder="Atual" value="${s.valueCurrent ?? 0}" data-field="valueCurrent" style="width:120px"><span style="align-self:center">/</span><input type="number" placeholder="Máximo" value="${s.valueMax ?? 0}" data-field="valueMax" style="width:120px"></div>`;
      case "number":
        return `<input type="number" placeholder="Valor" value="${s.valueCurrent ?? 0}" data-field="valueCurrent" style="width:200px">`;
      case "text":
        return `<textarea placeholder="Texto livre" data-field="valueText" style="width:100%;min-height:60px">${escapeHtml(s.valueText || "")}</textarea>`;
      case "tag_list":
        return `<input type="text" placeholder="tags separadas por vírgula" data-field="valueText" style="width:100%">`;
      case "checkbox":
        return `<label><input type="checkbox" ${s.valueBool ? "checked" : ""} data-field="valueBool"> Ativado</label>`;
      case "formula":
        return `<input type="text" placeholder="ex: 1d20+5" value="${escapeHtml(s.valueText || "")}" data-field="valueText" style="width:100%;font-family:var(--font-mono)">`;
      default:
        return "";
    }
  }

  function buildStatFromTemplate(t, vals) {
    return {
      statTemplateId: t.id,
      isCustom: false,
      name: t.name,
      type: t.type,
      valueCurrent: vals.valueCurrent !== undefined ? Number(vals.valueCurrent) : null,
      valueMax: vals.valueMax !== undefined ? Number(vals.valueMax) : null,
      valueText: vals.valueText || null,
      valueBool: vals.valueBool ? 1 : 0,
      color: t.color,
      displayOrder: 0,
    };
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
        // Validação de tipo/tamanho ANTES de abrir o cropper (não deixamos
        // o usuário recortar um arquivo inválido pra só depois descobrir).
        const allowedTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
        if (!allowedTypes.has(file.type)) {
          alert("Tipo não permitido. Use PNG, JPEG, WebP ou GIF.");
          fileInput.value = "";
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          alert("Arquivo muito grande. Máximo 5 MB.");
          fileInput.value = "";
          return;
        }
        // Abre o modal de recorte quadrado (estilo Discord). O Blob recortado
        // 512x512 é enviado ao backend, NUNCA o arquivo original.
        const cropper = new window.PhotoCropper({ maxSize: 5 * 1024 * 1024 });
        cropper.open(file, async (blob) => {
          const fd = new FormData();
          // Dá um nome amigável pro arquivo recortado
          const ext = file.type.split("/")[1] || "png";
          fd.append("file", blob, `avatar-${Date.now()}.${ext}`);
          try {
            const res = await window.api.postForm("/api/upload", fd);
            if (res.url) {
              photoUrl = res.url;
              renderStep(1);
            } else {
              alert(res.warning || "Upload falhou");
            }
          } catch (e) { alert(e.message); }
        });
        // Limpa o input pra permitir re-escolher o mesmo arquivo
        fileInput.value = "";
      });
      const rmBtn = document.getElementById("btn-remove-photo");
      if (rmBtn) rmBtn.addEventListener("click", () => { photoUrl = null; renderStep(1); });
    }
    if (step === 2) {
      // Carrega páginas categoria Personagens
      const sel = document.getElementById("f-page");
      window.api.get("/api/pages?category=Personagens").then(data => {
        (data.pages || []).forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.id; opt.textContent = p.title;
          if (p.id === pageId) opt.selected = true;
          sel.appendChild(opt);
        });
      }).catch(() => {});
      sel.addEventListener("change", () => { pageId = sel.value ? Number(sel.value) : null; });
    }
    if (step === 3) {
      document.querySelectorAll('input[data-template-id]').forEach(cb => {
        cb.addEventListener("change", () => {
          const id = Number(cb.dataset.templateId);
          if (cb.checked) {
            selectedTemplates[id] = selectedTemplates[id] || {};
          } else {
            delete selectedTemplates[id];
          }
          renderStep(3);
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
    if (step === 4) {
      document.getElementById("btn-add-custom").addEventListener("click", () => {
        customStats.push({ name: "", type: "bar", valueCurrent: 0, valueMax: 0, valueText: "", valueBool: false });
        renderStep(4);
      });
      document.querySelectorAll('[data-remove-custom]').forEach(b => {
        b.addEventListener("click", () => {
          customStats.splice(Number(b.dataset.removeCustom), 1);
          renderStep(4);
        });
      });
      document.querySelectorAll("[data-custom-idx] [data-field]").forEach(inp => {
        inp.addEventListener("input", () => {
          const card = inp.closest("[data-custom-idx]");
          const idx = Number(card.dataset.customIdx);
          const field = inp.dataset.field;
          if (inp.type === "checkbox") customStats[idx][field] = inp.checked;
          else if (inp.type === "number") customStats[idx][field] = inp.value === "" ? null : Number(inp.value);
          else if (field === "type") { customStats[idx].type = inp.value; renderStep(4); }
          else customStats[idx][field] = inp.value;
        });
      });
    }
    if (step === 5) {
      document.getElementById("btn-add-item").addEventListener("click", () => {
        inventory.push({ name: "", qty: 1, description: "" });
        renderStep(5);
      });
      document.querySelectorAll('[data-remove-inv]').forEach(b => {
        b.addEventListener("click", () => {
          inventory.splice(Number(b.dataset.removeInv), 1);
          renderStep(5);
        });
      });
      document.querySelectorAll("[data-inv-idx] [data-inv-field]").forEach(inp => {
        inp.addEventListener("input", () => {
          const card = inp.closest("[data-inv-idx]");
          const idx = Number(card.dataset.invIdx);
          const field = inp.dataset.invField;
          if (inp.type === "number") inventory[idx][field] = Number(inp.value);
          else inventory[idx][field] = inp.value;
        });
      });
    }
  }

  function collectStats() {
    const stats = [];
    allTemplates.forEach(t => {
      if (selectedTemplates[t.id]) {
        stats.push(buildStatFromTemplate(t, selectedTemplates[t.id]));
      }
    });
    customStats.forEach(s => {
      if (s.name && s.name.trim()) {
        stats.push({ ...s, name: s.name.trim(), isCustom: true });
      }
    });
    return stats;
  }

  // API pública do wizard
  window.characterForm = {
    async init(editingCharacterId) {
      await loadTemplates();
      if (editingCharacterId) {
        // Modo edição: carrega personagem existente
        try {
          const ch = await window.api.get(`/api/characters/${editingCharacterId}`);
          characterName = ch.name;
          photoUrl = ch.photoUrl;
          pageId = ch.pageId;
          inventory = ch.inventory || [];
          // Reconstrói selectedTemplates a partir dos stats existentes
          (ch.stats || []).forEach(s => {
            if (s.statTemplateId) {
              selectedTemplates[s.statTemplateId] = {
                valueCurrent: s.valueCurrent,
                valueMax: s.valueMax,
                valueText: s.valueText,
                valueBool: s.valueBool,
              };
            } else {
              customStats.push({ ...s });
            }
          });
        } catch (e) {
          alert("Erro ao carregar personagem: " + e.message);
        }
      }
    },
    renderStep,
    collectStats,
    getName: () => characterName,
    getPhotoUrl: () => photoUrl,
    getPageId: () => pageId,
    getInventory: () => inventory,
    save: async (editingCharacterId) => {
      const payload = {
        name: characterName,
        photoUrl,
        pageId,
        inventory,
        stats: collectStats(),
      };
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
