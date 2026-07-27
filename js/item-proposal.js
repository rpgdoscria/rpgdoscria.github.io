// frontend/js/item-proposal.js — fluxo colaborativo de criação de itens
//
// v12: NOVO. Jogador propõe item → mestre aprova/rejeita.
//
// Funcionamento:
//   - Jogador abre modal "Propor item" (botão na ficha do próprio personagem)
//   - Preenche nome, qty, descrição, equipado, e pode desenhar ícone
//   - Ao submeter, envia WS "item_proposal" → mestre recebe "item_proposal_received"
//   - Mestre vê notificação (badge) e pode abrir modal de revisão
//   - Em revisão, mestre vê lista de propostas pendentes e aprova/rejeita cada uma
//   - Ao aprovar, item é adicionado ao inventário do personagem (persiste no D1)
//   - Jogador recebe "item_proposal_resolved" com feedback

(function () {
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }
  function sanitizeText(s) {
    if (!window.DOMPurify) return escapeHtml(s);
    return escapeHtml(window.DOMPurify.sanitize(String(s ?? ""), { ALLOWED_TAGS: [] }));
  }

  // Estado local: lista de propostas pendentes (sincronizada via WS)
  let pendingProposals = [];
  let resolvedProposals = [];  // últimas resolvidas (pra feedback)
  let currentEditingIconUrl = null;

  // ===== Modal: Jogador propõe item =====
  function openProposalModal() {
    const modal = document.getElementById("item-proposal-modal");
    if (!modal) return;
    currentEditingIconUrl = null;
    document.getElementById("ipa-name").value = "";
    document.getElementById("ipa-qty").value = "1";
    document.getElementById("ipa-equipped").value = "0";
    document.getElementById("ipa-desc").value = "";
    document.getElementById("item-proposal-alert").innerHTML = "";
    const preview = document.getElementById("ipa-icon-preview");
    preview.innerHTML = `<span class="muted text-xs">sem ícone</span>`;
    modal.classList.remove("hidden");
  }

  function closeProposalModal() {
    const modal = document.getElementById("item-proposal-modal");
    if (modal) modal.classList.add("hidden");
  }

  // ===== Modal: Mestre revisa propostas =====
  function openReviewModal() {
    const modal = document.getElementById("item-proposals-review-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    renderProposalsList();
  }

  function closeReviewModal() {
    const modal = document.getElementById("item-proposals-review-modal");
    if (modal) modal.classList.add("hidden");
  }

  function renderProposalsList() {
    const listEl = document.getElementById("ipr-list");
    if (!listEl) return;
    if (pendingProposals.length === 0) {
      listEl.innerHTML = `<div class="muted text-sm" style="padding:24px;text-align:center">Nenhuma proposta pendente.</div>`;
      return;
    }
    listEl.innerHTML = pendingProposals.map(p => {
      const iconHtml = p.item.iconUrl
        ? `<img src="${escapeHtml(p.item.iconUrl)}" alt="${escapeHtml(p.item.name)}" class="ipr-item-icon">`
        : `<div class="ipr-item-icon-placeholder">${escapeHtml((p.item.name || "?").charAt(0).toUpperCase())}</div>`;
      return `
        <div class="ipr-card" data-proposal-id="${escapeHtml(p.id)}">
          <div class="ipr-card-header">
            ${iconHtml}
            <div class="ipr-card-info">
              <div class="ipr-card-name">${escapeHtml(p.item.name)} <span class="ipr-card-qty">×${p.item.qty}</span></div>
              <div class="ipr-card-meta muted text-xs">
                por ${escapeHtml(p.fromUsername)} · pra ${escapeHtml(p.characterName)}
                ${p.item.equipped ? " · ⚔️ equipado" : ""}
              </div>
              ${p.item.description ? `<div class="ipr-card-desc muted text-xs">${sanitizeText(p.item.description)}</div>` : ""}
            </div>
          </div>
          <div class="ipr-card-actions">
            <input type="text" class="ipr-note-input" placeholder="Nota (opcional)…" maxlength="200" data-proposal-id="${escapeHtml(p.id)}">
            <button class="btn btn-sm btn-ghost" data-action="reject-proposal" data-proposal-id="${escapeHtml(p.id)}">❌ Rejeitar</button>
            <button class="btn btn-sm btn-primary" data-action="approve-proposal" data-proposal-id="${escapeHtml(p.id)}">✅ Aprovar</button>
          </div>
        </div>
      `;
    }).join("");

    // Bind botões
    listEl.querySelectorAll('button[data-action="approve-proposal"]').forEach(b => {
      b.addEventListener("click", () => {
        const proposalId = b.dataset.proposalId;
        const noteInput = listEl.querySelector(`input.ipr-note-input[data-proposal-id="${proposalId}"]`);
        const note = noteInput?.value?.trim() || "";
        // client é global em sala/index.html
        if (window.roomClient) {
          window.roomClient.send("resolve_item_proposal", { proposalId, approved: true, note });
        }
      });
    });
    listEl.querySelectorAll('button[data-action="reject-proposal"]').forEach(b => {
      b.addEventListener("click", () => {
        const proposalId = b.dataset.proposalId;
        const noteInput = listEl.querySelector(`input.ipr-note-input[data-proposal-id="${proposalId}"]`);
        const note = noteInput?.value?.trim() || "";
        if (window.roomClient) {
          window.roomClient.send("resolve_item_proposal", { proposalId, approved: false, note });
        }
      });
    });
  }

  // ===== Handlers de eventos WS (chamados pela sala) =====
  function handleProposalReceived(proposal) {
    pendingProposals.push(proposal);
    if (pendingProposals.length > 30) pendingProposals.shift();
    updateProposalBadge();
    // Se o modal de revisão estiver aberto, re-renderiza
    const reviewModal = document.getElementById("item-proposals-review-modal");
    if (reviewModal && !reviewModal.classList.contains("hidden")) {
      renderProposalsList();
    }
  }

  function handleProposalResolved(proposal) {
    // Remove de pending
    pendingProposals = pendingProposals.filter(p => p.id !== proposal.id);
    resolvedProposals.push(proposal);
    if (resolvedProposals.length > 10) resolvedProposals.shift();
    updateProposalBadge();
    // Re-renderiza se modal aberto
    const reviewModal = document.getElementById("item-proposals-review-modal");
    if (reviewModal && !reviewModal.classList.contains("hidden")) {
      renderProposalsList();
    }
    // Mostra feedback ao jogador dono da proposta
    const sess = window.auth?.currentSession?.();
    if (sess && proposal.fromUserId === sess.user.id) {
      const msg = proposal.status === "approved"
        ? `✅ Seu item "${proposal.item.name}" foi aprovado pelo mestre!`
        : `❌ Seu item "${proposal.item.name}" foi rejeitado${proposal.masterNote ? `: ${proposal.masterNote}` : ""}.`;
      const alertMount = document.getElementById("alert-mount");
      if (alertMount) {
        alertMount.innerHTML = `<div class="alert alert-${proposal.status === "approved" ? "success" : "warning"}">${escapeHtml(msg)}</div>`;
        setTimeout(() => { alertMount.innerHTML = ""; }, 5000);
      }
    }
  }

  function updateProposalBadge() {
    const badge = document.getElementById("item-proposals-badge");
    if (badge) {
      const count = pendingProposals.length;
      badge.textContent = String(count);
      badge.style.display = count > 0 ? "inline-block" : "none";
    }
  }

  // ===== Init: bind dos elementos do modal =====
  function init() {
    // Botão "fechar" do modal de proposta
    const closeBtn = document.getElementById("item-proposal-close");
    if (closeBtn) closeBtn.addEventListener("click", closeProposalModal);
    const cancelBtn = document.getElementById("item-proposal-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", closeProposalModal);

    // Clique fora fecha
    const proposalModal = document.getElementById("item-proposal-modal");
    if (proposalModal) {
      proposalModal.addEventListener("click", (e) => {
        if (e.target === proposalModal) closeProposalModal();
      });
    }

    // Botão "desenhar ícone"
    const drawBtn = document.getElementById("ipa-draw-icon");
    const preview = document.getElementById("ipa-icon-preview");
    function openIconDrawer() {
      window.ItemDrawer.open((iconUrl) => {
        currentEditingIconUrl = iconUrl;
        if (preview) {
          preview.innerHTML = `<img src="${escapeHtml(iconUrl)}" alt="ícone" style="width:100%;height:100%;object-fit:contain">`;
        }
      });
    }
    if (drawBtn) drawBtn.addEventListener("click", openIconDrawer);
    if (preview) preview.addEventListener("click", openIconDrawer);

    // Submit proposta
    const submitBtn = document.getElementById("item-proposal-submit");
    if (submitBtn) {
      submitBtn.addEventListener("click", () => {
        const name = document.getElementById("ipa-name").value.trim();
        const qty = parseInt(document.getElementById("ipa-qty").value, 10) || 1;
        const equipped = document.getElementById("ipa-equipped").value === "1";
        const description = document.getElementById("ipa-desc").value.trim();
        const alertEl = document.getElementById("item-proposal-alert");
        if (!name) {
          alertEl.innerHTML = `<div class="alert alert-error">Nome é obrigatório.</div>`;
          return;
        }
        if (!window.roomClient) {
          alertEl.innerHTML = `<div class="alert alert-error">Cliente WS não disponível.</div>`;
          return;
        }
        window.roomClient.send("item_proposal", {
          item: { name, qty, equipped, description, iconUrl: currentEditingIconUrl },
        });
        alertEl.innerHTML = `<div class="alert alert-success">📤 Proposta enviada! Aguarde o mestre aprovar.</div>`;
        setTimeout(closeProposalModal, 1500);
      });
    }

    // Modal de revisão (mestre)
    const iprClose = document.getElementById("ipr-close");
    if (iprClose) iprClose.addEventListener("click", closeReviewModal);
    const reviewModal = document.getElementById("item-proposals-review-modal");
    if (reviewModal) {
      reviewModal.addEventListener("click", (e) => {
        if (e.target === reviewModal) closeReviewModal();
      });
    }
  }

  // Inicializa quando o DOM estiver pronto
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.itemProposal = {
    openProposalModal,
    openReviewModal,
    handleProposalReceived,
    handleProposalResolved,
    getPendingCount: () => pendingProposals.length,
  };
})();
