// frontend/js/photo-cropper.js — modal de recorte de foto estilo Discord (quadrado)
//
// Fluxo:
//   1. Usuário escolhe arquivo (input file) — validação de tipo/tamanho ANTES
//      de abrir o modal (não deixamos recortar arquivo inválido).
//   2. Modal abre com a imagem carregada dentro de uma moldura QUADRADA fixa.
//   3. Controles:
//      - Slider de zoom (1x a 3x)
//      - Arrastar a imagem dentro da moldura (mouse OU toque)
//   4. Ao confirmar, renderiza a área visível num canvas 512x512 e exporta
//      como Blob (PNG) — esse Blob vai pro backend de upload.
//
// Uso:
//   const cropper = new PhotoCropper({ maxSize: 5*1024*1024 });
//   cropper.open(file, (blob) => {
//     // blob é a imagem recortada 512x512 — envia pro /api/upload
//   });

(function () {
  const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
  const OUTPUT_SIZE = 512;       // resolução final quadrada
  const FRAME_SIZE = 280;        // tamanho da moldura na tela (CSS pixels)
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 3;

  class PhotoCropper {
    constructor(opts = {}) {
      this.maxSize = opts.maxSize || 5 * 1024 * 1024;
      this.modal = null;
      this.canvas = null;        // canvas de preview (mostra a moldura)
      this.ctx = null;
      this.img = null;           // HTMLImageElement carregado
      this.imgX = 0;             // posição X (canto sup. esq.) da imagem no espaço do canvas
      this.imgY = 0;
      this.imgW = 0;             // largura da imagem desenhada (já com zoom)
      this.imgH = 0;
      this.zoom = 1;
      this.dragging = false;
      this.dragStart = null;
      this.onConfirm = null;
    }

    // Abre o modal com o arquivo selecionado.
    // onConfirm(blob) é chamado quando usuário confirma o recorte.
    async open(file, onConfirm) {
      if (!file) return;
      if (!ALLOWED_TYPES.has(file.type)) {
        alert("Tipo não permitido. Use PNG, JPEG, WebP ou GIF.");
        return;
      }
      if (file.size > this.maxSize) {
        alert(`Arquivo muito grande. Máximo ${(this.maxSize / 1024 / 1024).toFixed(0)} MB.`);
        return;
      }
      this.onConfirm = onConfirm;

      // Carrega imagem
      const dataUrl = await fileToDataUrl(file);
      this.img = await loadImage(dataUrl);
      this.zoom = 1;
      this._computeInitialFit();

      // Cria modal
      this._buildModal();
      this._draw();
    }

    // Calcula tamanho/posição inicial pra imagem caber inteira na moldura
    // (mostra a foto inteira, sem zoom, centralizada).
    _computeInitialFit() {
      const frame = FRAME_SIZE;
      const ratio = Math.min(frame / this.img.width, frame / this.img.height);
      this.imgW = this.img.width * ratio;
      this.imgH = this.img.height * ratio;
      // Centraliza
      this.imgX = (frame - this.imgW) / 2;
      this.imgY = (frame - this.imgH) / 2;
      this.zoom = 1;
    }

    _buildModal() {
      // Remove modal antigo se existir
      this.close();

      const overlay = document.createElement("div");
      overlay.className = "photo-cropper-overlay";
      overlay.innerHTML = `
        <div class="photo-cropper-card">
          <h3 style="margin:0 0 16px 0;font-family:var(--font-serif);font-size:20px">Ajustar foto</h3>
          <p class="text-sm muted mb-4">Arraste pra posicionar · use o slider pra zoom · o recorte é sempre quadrado</p>
          <div class="photo-cropper-frame-wrap">
            <canvas class="photo-cropper-frame" width="${FRAME_SIZE}" height="${FRAME_SIZE}"></canvas>
          </div>
          <div class="photo-cropper-controls">
            <label class="text-sm muted">Zoom: <span id="pc-zoom-val">1.0x</span></label>
            <input type="range" id="pc-zoom" min="${MIN_ZOOM}" max="${MAX_ZOOM}" step="0.05" value="1">
          </div>
          <div class="flex gap-2" style="justify-content:flex-end;margin-top:16px">
            <button class="btn btn-ghost" id="pc-cancel">Cancelar</button>
            <button class="btn btn-primary" id="pc-confirm">Salvar foto</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      this.modal = overlay;
      this.canvas = overlay.querySelector(".photo-cropper-frame");
      this.ctx = this.canvas.getContext("2d");

      // Eventos
      overlay.querySelector("#pc-cancel").addEventListener("click", () => this.close());
      overlay.querySelector("#pc-confirm").addEventListener("click", () => this._confirm());
      const zoomInput = overlay.querySelector("#pc-zoom");
      const zoomVal = overlay.querySelector("#pc-zoom-val");
      zoomInput.addEventListener("input", () => {
        const newZoom = Number(zoomInput.value);
        this._setZoom(newZoom);
        zoomVal.textContent = newZoom.toFixed(1) + "x";
      });

      // Mouse drag
      this.canvas.addEventListener("mousedown", (e) => this._startDrag(e.clientX, e.clientY));
      window.addEventListener("mousemove", (e) => this._drag(e.clientX, e.clientY));
      window.addEventListener("mouseup", () => this._endDrag());

      // Touch drag (celular)
      this.canvas.addEventListener("touchstart", (e) => {
        if (e.touches.length === 1) {
          e.preventDefault();
          this._startDrag(e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false });
      window.addEventListener("touchmove", (e) => {
        if (e.touches.length === 1 && this.dragging) {
          e.preventDefault();
          this._drag(e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false });
      window.addEventListener("touchend", () => this._endDrag());

      // ESC fecha
      this._escHandler = (e) => { if (e.key === "Escape") this.close(); };
      window.addEventListener("keydown", this._escHandler);
    }

    _setZoom(newZoom) {
      // Ajusta zoom mantendo o centro da imagem visível
      const oldZoom = this.zoom;
      const cx = this.imgX + this.imgW / 2;
      const cy = this.imgY + this.imgH / 2;
      this.zoom = newZoom;
      const baseRatio = Math.min(FRAME_SIZE / this.img.width, FRAME_SIZE / this.img.height);
      this.imgW = this.img.width * baseRatio * newZoom;
      this.imgH = this.img.height * baseRatio * newZoom;
      this.imgX = cx - this.imgW / 2;
      this.imgY = cy - this.imgH / 2;
      this._clamp();
      this._draw();
    }

    _startDrag(clientX, clientY) {
      this.dragging = true;
      this.dragStart = { x: clientX, y: clientY, imgX: this.imgX, imgY: this.imgY };
    }
    _drag(clientX, clientY) {
      if (!this.dragging) return;
      const dx = clientX - this.dragStart.x;
      const dy = clientY - this.dragStart.y;
      this.imgX = this.dragStart.imgX + dx;
      this.imgY = this.dragStart.imgY + dy;
      this._clamp();
      this._draw();
    }
    _endDrag() {
      this.dragging = false;
    }

    // Garante que a imagem sempre cubra a moldura (não deixa ver fundo)
    _clamp() {
      if (this.imgW < FRAME_SIZE) {
        // Se imagem menor que moldura, centraliza (não permite ver fundo)
        this.imgX = (FRAME_SIZE - this.imgW) / 2;
      } else {
        if (this.imgX > 0) this.imgX = 0;
        if (this.imgX + this.imgW < FRAME_SIZE) this.imgX = FRAME_SIZE - this.imgW;
      }
      if (this.imgH < FRAME_SIZE) {
        this.imgY = (FRAME_SIZE - this.imgH) / 2;
      } else {
        if (this.imgY > 0) this.imgY = 0;
        if (this.imgY + this.imgH < FRAME_SIZE) this.imgY = FRAME_SIZE - this.imgH;
      }
    }

    _draw() {
      const ctx = this.ctx;
      ctx.fillStyle = "#0a0a0c";
      ctx.fillRect(0, 0, FRAME_SIZE, FRAME_SIZE);
      ctx.drawImage(this.img, this.imgX, this.imgY, this.imgW, this.imgH);
    }

    _confirm() {
      // Renderiza a área visível (a moldura FRAME_SIZE x FRAME_SIZE) num
      // canvas OUTPUT_SIZE x OUTPUT_SIZE em alta resolução.
      const out = document.createElement("canvas");
      out.width = OUTPUT_SIZE;
      out.height = OUTPUT_SIZE;
      const octx = out.getContext("2d");
      // Mapeia: a moldura (0..FRAME_SIZE) corresponde à área da imagem original
      // que está sendo mostrada. Calculamos a região de origem na imagem original.
      const scale = OUTPUT_SIZE / FRAME_SIZE;
      // Posição e tamanho na imagem ORIGINAL correspondentes ao que está visível:
      const srcX = -this.imgX / this.imgW * this.img.width;
      const srcY = -this.imgY / this.imgH * this.img.height;
      const srcW = FRAME_SIZE / this.imgW * this.img.width;
      const srcH = FRAME_SIZE / this.imgH * this.img.height;
      octx.drawImage(this.img, srcX, srcY, srcW, srcH, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      out.toBlob((blob) => {
        if (this.onConfirm) this.onConfirm(blob);
        this.close();
      }, "image/png");
    }

    close() {
      if (this.modal) {
        this.modal.remove();
        this.modal = null;
      }
      if (this._escHandler) {
        window.removeEventListener("keydown", this._escHandler);
        this._escHandler = null;
      }
      this.dragging = false;
    }
  }

  // ----- helpers -----
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  window.PhotoCropper = PhotoCropper;
})();
