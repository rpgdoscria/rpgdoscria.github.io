// frontend/js/dice-visual.js — dado visual animado para a sala
//
// Componente que mostra um dado girando quando uma rolagem acontece.
// - Animação pura CSS/JS (sem 3D, sem física, sem bibliotecas)
// - Funciona pra qualquer dS (d6, d13, d20, d100...) — ícone genérico com rótulo "dS"
// - Agrupa dados por tipo: até 6 ícones individuais, mais que isso mostra 1 com "×N"
// - Resultado sempre aparece em texto também, nunca só na animação
// - Estado ocioso: dado parado com "aguardando rolagem" antes da primeira rolagem

(function () {
  let container = null;
  let isAnimating = false;
  let idleTimer = null;

  // Inicializa o componente no seletor dado
  function init(selector) {
    container = document.querySelector(selector);
    if (!container) return;
    renderIdle();
  }

  // Estado ocioso — antes de qualquer rolagem
  function renderIdle() {
    if (!container) return;
    container.innerHTML = `
      <div class="dice-visual-bar">
        <div class="dice-visual-idle">
          <div class="dice-visual-die idle">
            <div class="dice-visual-die-face">🎲</div>
          </div>
          <div class="dice-visual-idle-text">aguardando rolagem</div>
        </div>
      </div>
    `;
  }

  // Anima a rolagem a partir de um payload dice_result
  // payload: { rollerUsername, formula, breakdown, total, label, result: { terms: [...] } }
  function animateRoll(payload) {
    if (!container || isAnimating) return;
    isAnimating = true;

    // Extrai grupos de dados do result.terms
    const terms = payload?.result?.terms || [];
    const diceTerms = terms.filter(t => t.kind === "dice");
    const modifierTerms = terms.filter(t => t.kind === "modifier");

    // Agrupa por tipo de dado (sides) — soma quantos dados daquele tipo
    const groups = {};
    diceTerms.forEach(t => {
      if (!t.dice || t.dice.length === 0) return;
      const sides = t.dice[0].sides;
      if (!groups[sides]) {
        groups[sides] = { sides, totalDice: 0, keptValues: [], allValues: [] };
      }
      groups[sides].totalDice += t.dice.length;
      t.dice.forEach(d => {
        groups[sides].allValues.push(d.value);
        if (d.kept) groups[sides].keptValues.push(d.value);
      });
      groups[sides].subtotal = t.subtotal;
    });

    const groupList = Object.values(groups);
    const modifiers = modifierTerms.map(t => t.modifier || 0);
    const total = payload?.total ?? payload?.result?.total ?? 0;

    // Constrói o HTML inicial (dados parados, vão começar a girar)
    let diceHtml = "";
    const MAX_INDIVIDUAL = 6; // até 6 ícones individuais por grupo

    groupList.forEach((g, gi) => {
      const isLargeGroup = g.totalDice > MAX_INDIVIDUAL;
      if (isLargeGroup) {
        // 1 ícone representativo com selo "×N"
        diceHtml += `
          <div class="dice-visual-group" data-group-idx="${gi}">
            <div class="dice-visual-die-group">
              <div class="dice-visual-die rolling" data-sides="${g.sides}" data-final="${g.subtotal ?? 0}">
                <div class="dice-visual-die-label">d${g.sides}</div>
                <div class="dice-visual-die-number">?</div>
              </div>
              <div class="dice-visual-die-count">×${g.totalDice}</div>
            </div>
            <div class="dice-visual-group-total"></div>
          </div>
        `;
      } else {
        // Ícones individuais — um por dado
        const valuesToShow = g.allValues.slice(0, MAX_INDIVIDUAL);
        valuesToShow.forEach((val, vi) => {
          diceHtml += `
            <div class="dice-visual-group" data-group-idx="${gi}" data-die-idx="${vi}">
              <div class="dice-visual-die rolling" data-sides="${g.sides}" data-final="${val}">
                <div class="dice-visual-die-label">d${g.sides}</div>
                <div class="dice-visual-die-number">?</div>
              </div>
            </div>
          `;
        });
      }
    });

    // Modificadores
    let modHtml = "";
    const modTotal = modifiers.reduce((a, b) => a + b, 0);
    if (modTotal !== 0) {
      modHtml = `<div class="dice-visual-modifier">${modTotal > 0 ? "+" : ""}${modTotal}</div>`;
    }

    // Total final
    const labelHtml = payload.label ? `<div class="dice-visual-label">${escapeHtml(payload.label)}</div>` : "";
    const formulaHtml = `<code class="dice-visual-formula">${escapeHtml(payload.formula)}</code>`;
    const rollerHtml = `<div class="dice-visual-roller">${escapeHtml(payload.rollerUsername)} rolou</div>`;

    container.innerHTML = `
      <div class="dice-visual-bar">
        <div class="dice-visual-dice-row">
          ${diceHtml}
          ${modHtml}
        </div>
        <div class="dice-visual-info">
          ${rollerHtml}
          ${labelHtml}
          ${formulaHtml}
          <div class="dice-visual-total-wrapper">
            <div class="dice-visual-total" id="dice-visual-total">?</div>
          </div>
        </div>
      </div>
    `;

    // Inicia animação de giro em todos os dados
    const diceElements = container.querySelectorAll(".dice-visual-die.rolling");
    const animationDuration = 1200; // ms — fixo e previsível
    const flipInterval = 80; // ms entre trocas de número
    const decelStart = 800; // ms — quando começa a desacelerar

    diceElements.forEach((dieEl, idx) => {
      // Aplica animação CSS de rotação
      dieEl.style.animation = `dice-roll-spin ${animationDuration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;

      // Troca o número rapidamente simulando aleatoriedade
      const sides = Number(dieEl.dataset.sides) || 20;
      const finalVal = dieEl.dataset.final;
      const numEl = dieEl.querySelector(".dice-visual-die-number");
      let elapsed = 0;
      const flipTimer = setInterval(() => {
        elapsed += flipInterval;
        if (elapsed >= decelStart) {
          // Desacelera — intervalo maior
          clearInterval(flipTimer);
          const slowTimer = setInterval(() => {
            elapsed += 150;
            if (elapsed >= animationDuration) {
              clearInterval(slowTimer);
              numEl.textContent = finalVal;
              dieEl.classList.remove("rolling");
              dieEl.classList.add("settled");
              // Pulso de destaque
              dieEl.style.animation = "dice-settle 0.4s ease";
            } else {
              numEl.textContent = String(Math.floor(Math.random() * sides) + 1);
            }
          }, 150);
        } else {
          numEl.textContent = String(Math.floor(Math.random() * sides) + 1);
        }
      }, flipInterval);
    });

    // Após a animação terminar, mostra o total
    setTimeout(() => {
      const totalEl = document.getElementById("dice-visual-total");
      if (totalEl) {
        totalEl.textContent = String(total);
        totalEl.classList.add("revealed");
      }
      isAnimating = false;
    }, animationDuration + 100);
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  window.diceVisual = { init, animateRoll, renderIdle };
})();
