// frontend/js/symbol-drawer.js — desenhista de símbolo para personagem
//
// Tarefa 7 (FINAL): símbolo é SEMPRE branco sobre fundo transparente.
//   - Única cor de pincel: branco (#ffffff)
//   - Borracha apaga para TRANSPARÊNCIA (não para branco)
//   - Fundo do canvas é transparente (exibido com padrão xadrez)
//   - Exporta PNG com canal alpha preservado
//
// Implementação do zero com Canvas API (sem bibliotecas externas) — mouse + touch.
// O canvas usa `clearRect` para transparência real (não pinta branco no fundo).

(function () {
  const CANVAS_SIZE = 320;  // quadrado
  const BRUSH_COLOR = "#ffffff";  // branco sempre

  function open(onSave) {
    // Remove overlay existente
    const existing = document.getElementById("symbol-drawer-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "symbol-drawer-overlay";
    overlay.className = "symbol-drawer-overlay";

    overlay.innerHTML = `
      <div class="symbol-drawer-card">
        <h3>🎨 Desenhar símbolo</h3>
        <p class="text-sm muted mb-3">Desenhe o símbolo do seu personagem em <strong>branco sobre fundo transparente</strong>. O símbolo será salvo como PNG com transparência e usado separado da foto.</p>

        <div class="symbol-drawer-tools">
          <label>🖌 Tamanho do pincel:
            <input type="range" id="sd-size" min="2" max="40" value="8">
            <span id="sd-size-val" class="text-xs muted">8</span>
          </label>
          <span class="text-xs muted" style="margin-left:auto">Cor: <span style="display:inline-block;width:16px;height:16px;background:#fff;border:1px solid var(--border-soft);border-radius:3px;vertical-align:middle"></span> branco</span>
        </div>

        <div class="symbol-drawer-canvas-wrap">
          <canvas id="sd-canvas" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" class="symbol-drawer-canvas"></canvas>
        </div>

        <div class="symbol-drawer-tools" style="justify-content:space-between">
          <div class="flex gap-2">
            <button class="btn btn-sm btn-ghost" id="sd-tool-brush" style="border-color:var(--accent)">🖌 Pincel</button>
            <button class="btn btn-sm btn-ghost" id="sd-tool-eraser">🧽 Borracha</button>
            <button class="btn btn-sm btn-ghost" id="sd-clear">🗑 Limpar</button>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-ghost" id="sd-cancel">Cancelar</button>
            <button class="btn btn-primary" id="sd-save">💾 Usar como símbolo</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector("#sd-canvas");
    const ctx = canvas.getContext("2d");
    let drawing = false;
    let lastX = 0, lastY = 0;
    let currentSize = 8;
    let currentTool = "brush";  // "brush" | "eraser"

    // NÃO preenche fundo — canvas começa transparente.
    // clearRect já deixa tudo transparente por padrão.

    // Tamanho
    const sizeInput = overlay.querySelector("#sd-size");
    const sizeVal = overlay.querySelector("#sd-size-val");
    sizeInput.addEventListener("input", () => {
      currentSize = Number(sizeInput.value);
      sizeVal.textContent = String(currentSize);
    });

    // Ferramentas
    function updateToolButtons() {
      overlay.querySelector("#sd-tool-brush").style.borderColor = currentTool === "brush" ? "var(--accent)" : "transparent";
      overlay.querySelector("#sd-tool-eraser").style.borderColor = currentTool === "eraser" ? "var(--accent)" : "transparent";
    }
    overlay.querySelector("#sd-tool-brush").addEventListener("click", () => {
      currentTool = "brush";
      updateToolButtons();
    });
    overlay.querySelector("#sd-tool-eraser").addEventListener("click", () => {
      currentTool = "eraser";
      updateToolButtons();
    });
    updateToolButtons();

    // Limpar — clearRect deixa transparente
    overlay.querySelector("#sd-clear").addEventListener("click", () => {
      if (!confirm("Limpar todo o canvas?")) return;
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    });

    // Cancelar
    overlay.querySelector("#sd-cancel").addEventListener("click", () => overlay.remove());

    // Salvar — exporta PNG com transparência, sobe pro Cloudinary
    overlay.querySelector("#sd-save").addEventListener("click", async () => {
      const saveBtn = overlay.querySelector("#sd-save");
      saveBtn.disabled = true;
      saveBtn.textContent = "Enviando…";
      try {
        // Exporta como PNG preservando alpha (canvas já é transparente onde não há traço)
        const dataUrl = canvas.toDataURL("image/png");
        const blob = dataUrlToBlob(dataUrl);
        const fd = new FormData();
        fd.append("file", blob, `symbol-${Date.now()}.png`);
        const res = await window.api.postForm("/api/upload", fd);
        if (res.url) {
          onSave(res.url);
          overlay.remove();
        } else {
          alert(res.warning || "Upload falhou");
          saveBtn.disabled = false;
          saveBtn.textContent = "💾 Usar como símbolo";
        }
      } catch (e) {
        alert("Erro ao salvar: " + e.message);
        saveBtn.disabled = false;
        saveBtn.textContent = "💾 Usar como símbolo";
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
      ctx.fillStyle = BRUSH_COLOR;
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
      ctx.strokeStyle = BRUSH_COLOR;
      ctx.lineWidth = currentSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
      lastX = pos.x;
      lastY = pos.y;
    }

    function endDraw() {
      drawing = false;
    }

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", moveDraw);
    canvas.addEventListener("mouseup", endDraw);
    canvas.addEventListener("mouseleave", endDraw);
    canvas.addEventListener("touchstart", startDraw, { passive: false });
    canvas.addEventListener("touchmove", moveDraw, { passive: false });
    canvas.addEventListener("touchend", endDraw);
    canvas.addEventListener("touchcancel", endDraw);

    // Clique fora do card fecha
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
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

  window.SymbolDrawer = { open };
})();
