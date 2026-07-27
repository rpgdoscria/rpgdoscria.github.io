// frontend/js/master-planning.js — aba de planejamento privado do mestre
//
// Carrega do backend (GET /api/rooms/:code/planning) e salva automaticamente
// (PUT /api/rooms/:code/planning/:section) com debounce de 1s.
// Apenas o mestre vê esta aba — o sala.html controla a visibilidade.

(function () {
  let initialized = false;
  let roomCode = null;
  const DEBOUNCE_MS = 1000;
  const timers = {};

  async function init(code) {
    if (initialized) return;
    roomCode = code;
    initialized = true;

    // Carrega estado atual
    try {
      const data = await window.api.get(`/api/rooms/${encodeURIComponent(code)}/planning`);
      const planning = data.planning || {};
      const notesEl = document.getElementById("planning-notes");
      const enemiesEl = document.getElementById("planning-enemies");
      const scenariosEl = document.getElementById("planning-scenarios");
      if (notesEl) notesEl.value = planning.notes || "";
      if (enemiesEl) enemiesEl.value = planning.enemies || "";
      if (scenariosEl) scenariosEl.value = planning.scenarios || "";
      ["notes", "enemies", "scenarios"].forEach(s => updateStatus(s, "carregado ✓"));
    } catch (e) {
      console.warn("master-planning: erro ao carregar:", e);
    }

    // Bind autosave
    ["notes", "enemies", "scenarios"].forEach(section => {
      const el = document.getElementById(`planning-${section}`);
      if (!el) return;
      el.addEventListener("input", () => scheduleSave(section, el.value));
      el.addEventListener("change", () => scheduleSave(section, el.value, true));
    });
  }

  function scheduleSave(section, content, immediate = false) {
    if (timers[section]) clearTimeout(timers[section]);
    const delay = immediate ? 0 : DEBOUNCE_MS;
    updateStatus(section, "salvando…");
    timers[section] = setTimeout(async () => {
      try {
        await window.api.put(
          `/api/rooms/${encodeURIComponent(roomCode)}/planning/${section}`,
          { content }
        );
        updateStatus(section, "salvo ✓");
      } catch (e) {
        updateStatus(section, "erro ao salvar");
        console.warn(`master-planning: erro ao salvar ${section}:`, e);
      }
    }, delay);
  }

  function updateStatus(section, msg) {
    const el = document.getElementById(`planning-${section}-status`);
    if (el) {
      el.textContent = msg;
      const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      el.textContent = `${msg} · ${now}`;
    }
  }

  window.masterPlanning = { init };
})();
