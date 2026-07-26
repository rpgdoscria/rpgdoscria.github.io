// frontend/js/dice-tutorial.js — modal de ajuda/tutorial de notação de dados

(function () {
  function openTutorial() {
    const existing = document.getElementById("dice-tutorial-overlay");
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement("div");
    overlay.id = "dice-tutorial-overlay";
    overlay.className = "dice-help-modal";
    overlay.innerHTML = `
      <div class="dice-help-card">
        <h3>🎲 Como escrever fórmulas de dados</h3>
        <table>
          <tr><th>Notação</th><th>Significado</th><th>Exemplo</th></tr>
          <tr><td><code>NdS</code></td><td>N dados de S lados</td><td><code>2d6</code> = rola 2 dados de 6</td></tr>
          <tr><td><code>+X</code> / <code>-X</code></td><td>Modificador fixo</td><td><code>1d20+5</code> = d20 mais 5</td></tr>
          <tr><td><code>A+B+C</code></td><td>Múltiplos termos</td><td><code>1d20+2d6+3</code></td></tr>
          <tr><td><code>NdSkhK</code></td><td>Mantém os K maiores</td><td><code>2d20kh1</code> = vantagem</td></tr>
          <tr><td><code>NdSklK</code></td><td>Mantém os K menores</td><td><code>2d20kl1</code> = desvantagem</td></tr>
          <tr><td><code>NdSdlK</code></td><td>Descarta os K menores</td><td><code>4d6dl1</code> = atributos</td></tr>
          <tr><td><code>NdSdhK</code></td><td>Descarta os K maiores</td><td><code>4d6dh1</code></td></tr>
        </table>
        <p class="text-sm muted mt-4">💡 Dicas:</p>
        <ul class="text-sm muted" style="padding-left:20px;line-height:1.6">
          <li>S pode ser qualquer número (d13, d100, d7...) — é um sistema homebrew!</li>
          <li>Use letras minúsculas ou maiúsculas: <code>1D20</code> = <code>1d20</code></li>
          <li>Espaços são ignorados: <code>1d20 + 5</code> funciona</li>
          <li>Jogadores podem sugerir fórmulas ao mestre — só ele rola</li>
        </ul>
        <div style="text-align:right;margin-top:16px">
          <button class="btn btn-primary" onclick="document.getElementById('dice-tutorial-overlay').remove()">Entendi!</button>
        </div>
      </div>
    `;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  window.diceTutorial = { open: openTutorial };
})();
