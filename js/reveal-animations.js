// frontend/js/reveal-animations.js — animações de revelação de documentos secretos
//
// 5 animações CSS puras (sem bibliotecas externas):
// 1. envelope  — envelope confidencial rasga e carta emerge
// 2. carta     — carta antiga dobra e desdobra
// 3. pergaminho — rola de cima pra baixo
// 4. bau       — baú abre com luz
// 5. livro     — capa de livro abre e páginas viram

(function () {
  // Abre modal com animação selecionada
  // opts: { title, contentHtml (markdown já renderizado), animation: 'envelope'|'carta'|'pergaminho'|'bau'|'livro' }
  function reveal(opts) {
    const existing = document.getElementById("reveal-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "reveal-overlay";
    overlay.className = "reveal-overlay";

    const anim = opts.animation || "pergaminho";
    let animHtml = "";

    switch (anim) {
      case "envelope":
        animHtml = `
          <div class="reveal-anim reveal-envelope">
            <div class="envelope-flap"></div>
            <div class="envelope-body">
              <div class="envelope-letter">
                <h2>${esc(opts.title)}</h2>
                <div class="reveal-content">${opts.contentHtml}</div>
              </div>
            </div>
          </div>`;
        break;
      case "carta":
        animHtml = `
          <div class="reveal-anim reveal-carta">
            <div class="carta-fold">
              <h2>${esc(opts.title)}</h2>
              <div class="reveal-content">${opts.contentHtml}</div>
            </div>
          </div>`;
        break;
      case "pergaminho":
        animHtml = `
          <div class="reveal-anim reveal-pergaminho">
            <div class="pergaminho-roll-top"></div>
            <div class="pergaminho-body">
              <h2>${esc(opts.title)}</h2>
              <div class="reveal-content">${opts.contentHtml}</div>
            </div>
            <div class="pergaminho-roll-bottom"></div>
          </div>`;
        break;
      case "bau":
        animHtml = `
          <div class="reveal-anim reveal-bau">
            <div class="bau-lid"></div>
            <div class="bau-body">
              <div class="bau-glow"></div>
              <div class="bau-content">
                <h2>${esc(opts.title)}</h2>
                <div class="reveal-content">${opts.contentHtml}</div>
              </div>
            </div>
          </div>`;
        break;
      case "livro":
        animHtml = `
          <div class="reveal-anim reveal-livro">
            <div class="livro-cover">
              <div class="livro-page">
                <h2>${esc(opts.title)}</h2>
                <div class="reveal-content">${opts.contentHtml}</div>
              </div>
            </div>
          </div>`;
        break;
      default:
        animHtml = `<div class="reveal-anim reveal-simple"><h2>${esc(opts.title)}</h2><div class="reveal-content">${opts.contentHtml}</div></div>`;
    }

    overlay.innerHTML = `
      <div class="reveal-modal">
        ${animHtml}
        <button class="btn btn-ghost reveal-close-btn" style="position:absolute;top:16px;right:16px;z-index:10">✕ Fechar</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // Aplica classe de animação após um frame
    requestAnimationFrame(() => {
      const anim = overlay.querySelector(".reveal-anim");
      if (anim) anim.classList.add("animating");
    });

    overlay.querySelector(".reveal-close-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  window.revealAnimations = { reveal };
})();
