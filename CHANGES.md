# Arquivos incluídos nesta entrega — Rpg dos Cria v12 (Embelezamento + NPCs Avançados + Propostas Colaborativas + Undo/Redo)

Patch focado em 4 frentes pedidas pelo usuário:

1. **Embelezamento visual** de fichas, criação de itens e popup de inventário
2. **Criação colaborativa de itens** (jogador propõe → mestre aprova via WebSocket)
3. **NPCs avançados funcionais** com ilustração (desenho/upload) e stats editáveis
4. **Undo/Redo (Ctrl+Z/Ctrl+Y)** nas ferramentas de desenho

---

## ✅ Validações rodadas

- `tsc --noEmit` no worker → **zero erros**
- `node -c` em todos os JS modificados → **todos OK** (8 arquivos)
- Syntax check do script inline do `sala/index.html` → **OK**
- Validação de chaves CSS → `style.css` 1080/1080 ✓
- Cache-bust rodado → versão `?v=202607271819` aplicada em 18 HTMLs (133 substituições)

---

## 🗄️ MIGRATION

**Não há migration nova neste patch.** Os inimigos são mantidos em memória no RoomDO (persistidos via snapshots em `room_snapshots`), então estender a interface `EnemyState` com `illustrationUrl` e `stats` não exige mudança de schema D1.

As propostas de itens também ficam em memória no RoomDO (`state.itemProposals`), e quando aprovadas, persistem o item final na tabela `character_inventory_items` (criada na migration 0013 do patch anterior).

Se você ainda não rodou a migration 0013 do patch anterior, rode agora:
```bash
cd worker && npm run db:migrate:remote
```

---

## ✏️ Arquivos MODIFICADOS

### Backend (Worker)

| Caminho | Descrição |
|---------|-----------|
| `worker/src/durable-objects/RoomDO.ts` | **`EnemyState` estendida** com `illustrationUrl?` e `stats?: EnemyStat[]`. Nova interface `EnemyStat` (bar/number/text/tag_list/checkbox). Nova interface `ItemProposal`. `RoomState` ganha `itemProposals: ItemProposal[]`. `handleCreateEnemy`/`handleUpdateEnemy` aceitam `illustrationUrl` e `stats`. Novo método `sanitizeEnemyStats()` valida tipos/trunca strings. **3 novos handlers**: `handleUpdateEnemyStat` (mestre edita stat individual do inimigo inline), `handleItemProposal` (jogador propõe item → broadcast `item_proposal_received` + msg sistema no chat), `handleResolveItemProposal` (mestre aprova/rejeita → se aprovado, insere no D1 + atualiza estado + broadcast `item_proposal_resolved` + msg sistema). Estado inicial e snapshot incluem `itemProposals`. |

### Frontend — Drawers com Undo/Redo

| Caminho | Descrição |
|---------|-----------|
| `js/symbol-drawer.js` | **Refatorado com UNDO/REDO**: pilha de 25 estados `ImageData`. Botões visuais ↶ (undo) e ↷ (redo) com tooltips. Atalhos: Ctrl+Z = undo, Ctrl+Y ou Ctrl+Shift+Z = redo. Snapshot salvo após cada stroke (não durante, pra não estourar memória). Botões desabilitados (opacity 0.4) quando pilha vazia. Cabeçalho com botão ✕ para fechar. |
| `js/item-drawer.js` | **Mesmo tratamento de UNDO/REDO** do symbol-drawer. Color picker nativo mantido. Canvas 256×256. |
| `js/enemy-illustration-drawer.js` | **NOVO**. Baseado no item-drawer mas com: canvas maior (512×512), **upload de imagem** (FileReader + drawImage com object-fit:contain), paleta de cores via color picker, undo/redo com 30 estados (mais pra ilustrações complexas). Salva PNG transparente no Cloudinary. |

### Frontend — Embelezamento

| Caminho | Descrição |
|---------|-----------|
| `js/character-render.js` | `renderCharacterCard` embelezado: header com `character-header-left` (avatar + info), pills de contadores rápidos (📊 status, ⚔️ equipados, 🎒 total). Botão "Propor item" (📦) aparece só para o jogador dono do personagem. Botões de ação com tooltips. |
| `js/character-sheet-full.js` | Mantém layout compacto do v11 mas com classes CSS novas para embelezamento (gradient no header, text-fill transparente no nome, sombras nos atributos). |
| `js/room-render.js` | `renderEnemy` refatorado: suporta `illustrationUrl` (imagem 56×56 no header) e `stats[]` (seção de stats avançados com botões +/- inline para o mestre). Nova função `renderEnemyStat()` renderiza cada stat do inimigo (bar/number/text/checkbox) com edição inline. Placeholder "+ ilustração" aparece quando não há imagem (mestre vê). |
| `js/room-ws.js` | Despacha novos eventos `item_proposal_received` e `item_proposal_resolved` — guarda no estado local (`s.itemProposals`) para persistência após reconexão. |

