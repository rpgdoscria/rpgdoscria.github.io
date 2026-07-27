// frontend/js/symbol-drawer.js — desenhista de símbolo para personagem
//
// Modal com canvas de desenho: pincel, borracha, paleta de cores, tamanho ajustável.
// Ao salvar, exporta como PNG (data URL), sobe pro Cloudinary (mesmo fluxo da foto)
// e chama o callback com a URL final.
//
// Implementação do zero com Canvas API (sem bibliotecas externas) — mouse + touch.

(function () {
  const PALETTE = [
    "#000000", "#ffffff", "#ef4444", "#f97316", "#eab308",
    "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899",
    "#92400e", "#78716c",
  ];
  const CANVAS_SIZE = 320;  // quadrado

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
        <p class="text-sm muted mb-3">Desenhe o símbolo do seu personagem. Será salvo como imagem quadrada e usado no lugar da foto.</p>

        <div class="symbol-drawer-tools">
          <label>🎨 Cor:
            <div class="symbol-drawer-color-palette" id="sd-palette"></div>
          </label>
          <label>🖌 Tamanho:
            <input type="range" id="sd-size" min="2" max="40" value="8">
            <span id="sd-size-val" class="text-xs muted">8</span>
          </label>
          <label>👁 Cor de fundo:
            <input type="color" id="sd-bg" value="#ffffff" style="width:32px;height:32px;border:1px solid var(--border-soft);border-radius:4px;background:transparent;cursor:pointer">
          </label>
        </div>

        <div class="symbol-drawer-canvas-wrap">
          <canvas id="sd-canvas" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" class="symbol-drawer-canvas"></canvas>
        </div>

        <div class="symbol-drawer-tools" style="justify-content:space-between">
          <div class="flex gap-2">
            <button class="btn btn-sm btn-ghost" id="sd-tool-brush" data-active="true">🖌 Pincel</button>
            <button class="btn btn-sm btn-ghost" id="sd-tool-eraser">🧽 Borracha</button>
            <button class="btn btn-sm btn-ghost" id="sd-clear">🗑 Limpar</button>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-ghost" id="sd-cancel">Cancelar</button>
            <button class="btn btn-primary" id="sd-save">💾 Usar como foto</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector("#sd-canvas");
    const ctx = canvas.getContext("2d");
    let drawing = false;
    let lastX = 0, lastY = 0;
    let currentColor = "#000000";
    let currentSize = 8;
    let currentTool = "brush";  // "brush" | "eraser"
    let bgColor = "#ffffff";

    // Preenche fundo branco inicialmente
    function fillBg() {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }
    fillBg();

    // Renderiza paleta
    const paletteEl = overlay.querySelector("#sd-palette");
    PALETTE.forEach(c => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.background = c;
      btn.dataset.color = c;
      btn.title = c;
      if (c === currentColor) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        currentColor = c;
        currentTool = "brush";
        updateToolButtons();
        paletteEl.querySelectorAll("button").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
      paletteEl.appendChild(btn);
    });

    // Tamanho
    const sizeInput = overlay.querySelector("#sd-size");
    const sizeVal = overlay.querySelector("#sd-size-val");
    sizeInput.addEventListener("input", () => {
      currentSize = Number(sizeInput.value);
      sizeVal.textContent = String(currentSize);
    });

    // Cor de fundo customizada
    overlay.querySelector("#sd-bg").addEventListener("input", (e) => {
      bgColor = e.target.value;
      // Reaplica fundo sem apagar o desenho existente? Complexo.
      // Solução simples: re-desenha fundo e pede confirmação se já há traços.
      if (hasContent()) {
        if (!confirm("Mudar a cor de fundo vai apagar o desenho atual. Continuar?")) {
          return;
        }
      }
      fillBg();
    });

    // Ferramentas
    function updateToolButtons() {
      overlay.querySelector("#sd-tool-brush").dataset.active = currentTool === "brush" ? "true" : "false";
      overlay.querySelector("#sd-tool-eraser").dataset.active = currentTool === "eraser" ? "true" : "false";
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

    // Limpar
    overlay.querySelector("#sd-clear").addEventListener("click", () => {
      if (!confirm("Limpar todo o canvas?")) return;
      fillBg();
    });

    // Cancelar
    overlay.querySelector("#sd-cancel").addEventListener("click", () => overlay.remove());

    // Salvar — exporta PNG, sobe pro Cloudinary, chama callback
    overlay.querySelector("#sd-save").addEventListener("click", async () => {
      const saveBtn = overlay.querySelector("#sd-save");
      saveBtn.disabled = true;
      saveBtn.textContent = "Enviando…";
      try {
        // Exporta como PNG (data URL)
        const dataUrl = canvas.toDataURL("image/png");
        // Converte data URL pra Blob
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
          saveBtn.textContent = "💾 Usar como foto";
        }
      } catch (e) {
        alert("Erro ao salvar: " + e.message);
        saveBtn.disabled = false;
        saveBtn.textContent = "💾 Usar como foto";
      }
    });

    // Verifica se há conteúdo desenhado (heurística: pega 1 pixel amostral)
    function hasContent() {
      // Simples — sempre retorna true pra forçar confirm em mudança de bg.
      // Pra ser preciso precisaríamos comparar pixels; mantemos simples.
      return true;
    }

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
      // Desenha um ponto inicial
      drawDot(pos.x, pos.y);
    }

    function drawDot(x, y) {
      ctx.beginPath();
      ctx.arc(x, y, currentSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = currentTool === "eraser" ? bgColor : currentColor;
      ctx.fill();
    }

    function moveDraw(e) {
      if (!drawing) return;
      e.preventDefault();
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = currentTool === "eraser" ? bgColor : currentColor;
      ctx.lineWidth = currentSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
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
