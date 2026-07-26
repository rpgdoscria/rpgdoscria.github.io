// frontend/js/formula-builder.js — construtor visual de fórmulas de dados
//
// Substitui o campo de texto por botões interativos: d4/d6/d8/d10/d12/d20,
// d customizado, operadores +/-/*, modificadores, kh1/kl1/dl1/dh1.
// Preview em tempo real + validação contínua.

(function () {
  let parts = []; // array de strings que formam a fórmula
  let container = null;
  let onValidCallback = null;

  function init(selector, onChange) {
    container = document.querySelector(selector);
    if (!container) return;
    onValidCallback = onChange;
    parts = [];
    render();
  }

  function addPart(str) {
    // Se a última parte é um número ou dado, adiciona + automaticamente
    const last = parts[parts.length - 1];
    if (last && !isOperator(last) && !isOperator(str)) {
      parts.push("+");
    }
    parts.push(str);
    render();
  }

  function isOperator(s) {
    return ["+", "-", "*", "/"].includes(s);
  }

  function removeLast() {
    parts.pop();
    render();
  }

  function clear() {
    parts = [];
    render();
  }

  function getFormula() {
    return parts.join("");
  }

  function isValid() {
    return window.diceUI && window.diceUI.isValid(getFormula());
  }

  function render() {
    if (!container) return;
    const formula = getFormula();
    const valid = formula ? isValid() : false;

    container.innerHTML = `
      <div class="formula-builder">
        <div class="formula-builder-preview ${formula ? (valid ? 'valid' : 'invalid') : ''}">
          ${formula || '<span class="muted">Construa sua fórmula…</span>'}
        </div>
        <div class="formula-builder-dice">
          <button class="fb-dice-btn" data-add="1d4">d4</button>
          <button class="fb-dice-btn" data-add="1d6">d6</button>
          <button class="fb-dice-btn" data-add="1d8">d8</button>
          <button class="fb-dice-btn" data-add="1d10">d10</button>
          <button class="fb-dice-btn" data-add="1d12">d12</button>
          <button class="fb-dice-btn" data-add="1d20">d20</button>
          <button class="fb-dice-btn" data-add="1d100">d100</button>
        </div>
        <div class="formula-builder-row">
          <label class="text-xs muted">Dados:</label>
          <input type="number" id="fb-count" value="1" min="1" max="100" style="width:50px">
          <span class="text-xs muted">d</span>
          <input type="number" id="fb-sides" value="6" min="2" max="1000" style="width:60px">
          <button class="btn btn-sm" id="fb-add-custom-dice">Adicionar</button>
        </div>
        <div class="formula-builder-ops">
          <button class="fb-op-btn" data-add="+">+</button>
          <button class="fb-op-btn" data-add="-">−</button>
          <button class="fb-op-btn" data-add="*">×</button>
          <input type="number" id="fb-modifier" placeholder="mod" style="width:60px">
          <button class="btn btn-sm" id="fb-add-mod">Add mod</button>
        </div>
        <div class="formula-builder-modifiers">
          <span class="text-xs muted">Vantagem/Descarte:</span>
          <button class="fb-mod-btn" data-add="kh1" title="Mantém o maior (vantagem)">kh1</button>
          <button class="fb-mod-btn" data-add="kl1" title="Mantém o menor (desvantagem)">kl1</button>
          <button class="fb-mod-btn" data-add="dl1" title="Descarta o menor">dl1</button>
          <button class="fb-mod-btn" data-add="dh1" title="Descarta o maior">dh1</button>
        </div>
        <div class="formula-builder-actions">
          <button class="btn btn-sm btn-ghost" id="fb-undo">← Desfazer</button>
          <button class="btn btn-sm btn-ghost" id="fb-clear">Limpar</button>
        </div>
        ${formula && !valid ? '<div class="formula-builder-error text-xs">⚠ Fórmula inválida — verifique a sintaxe.</div>' : ''}
      </div>
    `;

    // Bind events
    container.querySelectorAll('.fb-dice-btn, .fb-op-btn, .fb-mod-btn').forEach(btn => {
      btn.addEventListener('click', () => addPart(btn.dataset.add));
    });
    container.querySelector('#fb-add-custom-dice').addEventListener('click', () => {
      const count = container.querySelector('#fb-count').value || '1';
      const sides = container.querySelector('#fb-sides').value || '6';
      addPart(`${count}d${sides}`);
    });
    container.querySelector('#fb-add-mod').addEventListener('click', () => {
      const mod = container.querySelector('#fb-modifier').value;
      if (mod) {
        addPart(mod.startsWith('-') ? mod : '+' + mod);
        container.querySelector('#fb-modifier').value = '';
      }
    });
    container.querySelector('#fb-undo').addEventListener('click', removeLast);
    container.querySelector('#fb-clear').addEventListener('click', clear);

    // Notify callback
    if (onValidCallback) onValidCallback(formula, valid);
  }

  // Permite setar uma fórmula programaticamente (ex: ao editar preset)
  function setFormula(str) {
    parts = str ? [str] : [];
    render();
  }

  window.formulaBuilder = { init, getFormula, isValid, setFormula, clear };
})();