### Frontend — Fluxo colaborativo de itens

| Caminho | Descrição |
|---------|-----------|
| `js/item-proposal.js` | **NOVO**. Gerencia 2 modais: (1) **Jogador propõe item** — form com nome, qty, equipado, descrição, ícone desenhado (usa ItemDrawer). Ao submeter, envia WS `item_proposal`. (2) **Mestre revisa propostas** — lista de propostas pendentes com ícone, nome, qty, descrição, nota opcional, botões aprovar/rejeitar. Mantém estado local (`pendingProposals`) sincronizado via WS. Atualiza badge de contagem no header. Mostra feedback ao jogador dono quando proposta é resolvida. |

### Frontend — Sala

| Caminho | Descrição |
|---------|-----------|
| `sala/index.html` | **3 novos modais**: (1) Modal de proposta de item (`#item-proposal-modal`), (2) Modal de revisão de propostas (`#item-proposals-review-modal`), (3) Modal de inimigo expandido com seção de ilustração + editor de stats avançados. **Botão "📥 Propostas"** no header da sala (mestre only) com badge pulsante de contagem. **Bindings novos**: `edit-enemy-illustration` (abre EnemyIllustrationDrawer), `enemy-stat-quick` (botões +/- nos stats de inimigo), `propose-item` (jogador abre modal de proposta). `openEnemyModal` refatorado para carregar ilustração + stats existentes. `enemy-modal-save` envia `illustrationUrl` + `stats` no payload. Expõe `window.roomClient` para item-proposal.js enviar mensagens WS. Despacha `item_proposal_received`/`item_proposal_resolved` para o módulo itemProposal. |

### CSS

| Caminho | Descrição |
|---------|-----------|
| `css/style.css` | **+470 linhas** de CSS novo: `.drawer-header`/`.drawer-toolbar`/`.drawer-tool-btn` (cabeçalho e toolbar dos drawers com undo/redo), `.character-card` embelezado (hover lift, transitions), `.char-meta-pill` (pills de contadores), `.enemy-card` com `.enemy-illustration-wrap`/`.enemy-illustration-placeholder` (ilustração de inimigo), `.enemy-stats-section`, `.enemy-modal-illustration-section`/`.enemy-modal-stats-section`/`.enemy-stats-editor`/`.enemy-stat-editor-row` (modal de inimigo expandido), `.item-proposal-form`/`.ipa-icon-section`/`.ipa-icon-preview`/`.ipa-fields` (modal de proposta), `.ipr-list`/`.ipr-card`/`.ipr-card-header`/`.ipr-item-icon`/`.ipr-card-actions`/`.ipr-note-input` (modal de revisão), `.sheet-full-compact` embelezado (gradient bg, text-fill transparente no nome, sombras), `.stat-row` embelezado (hover bg, bar fill com box-shadow glow), `.inv-modal-row` embelezado (hover bg, icon scale), `#btn-item-proposals` com badge pulsante (animação `pulse-badge`). Responsivo: em ≤480px editor de stats vira coluna, form de proposta vira coluna. |

### Cache-bust (apenas `?v=` atualizado)

| Caminho |
|---------|
| `index.html`, `admin/index.html`, `change-password/index.html`, `criar-personagem/index.html`, `criar-sala/index.html`, `edit/index.html`, `entrar-sala/index.html`, `gerenciar-sets-regras/index.html`, `gerenciar-status/index.html`, `history/index.html`, `login/index.html`, `meus-personagens/index.html`, `page/index.html`, `perfil/index.html`, `wiki/editar/index.html`, `wiki/historico/index.html`, `wiki/index.html`, `wiki/pagina/index.html` |

### Arquivos de patches anteriores (v10/v11) ainda inclusos

O `CHANGES.md` foi sobrescrito, mas os arquivos dos patches anteriores (v10: pathing/CSS wiki/breadcrumb; v11: permissões por stat/inventário popup/ficha compacta) estão inclusos neste ZIP para que o patch seja autossuficiente. Se você já aplicou v10/v11, pode ignorar esses arquivos — eles são idênticos.

---

## 📋 Lista completa de arquivos no patch

