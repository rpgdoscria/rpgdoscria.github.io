// frontend/js/editor.js — lógica do editor (split + preview ao vivo + upload)

(function () {
  window.auth.mountHeader("#header-mount");
  const sess = window.auth.requireAuth("editor");
  if (!sess) return;

  const params = new URLSearchParams(location.search);
  const slug = params.get("slug");
  const presetTitle = params.get("title");

  const titleEl = document.getElementById("title");
  const catEl = document.getElementById("category");
  const contentEl = document.getElementById("content");
  const commentEl = document.getElementById("comment");
  const previewEl = document.getElementById("preview");
  const form = document.getElementById("edit-form");
  const saveBtn = document.getElementById("save-btn");
  const alertMount = document.getElementById("alert-mount");
  const cancelBtn = document.getElementById("cancel-btn");

  let originalSlug = null;
  let knownSlugs = new Set();
  let pageUpdatedAt = null; // Para detecção de edição simultânea

  function showAlert(type, msg) {
    alertMount.innerHTML = `<div class="alert alert-${type}">${escapeHtml(msg)}</div>`;
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  // Carrega categorias padrão + lista de slugs (para preview de wikilinks)
  async function loadMeta() {
    try {
      const data = await window.api.get("/api/pages");
      const cats = data.categories || [];
      // BUG CORRIGIDO: garantia que "Lore/História" sempre está como option,
      // mesmo se a API devolver lista vazia ou diferente.
      const allCats = cats.length > 0 ? cats : ["Lore/História"];
      catEl.innerHTML = allCats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
      (data.pages || []).forEach(p => knownSlugs.add(p.slug));
    } catch (e) {
      catEl.innerHTML = `<option value="Lore/História">Lore/História</option>`;
    }
  }

  // Modo edição: carrega a página existente
  async function loadPage() {
    if (!slug) {
      // Modo criação
      if (presetTitle) titleEl.value = presetTitle;
      catEl.value = "Lore/História";
      return;
    }
    try {
      const page = await window.api.get(`/api/pages/${encodeURIComponent(slug)}`);
      originalSlug = page.slug;
      pageUpdatedAt = page.updated_at; // guarda para detecção de conflito
      titleEl.value = page.title;
      // Seleciona categoria atual (se existir na lista)
      await loadMeta();
      const opt = Array.from(catEl.options).find(o => o.value === page.category);
      if (opt) catEl.value = page.category; else catEl.value = "Lore/História";
      contentEl.value = page.content_md || "";
      // cancel-btn volta pra página
      cancelBtn.href = `page.html?slug=${encodeURIComponent(slug)}`;
      renderPreview();
    } catch (e) {
      showAlert("error", `Erro ao carregar página: ${e.message}`);
    }
  }

  function renderPreview() {
    previewEl.innerHTML = window.md.render(contentEl.value, knownSlugs);
  }

  // Preview ao vivo com debounce
  let debounce;
  contentEl.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(renderPreview, 200);
  });

  // Submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = titleEl.value.trim();
    const category = catEl.value;
    const content_md = contentEl.value;
    const comment = commentEl.value.trim();
    if (!title) { showAlert("error", "Título é obrigatório."); return; }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      if (originalSlug) {
        // Edição — envia expected_updated_at para o backend checar conflito
        await window.api.put(`/api/pages/${encodeURIComponent(originalSlug)}`, {
          title, category, content_md, comment,
          expected_updated_at: pageUpdatedAt,
        });
        location.href = `page.html?slug=${encodeURIComponent(originalSlug)}`;
      } else {
        // Criação
        const res = await window.api.post("/api/pages", {
          title, category, content_md, comment,
        });
        location.href = `page.html?slug=${encodeURIComponent(res.slug)}`;
      }
    } catch (e) {
      // Se for conflito de edição simultânea, oferece recarregar
      if (e.data && e.data.conflict) {
        showAlert("warning", `${e.message} <br><br><a class="btn btn-sm" href="${location.pathname}?slug=${encodeURIComponent(originalSlug || slug || "")}">Recarregar editor</a>`);
      } else {
        showAlert("error", e.message);
      }
      saveBtn.disabled = false;
      saveBtn.textContent = "Salvar página";
    }
  });

  // ---- Upload de imagem ----
  const btnUpload = document.getElementById("btn-upload");
  const imgInput = document.getElementById("img-input");
  btnUpload.addEventListener("click", () => imgInput.click());
  imgInput.addEventListener("change", async () => {
    const file = imgInput.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    btnUpload.innerHTML = '<span class="spinner"></span>';
    btnUpload.disabled = true;
    try {
      const res = await window.api.postForm("/api/upload", fd);
      if (!res.url) {
        showAlert("warning", res.warning || "Imagem enviada, mas URL pública não configurada.");
        return;
      }
      const alt = file.name.replace(/\.[^.]+$/, "");
      const md = `![${alt}](${res.url})`;
      // Insere no cursor
      const ta = contentEl;
      const start = ta.selectionStart ?? contentEl.value.length;
      const end = ta.selectionEnd ?? contentEl.value.length;
      const before = contentEl.value.slice(0, start);
      const after = contentEl.value.slice(end);
      contentEl.value = `${before}${md}${after}`;
      renderPreview();
      showAlert("success", "Imagem inserida.");
    } catch (e) {
      showAlert("error", e.message);
    } finally {
      btnUpload.innerHTML = "📷 Inserir imagem";
      btnUpload.disabled = false;
      imgInput.value = "";
    }
  });

  // Boot
  (async () => {
    await loadMeta();
    await loadPage();
    renderPreview();
  })();
})();
