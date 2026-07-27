// frontend/js/enemy-illustration-drawer.js — desenhista de ILUSTRAÇÃO de inimigo
//
// v12: NOVO. Diferente do symbol-drawer (branco puro) e do item-drawer (cor
// única), este é para ilustrações completas de inimigos — permite:
//   - Múltiplas cores (color picker nativo)
//   - Pincel + borracha
//   - UNDO/REDO (Ctrl+Z / Ctrl+Y) com botões visuais ↶ ↷
//   - Upload de imagem existente (alternative ao desenho)
//   - Fundo transparente (padrão xadrez visível)
//   - Canvas maior (512×512) para mais detalhes
//
// Salva no Cloudinary como PNG com canal alpha. Associado ao inimigo via
// `illustrationUrl` no estado do RoomDO.

(function () {
  const CANVAS_SIZE = 512;  // maior que símbolo/item — ilustração é mais detalhada
  const DEFAULT_BRUSH_COLOR = "#b3121c";  // vermelho tema
  const MAX_HISTORY = 30;  // mais histórico pra ilustrações complexas

  function open(onSave, initialIllustrationUrl) {
    const existing = document.getElementById("enemy-illustration-drawer-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "enemy-illustration-drawer-overlay";
    overlay.className = "symbol-drawer-overlay";

    overlay.innerHTML = `
      <div class="symbol-drawer-card" style="max-width:640px">
        <div class="drawer-header">
          <h3>🎨 Ilustração do inimigo</h3>
          <button class="btn btn-sm btn-ghost" id="ei-close" title="Fechar">✕</button>
        </div>
        <p class="text-sm muted mb-3">Desenhe a ilustração do inimigo ou faça upload de uma imagem. Fundo transparente (padrão xadrez). Use <strong>Ctrl+Z</strong>/<strong>Ctrl+Y</strong> para desfazer/refazer.</p>

        <div class="symbol-drawer-tools">
          <label>🖌 Tamanho:
            <input type="range" id="ei-size" min="2" max="60" value="12">
            <span id="ei-size-val" class="text-xs muted">12</span>
          </label>
          <label>🎨 Cor:
            <input type="color" id="ei-color" value="${DEFAULT_BRUSH_COLOR}" style="width:36px;height:28px;padding:0;border:1px solid var(--border-soft);border-radius:4px;background:transparent;cursor:pointer">
          </label>
          <label class="text-xs muted" style="display:flex;align-items:center;gap:4px;cursor:pointer;margin-left:auto">
            <input type="file" id="ei-upload" accept="image/*" style="display:none">
            <span class="btn btn-sm btn-ghost">📁 Upload</span>
          </label>
        </div>

        <div class="drawer-toolbar">
          <div class="drawer-toolbar-group">
            <button class="btn btn-sm btn-ghost drawer-tool-btn" id="ei-tool-brush" style="border-color:var(--accent)" title="Pincel">🖌</button>
            <button class="btn btn-sm btn-ghost drawer-tool-btn" id="ei-tool-eraser" title="Borracha">🧽</button>
          </div>
          <div class="drawer-toolbar-group">
            <button class="btn btn-sm btn-ghost drawer-tool-btn" id="ei-undo" title="Desfazer (Ctrl+Z)" disabled>↶</button>
            <button class="btn btn-sm btn-ghost drawer-tool-btn" id="ei-redo" title="Refazer (Ctrl+Y)" disabled>↷</button>
          </div>
          <button class="btn btn-sm btn-ghost drawer-tool-btn" id="ei-clear" title="Limpar tudo">🗑</button>
        </div>

        <div class="symbol-drawer-canvas-wrap">
          <canvas id="ei-canvas" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" class="symbol-drawer-canvas" style="max-width:380px"></canvas>
        </div>

        <div class="symbol-drawer-tools" style="justify-content:space-between">
          <button class="btn btn-ghost" id="ei-cancel">Cancelar</button>
          <button class="btn btn-primary" id="ei-save">💾 Usar como ilustração</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector("#ei-canvas");
    const ctx = canvas.getContext("2d");
    let drawing = false;
    let lastX = 0, lastY = 0;
    let currentSize = 12;
    let currentColor = DEFAULT_BRUSH_COLOR;
    let currentTool = "brush";

    // ===== Pilha de histórico (undo/redo) =====
    let undoStack = [];
    let redoStack = [];

    function snapshot() {
      try { return ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE); }
      catch (e) { return null; }
    }
    function pushUndo() {
      const snap = snapshot();
      if (!snap) return;
      undoStack.push(snap);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack = [];
      updateUndoRedoButtons();
    }
    function undo() {
      if (undoStack.length === 0) return;
      const current = snapshot();
      if (current) redoStack.push(current);
      const prev = undoStack.pop();
      ctx.putImageData(prev, 0, 0);
      updateUndoRedoButtons();
    }
    function redo() {
      if (redoStack.length === 0) return;
      const current = snapshot();
      if (current) undoStack.push(current);
      const next = redoStack.pop();
      ctx.putImageData(next, 0, 0);
      updateUndoRedoButtons();
    }
    function updateUndoRedoButtons() {
      const undoBtn = overlay.querySelector("#ei-undo");
      const redoBtn = overlay.querySelector("#ei-redo");
      undoBtn.disabled = undoStack.length === 0;
      redoBtn.disabled = redoStack.length === 0;
      undoBtn.style.opacity = undoBtn.disabled ? "0.4" : "1";
      redoBtn.style.opacity = redoBtn.disabled ? "0.4" : "1";
    }

    overlay.querySelector("#ei-undo").addEventListener("click", undo);
    overlay.querySelector("#ei-redo").addEventListener("click", redo);

    // Atalhos de teclado
    function keyHandler(e) {
      if (!document.body.contains(overlay)) {
        document.removeEventListener("keydown", keyHandler);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    }
    document.addEventListener("keydown", keyHandler);

    // Carrega imagem inicial (editando inimigo existente)
    if (initialIllustrationUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      };
      img.onerror = () => {};
      img.src = initialIllustrationUrl;
    }

    // Tamanho do pincel
    const sizeInput = overlay.querySelector("#ei-size");
    const sizeVal = overlay.querySelector("#ei-size-val");
    sizeInput.addEventListener("input", () => {
      currentSize = Number(sizeInput.value);
      sizeVal.textContent = String(currentSize);
    });

    // Cor
    const colorInput = overlay.querySelector("#ei-color");
    colorInput.addEventListener("input", () => {
      currentColor = colorInput.value;
      if (currentTool === "eraser") {
        currentTool = "brush";
        updateToolButtons();
      }
    });

    // Upload de imagem
    overlay.querySelector("#ei-upload").addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        alert("Selecione um arquivo de imagem.");
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          pushUndo();
          ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          // Ajusta imagem ao canvas mantendo proporção (object-fit: contain)
          const scale = Math.min(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          const x = (CANVAS_SIZE - w) / 2;
          const y = (CANVAS_SIZE - h) / 2;
          ctx.drawImage(img, x, y, w, h);
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    // Ferramentas
    function updateToolButtons() {
      overlay.querySelector("#ei-tool-brush").style.borderColor = currentTool === "brush" ? "var(--accent)" : "transparent";
      overlay.querySelector("#ei-tool-eraser").style.borderColor = currentTool === "eraser" ? "var(--accent)" : "transparent";
    }
    overlay.querySelector("#ei-tool-brush").addEventListener("click", () => {
      currentTool = "brush";
      updateToolButtons();
    });
    overlay.querySelector("#ei-tool-eraser").addEventListener("click", () => {
      currentTool = "eraser";
      updateToolButtons();
    });
    updateToolButtons();

    // Limpar
    overlay.querySelector("#ei-clear").addEventListener("click", () => {
      if (!confirm("Limpar todo o canvas?")) return;
      pushUndo();
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    });

    // Cancelar / fechar
    function close() {
      document.removeEventListener("keydown", keyHandler);
      overlay.remove();
    }
    overlay.querySelector("#ei-cancel").addEventListener("click", close);
    overlay.querySelector("#ei-close").addEventListener("click", close);

    // Salvar
    overlay.querySelector("#ei-save").addEventListener("click", async () => {
      const saveBtn = overlay.querySelector("#ei-save");
      saveBtn.disabled = true;
      saveBtn.textContent = "Enviando…";
      try {
        const dataUrl = canvas.toDataURL("image/png");
        const blob = dataUrlToBlob(dataUrl);
        const fd = new FormData();
        fd.append("file", blob, `enemy-illustration-${Date.now()}.png`);
        const res = await window.api.postForm("/api/upload", fd);
        if (res.url) {
          onSave(res.url);
          close();
        } else {
          alert(res.warning || "Upload falhou");
          saveBtn.disabled = false;
          saveBtn.textContent = "💾 Usar como ilustração";
        }
      } catch (e) {
        alert("Erro ao salvar: " + e.message);
        saveBtn.disabled = false;
        saveBtn.textContent = "💾 Usar como ilustração";
      }
    });

    // ===== Desenho (mouse + touch) =====
    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      let clientX, clientY;
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    }

    function startDraw(e) {
      e.preventDefault();
      drawing = true;
      const pos = getPos(e);
      lastX = pos.x;
      lastY = pos.y;
      drawDot(pos.x, pos.y);
    }

    function drawDot(x, y) {
      ctx.save();
      ctx.globalCompositeOperation = currentTool === "eraser" ? "destination-out" : "source-over";
      ctx.beginPath();
      ctx.arc(x, y, currentSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = currentColor;
      ctx.fill();
      ctx.restore();
    }

    function moveDraw(e) {
      if (!drawing) return;
      e.preventDefault();
      const pos = getPos(e);
      ctx.save();
      ctx.globalCompositeOperation = currentTool === "eraser" ? "destination-out" : "source-over";
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = currentSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
      lastX = pos.x;
      lastY = pos.y;
    }

    function endDraw() {
      if (!drawing) return;
      drawing = false;
      pushUndo();
    }

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", moveDraw);
    canvas.addEventListener("mouseup", endDraw);
    canvas.addEventListener("mouseleave", endDraw);
    canvas.addEventListener("touchstart", startDraw, { passive: false });
    canvas.addEventListener("touchmove", moveDraw, { passive: false });
    canvas.addEventListener("touchend", endDraw);
    canvas.addEventListener("touchcancel", endDraw);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    updateUndoRedoButtons();
  }

  function dataUrlToBlob(dataUrl) {
    const arr = dataUrl.split(",");
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8 = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    return new Blob([u8], { type: mime });
  }

  window.EnemyIllustrationDrawer = { open };
})();