```
CHANGES.md                                                              (este arquivo)
_DELETE_ESTA_PASTA_wiki_css.txt                                         (marcador v10)
css/style.css                                                           (modificado — CSS novo v12 + v11 + v10)
css/wiki-style.css                                                      (NOVO v10 — movido de wiki/css/)
js/character-render.js                                                  (modificado — embelezamento + botão propor)
js/character-sheet-full.js                                              (modificado v11 — layout compacto)
js/enemy-illustration-drawer.js                                         (NOVO v12 — drawer com cor + undo/redo + upload)
js/item-drawer.js                                                       (modificado v12 — undo/redo)
js/item-proposal.js                                                     (NOVO v12 — fluxo colaborativo)
js/markdown.js                                                          (modificado v10 — wikilinks absolutos)
js/master-planning.js                                                   (modificado v10 — link absoluto)
js/perfil.js                                                            (modificado v10 — links absolutos)
js/room-render.js                                                       (modificado v12 — enemy com ilustração + stats)
js/room-ws.js                                                           (modificado v12 — despacha item_proposal events)
js/symbol-drawer.js                                                     (modificado v12 — undo/redo)
js/wiki/wiki-core.js                                                    (modificado v10 — URLs absolutas)
sala/index.html                                                         (modificado v12 — modais + bindings + scripts)
worker/src/durable-objects/RoomDO.ts                                    (modificado v12 — EnemyState + handlers)
worker/src/migrations/0013_stat_permissions_and_inventory_icons.sql     (NOVO v11 — incluído por segurança)
+ 18 HTMLs com cache-bust ?v=202607271819
```

**Total: 35 arquivos** (5 novos, 0 removidos, 12 modificados com features, 18 com cache-bust)

---

## 🚀 Como aplicar

1. **Backup** (recomendado): `xcopy /E /I /Y . C:\Backup\rpg-wiki-antes-v12`
2. **Descompacte** este ZIP por cima da raiz do repositório (preserva estrutura de pastas)
3. **Delete a pasta `wiki/css/`** se ainda existir (instruções no `_DELETE_ESTA_PASTA_wiki_css.txt` do v10)
4. **RODE A MIGRATION 0013** se ainda não rodou (do patch v11):
   ```bash
   cd worker && npm run db:migrate:remote
   ```
5. **Typecheck + deploy worker**:
   ```bash
   cd worker && npx tsc --noEmit && npm run deploy
   ```
6. **Deploy frontend**:
   ```bash
   git add . && git commit -m "v12: embelezamento + NPCs avançados + propostas colaborativas + undo/redo" && git push
   ```
7. **Não precisa** rodar `node scripts/cache-bust.js` (já rodado, versão `?v=202607271819`)

---

## 🧪 Verificações de sucesso (testar em produção após deploy)

### 1. Embelezamento de fichas
1. Entre numa sala e olhe a aba Personagens
2. ✅ Cards de personagem têm hover lift (eleva 2px ao passar o mouse)
3. ✅ Cada card mostra pills de contadores: `📊 5` (status), `⚔️ 2` (equipados), `🎒 7` (total itens)
4. ✅ Ficha completa (aba Personagens, se ativa) tem gradient sutil no header
5. ✅ Nome do personagem tem gradient vermelho (text-fill transparente)
6. ✅ Atributos numéricos têm hover (elevam e borda fica vermelha)
7. ✅ Barras de status têm glow (box-shadow com currentColor)

### 2. Popup de inventário embelezado
1. Clique no botão 🎒 de qualquer personagem
2. ✅ Modal abre com gradient de fundo
3. ✅ Itens têm hover (fundo mais claro)
4. ✅ Ícone do item escala 1.05x no hover
5. ✅ Form de adicionar item tem preview de ícone 56×56 com borda tracejada

### 3. Criação colaborativa de itens (jogador → mestre)
1. Como **jogador** (não mestre), entre na sala com um personagem
2. Na aba Personagens, seu card tem botão 📦 (Propor item)
3. Clique → abre modal "Propor item ao mestre"
4. Preencha: nome, qty, descrição, clique em 🎨 para desenhar ícone
5. Clique em "📤 Enviar proposta" → vê mensagem "Proposta enviada!"
6. Como **mestre** (outra aba):
   - ✅ Botão "📥 Propostas" no header tem badge amarelo pulsante com contagem
   - Clique → abre modal de revisão com a proposta pendente
   - ✅ Vê ícone, nome, qty, descrição, quem propôs, pra qual personagem
   - Pode escrever nota opcional
   - Clique em "✅ Aprovar" ou "❌ Rejeitar"
7. Como **jogador**: vê alerta "✅ Seu item X foi aprovado!" ou "❌ Seu item X foi rejeitado"
8. Se aprovado: item aparece no inventário do personagem instantaneamente

