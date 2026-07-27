// frontend/js/item-drawer.js — desenhista de ÍCONE de item de inventário
//
// Diferente do symbol-drawer (que é SEMPRE branco sobre transparente pro símbolo
// do personagem), o item-drawer permite ESCOLHER A COR do pincel — assim o
// jogador pode desenhar ícones coloridos para seus itens (espada vermelha,
// poção azul, moeda dourada, etc.).
//
// Implementação reutiliza a mesma lógica do symbol-drawer (Canvas API, mouse + touch),
// mas com palette de cores + color picker nativo. Fundo transparente, exporta PNG
// com canal alpha preservado.

(function () {
  const CANVAS_SIZE = 256;  // quadrado (menor que símbolo — ícone é menor)
  const DEFAULT_BRUSH_COLOR = "#e13c3c";

  function open(onSave, initialIconUrl) {
    // Remove overlay existente
    const existing = document.getElementById("item-drawer-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "item-drawer-overlay";
    overlay.className = "symbol-drawer-overlay";  // reusa mesmos estilos

    overlay.innerHTML = `
      <div class="symbol-drawer-card" style="max-width:520px">
        <h3>🎨 Desenhar ícone do item</h3>
        <p class="text-sm muted mb-3">Desenhe o ícone do item. Ele será salvo como PNG <strong>transparente</strong> e exibido no inventário. Escolha a cor do pincel.</p>

        <div class="symbol-drawer-tools">
          <label>🖌 Tamanho:
            <input type="range" id="id-size" min="2" max="40" value="8">
            <span id="id-size-val" class="text-xs muted">8</span>
          </label>
          <label>🎨 Cor:
            <input type="color" id="id-color" value="${DEFAULT_BRUSH_COLOR}" style="width:32px;height:24px;padding:0;border:none;background:transparent;cursor:pointer">
          </label>
        </div>

        <div class="symbol-drawer-canvas-wrap">
          <canvas id="id-canvas" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" class="symbol-drawer-canvas" style="max-width:300px"></canvas>
        </div>

        <div class="symbol-drawer-tools" style="justify-content:space-between">
          <div class="flex gap-2">
            <button class="btn btn-sm btn-ghost" id="id-tool-brush" style="border-color:var(--accent)">🖌 Pincel</button>
            <button class="btn btn-sm btn-ghost" id="id-tool-eraser">🧽 Borracha</button>
            <button class="btn btn-sm btn-ghost" id="id-clear">🗑 Limpar</button>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-ghost" id="id-cancel">Cancelar</button>
            <button class="btn btn-primary" id="id-save">💾 Usar como ícone</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector("#id-canvas");
    const ctx = canvas.getContext("2d");
    let drawing = false;
    let lastX = 0, lastY = 0;
    let currentSize = 8;
    let currentColor = DEFAULT_BRUSH_COLOR;
    let currentTool = "brush";

    // Se veio initialIconUrl (editando item existente), carrega a imagem no canvas
    if (initialIconUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      };
      img.onerror = () => { /* ignora — canvas fica vazio */ };
      img.src = initialIconUrl;
    }

    // Tamanho do pincel
    const sizeInput = overlay.querySelector("#id-size");
    const sizeVal = overlay.querySelector("#id-size-val");
    sizeInput.addEventListener("input", () => {
      currentSize = Number(sizeInput.value);
      sizeVal.textContent = String(currentSize);
    });

    // Cor do pincel
    const colorInput = overlay.querySelector("#id-color");
    colorInput.addEventListener("input", () => {
      currentColor = colorInput.value;
      // Se estava na borracha, volta pra pincel ao mudar cor
      if (currentTool === "eraser") {
        currentTool = "brush";
        updateToolButtons();
      }
    });

    // Ferramentas
    function updateToolButtons() {
      overlay.querySelector("#id-tool-brush").style.borderColor = currentTool === "brush" ? "var(--accent)" : "transparent";
      overlay.querySelector("#id-tool-eraser").style.borderColor = currentTool === "eraser" ? "var(--accent)" : "transparent";
    }
    overlay.querySelector("#id-tool-brush").addEventListener("click", () => {
      currentTool = "brush";
      updateToolButtons();
    });
    overlay.querySelector("#id-tool-eraser").addEventListener("click", () => {
      currentTool = "eraser";
      updateToolButtons();
    });
    updateToolButtons();

    // Limpar
    overlay.querySelector("#id-clear").addEventListener("click", () => {
      if (!confirm("Limpar todo o canvas?")) return;
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    });

    // Cancelar
    overlay.querySelector("#id-cancel").addEventListener("click", () => overlay.remove());

    // Salvar
    overlay.querySelector("#id-save").addEventListener("click", async () => {
      const saveBtn = overlay.querySelector("#id-save");
      saveBtn.disabled = true;
      saveBtn.textContent = "Enviando…";
      try {
        const dataUrl = canvas.toDataURL("image/png");
        const blob = dataUrlToBlob(dataUrl);
        const fd = new FormData();
        fd.append("file", blob, `item-icon-${Date.now()}.png`);
        const res = await window.api.postForm("/api/upload", fd);
        if (res.url) {
          onSave(res.url);
          overlay.remove();
        } else {
          alert(res.warning || "Upload falhou");
          saveBtn.disabled = false;
          saveBtn.textContent = "💾 Usar como ícone";
        }
      } catch (e) {
        alert("Erro ao salvar: " + e.message);
        saveBtn.disabled = false;
        saveBtn.textContent = "💾 Usar como ícone";
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

  window.ItemDrawer = { open };
})();
