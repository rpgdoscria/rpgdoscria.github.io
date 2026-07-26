// frontend/js/damage-system.js — botão de dano direto + efeitos visuais/sonoros
//
// Funcionalidades:
// 1. Botão de dano (⚔️) em cada card de personagem/inimigo (mestre only)
// 2. Modal inline para digitar valor do dano + botões rápidos (1, 5, 10)
// 3. Efeito visual: barra pisca vermelho, card treme se HP crítico
// 4. Efeito sonoro: beep procedural via Web Audio API
// 5. Toggle de som (localStorage)

(function () {
  let soundEnabled = true;
  try { soundEnabled = localStorage.getItem("rpg_sound_enabled") !== "false"; } catch {}

  // Web Audio API — beep procedural (sem arquivo externo)
  let audioCtx = null;
  function playDamageSound() {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = "square";
      osc.frequency.setValueAtTime(180, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(60, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.15);
    } catch {}
  }
  function playHealSound() {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(400, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.2);
    } catch {}
  }

  // Abre modal de dano
  // opts: { targetName, onApply: (damage) => void, isHeal: bool }
  function openDamageModal(opts) {
    // Remove modal anterior se existir
    const existing = document.getElementById("damage-modal-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "damage-modal-overlay";
    overlay.className = "damage-modal";
    const isHeal = opts.isHeal;
    const icon = isHeal ? "💚" : "⚔️";
    const label = isHeal ? "Curar" : "Dano";
    const color = isHeal ? "var(--success)" : "var(--danger)";
    overlay.innerHTML = `
      <div class="damage-modal-card" style="border-color:${color}">
        <h3 style="color:${color}">${icon} ${label} — ${opts.targetName}</h3>
        <input type="number" id="damage-value" placeholder="0" min="1" autofocus>
        <div class="damage-quick-btns">
          <button data-dmg="1">1</button>
          <button data-dmg="5">5</button>
          <button data-dmg="10">10</button>
          <button data-dmg="15">15</button>
          <button data-dmg="20">20</button>
        </div>
        <div class="flex gap-2" style="justify-content:center">
          <button class="btn ${isHeal ? '' : 'btn-danger'}" id="damage-apply" style="${isHeal ? 'background:var(--success);color:white' : ''}">Aplicar ${label}</button>
          <button class="btn btn-ghost" id="damage-cancel">Cancelar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector("#damage-value");
    input.focus();

    function apply(val) {
      const n = Number(val);
      if (!n || n <= 0) return;
      opts.onApply(isHeal ? n : -n);
      close();
    }

    overlay.querySelector("#damage-apply").addEventListener("click", () => apply(input.value));
    overlay.querySelector("#damage-cancel").addEventListener("click", close);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); apply(input.value); }
      if (e.key === "Escape") close();
    });
    overlay.querySelectorAll(".damage-quick-btns button").forEach(b => {
      b.addEventListener("click", () => apply(b.dataset.dmg));
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    function close() { overlay.remove(); }
  }

  // Aplica efeito visual de dano a um card
  // cardEl: elemento do card
  // barEl: elemento da barra de HP (opcional)
  // isHeal: se true, efeito verde (cura); se false, efeito vermelho (dano)
  // isCritical: se true, card treme (HP <= 0)
  function flashDamage(cardEl, barEl, isHeal, isCritical) {
    if (cardEl) {
      cardEl.classList.add("damaged");
      setTimeout(() => cardEl.classList.remove("damaged"), 400);
    }
    if (barEl) {
      barEl.classList.add(isHeal ? "healed" : "damaged");
      setTimeout(() => barEl.classList.remove("healed", "damaged"), 500);
    }
    if (isHeal) playHealSound();
    else playDamageSound();
  }

  // Toggle de som
  function toggleSound() {
    soundEnabled = !soundEnabled;
    try { localStorage.setItem("rpg_sound_enabled", String(soundEnabled)); } catch {}
    return soundEnabled;
  }
  function isSoundEnabled() { return soundEnabled; }

  // Adiciona botão de dano/cura num card
  // container: elemento onde inserir os botões
  // opts: { targetName, onDamage: (delta) => void }
  function addDamageButtons(container, opts) {
    const btn = document.createElement("button");
    btn.className = "damage-btn";
    btn.title = "Aplicar dano";
    btn.textContent = "⚔️";
    btn.style.fontSize = "14px";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDamageModal({
        targetName: opts.targetName,
        onApply: (delta) => opts.onDamage(delta),
        isHeal: false,
      });
    });
    container.appendChild(btn);

    const healBtn = document.createElement("button");
    healBtn.className = "damage-btn heal";
    healBtn.title = "Curar";
    healBtn.textContent = "💚";
    healBtn.style.fontSize = "14px";
    healBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDamageModal({
        targetName: opts.targetName,
        onApply: (delta) => opts.onDamage(delta),
        isHeal: true,
      });
    });
    container.appendChild(healBtn);
  }

  window.damageSystem = {
    openDamageModal,
    flashDamage,
    toggleSound,
    isSoundEnabled,
    addDamageButtons,
    playDamageSound,
    playHealSound,
  };
})();