### 4. NPCs avançados com ilustração
1. Como mestre, clique em "+ Criar inimigo"
2. ✅ Modal expandido com seção de ilustração no topo
3. Clique em "🎨 Desenhar" → abre EnemyIllustrationDrawer
4. ✅ Canvas 512×512 com fundo xadrez (transparente)
5. ✅ Color picker nativo, pincel + borracha, undo/redo
6. ✅ Botão "📁 Upload" para subir imagem existente
7. Desenhe algo, clique em "💾 Usar como ilustração"
8. ✅ Preview mostra a ilustração no modal
9. Adicione stats avançados: clique em "+ Stat", preencha nome/tipo/valores
10. Salve o inimigo
11. ✅ Inimigo aparece na aba Inimigos com ilustração 56×56 no header
12. ✅ Stats avançados aparecem abaixo do HP com botões +/- (editáveis inline)

### 5. Undo/Redo nos drawers
1. Abra qualquer drawer (símbolo, ícone de item, ilustração de inimigo)
2. Desenhe algumas pinceladas
3. ✅ Botão ↶ (undo) fica habilitado
4. Clique em ↶ → última pincelada desaparece
5. ✅ Botão ↷ (redo) fica habilitado
6. Clique em ↷ → pincelada volta
7. **Atalhos de teclado**:
   - Ctrl+Z → undo
   - Ctrl+Y ou Ctrl+Shift+Z → redo
8. ✅ Botões desabilitados (opacity 0.4) quando pilha vazia
9. Limite de 25-30 estados (dependendo do drawer)

### 6. Funcionalidades existentes não quebradas
1. ✅ Wiki carrega normalmente
2. ✅ Chat da sala funciona
3. ✅ Dados rolam
4. ✅ Enquetes, trocas, compras funcionam
5. ✅ Permissões por stat do v11 continuam funcionando (🔒/🔓)
6. ✅ Delete de stat do v11 continua funcionando

---

## 📌 Notas técnicas

- **Sem migration nova**: inimigos e propostas vivem na memória do RoomDO. Quando o mestre aprova uma proposta, o item é persistido na tabela `character_inventory_items` (migration 0013 do v11).
- **Undo/Redo usa ImageData**: cada snapshot é um `ctx.getImageData()` do canvas inteiro. Com 25-30 estados e canvas de 256-512px, isso consome ~2-8 MB de RAM — aceitável. Se precisar economizar, pode-se usar `canvas.toDataURL()` (mais lento mas menor em memória).
- **Atalhos de teclado**: o listener é registrado no `document` quando o drawer abre e removido quando fecha. Verifica se o overlay ainda está no DOM a cada keypress (evita handler órfão).
- **Item proposals são broadcast**: todos recebem `item_proposal_received`, mas só o mestre vê a notificação (badge). O jogador que propôs vê "aguardando aprovação". Quando resolvida, só o dono da proposta recebe feedback visual (além do chat de sistema).
- **Ilustração de inimigo**: o drawer tem upload de imagem além do desenho. A imagem é ajustada com `object-fit: contain` (mantém proporção, centralizada).
- **Stats de inimigo inline**: os botões +/- nos stats de inimigo enviam `update_enemy_stat` via WS, que atualiza o estado e faz broadcast. Todos veem a mudança em tempo real.
- **Preserva v10/v11**: este patch inclui todos os arquivos dos patches anteriores para ser autossuficiente. Se você já aplicou v10/v11, os arquivos são idênticos (pode sobrescrever sem medo).

---

## 🐛 Possíveis problemas (se algo quebrar)

1. **Erro 500 no worker**: verifique se a migration 0013 rodou. Rode `npx wrangler d1 execute rpg-wiki-db --remote --command "SELECT name FROM sqlite_master WHERE name='character_inventory_items'"` — deve retornar a tabela.
2. **Botão "Propor item" não aparece**: só aparece para o jogador dono do personagem (não mestre). Verifique se você está logado como jogador comum e conectado com um personagem.
3. **Undo/Redo não funciona**: verifique no DevTools se não há erro de JavaScript. O listener de keydown é registrado no `document`, então deve funcionar mesmo com foco no canvas.
4. **Ilustração de inimigo não salva**: verifique no DevTools → Network se o upload para Cloudinary retornou 200. Se retornou, o URL deve estar no payload do `create_enemy`/`update_enemy`.
5. **Propostas não chegam ao mestre**: verifique se ambos estão na mesma sala. O broadcast é pra todos, então o mestre deve receber. Se não recebeu, pode ser rate limit (1 msg / 300ms).
