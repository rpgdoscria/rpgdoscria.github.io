# Arquivos incluídos nesta entrega — Rpg dos Cria v5

Pacote com todas as 9 tarefas do prompt final, incluindo as **novidades desta versão**: header com dropdowns categorizados, fontes melhoradas (Poppins), mini-wiki mostrando apenas páginas secretas, e inimigos pré-prontos com 2 modos (básico/avançado).

---

## ✅ Validações rodadas

- `tsc --noEmit` no worker → **zero erros**
- `node -c` em todos os JS files → **todos OK**
- Inline `<script>` do `sala.html` → **OK**
- Cache-bust rodado → 19 HTMLs, versão `?v=202607271242`

---

## 🆕 Arquivos NOVOS

| Caminho | Descrição |
|---------|-----------|
| `perfil.html` | **(Tarefa 7)** Dashboard pessoal pós-login. |
| `js/perfil.js` | **(Tarefa 7)** Lógica do perfil. |
| `js/symbol-drawer.js` | **(Tarefa 8)** Canvas para desenhar símbolo **branco sobre transparente** (sem paleta de cores). Borracha usa `globalCompositeOperation = "destination-out"` para apagar à transparência. Exporta PNG com alpha. |
| `js/master-planning.js` | **(Tarefa 6)** Aba Planejamento com 3 sub-abas: Anotações, Inimigos pré-prontos (2 modos: básico/avançado), Mini-wiki secreta. Inimigos avançados podem usar `rule_sets`. |
| `worker/src/migrations/0009_rooms_permanence.sql` | **(Tarefa 2)** Tabela `rooms` (code, name, master_user_id, created_at, ended_at, is_active, last_activity). |
| `worker/src/migrations/0010_planning_and_colors.sql` | **(Tarefas 4, 6)** Coluna `color` em `session_participants`; tabela `master_planning`. |
| `worker/src/migrations/0011_character_symbol.sql` | **(Tarefa 8)** Coluna `symbol_url` em `characters`. |
| `CHANGES.md` | Este arquivo. |

---

## ✏️ Arquivos MODIFICADOS (destaques v5)

### 🔥 NOVIDADES v5 (não estavam na v4)

| Caminho | Descrição da mudança |
|---------|----------------------|
| `js/auth.js` | **(Tarefa 1 — REFEITA)** `renderHeader()` agora gera menu dropdown categorizado: Wiki, Personagens, Salas, Admin (se admin). Cada categoria tem botão + dropdown com sub-itens. Hover abre no desktop, click toggle no mobile. `mountHeader()` adiciona listeners para abrir/fechar dropdowns, fechamento ao clicar fora, e menu hamburguer para mobile (<768px). user-chip e botão logout ficam sempre visíveis fora dos dropdowns. |
| `css/style.css` | **(Tarefa 1 — fontes)** Variável `--font-serif` trocada de `'Lora', Georgia, serif` para `'Poppins', 'Inter', sans-serif` (mais moderna). Nova variável `--font-display: 'Poppins', sans-serif` para títulos. **(Tarefa 1 — header refeito)** ~180 linhas de CSS novo: `.nav-hamburger` (3 linhas que viram X), `.site-nav`/`.nav-menu`/`.nav-cat`/`.nav-cat-btn`/`.nav-caret`/`.nav-dropdown` com hover/click states. **(Tarefa 9 — responsividade)** Media query `@media (max-width: 768px)` refeita: nav vira menu lateral slide-in (translateX), dropdowns viram acordeão vertical, busca esconde no mobile, user-chip com ellipsis. `@media (min-width: 769px)` garante nav sempre visível no desktop. **(Tarefa 6)** CSS para `.planning-enemy-card` (cards de inimigos pré-prontos). Regra global `h1, h2, h3, .brand, .modal-card h3, .planning-section h4 { font-family: var(--font-display) }` aplica Poppins a todos os títulos. |
| `js/master-planning.js` | **(Tarefa 6 — mini-wiki SÓ secretas)** `loadWikiList()` agora chama `/api/pages/secrets/list` (em vez de `/api/pages`) — só retorna páginas com `secret=1`. `openWikiEditor()` cria páginas com `secret=true` sempre (checkbox `checked disabled`). **(Tarefa 6 — inimigos 2 modos)** Novas funções: `loadRuleSets()`, `loadEnemiesList()`, `saveEnemiesList()`, `launchEnemy(i)`, `openEnemyEditor(editIdx, presetMode)`, `bindEnemyButtons()`. Inimigos armazenados como JSON no `master_planning.scenarios` (section reaproveitada). Modo básico: nome + HP (numérico ou qualitativo) + notas. Modo avançado: nome + set de regras + notas de NPC + HP. Botão "🚀 Lançar na sala" envia `create_enemy` via WS. |
| `sala.html` | **(Tarefa 6)** Sub-aba "Inimigos pré-prontos" reformulada: agora tem 2 botões (+ Inimigo básico / + NPC avançado), lista de cards com botões Lançar/Editar/Excluir, e textarea livre como backup. Sub-aba "Mini-wiki" mantida. Cache-bust `?v=202607271242`. |
| 19 HTMLs (raiz + wiki) | **(Tarefa 1 — fontes)** Google Fonts trocado de `family=Lora:wght@400;600;700` para `family=Poppins:wght@400;500;600;700` em todos os `<link>` do head. Cache-bust `?v=202607271242` aplicado. |

### Já implementados na v4 (mantidos)

| Caminho | Descrição |
|---------|-----------|
| `worker/src/durable-objects/RoomDO.ts` | Handlers WS: `set_player_color`, `set_level_up_points`, `distribute_level_points`, `respond_trade` (com contraproposta), `respond_purchase`, `reveal_document`. Estado `participantColors`, `name`. |
| `worker/src/routes/rooms.ts` | `POST /api/rooms` com idempotência (30s mesmo nome) + campo `name` + persiste em tabela `rooms`. `GET /api/rooms` lê de `rooms`. `DELETE /:code` exclui definitivo. `GET/PUT /:code/planning/:section`. |
| `worker/src/routes/characters.ts` | Suporte a `symbolUrl` em GET/POST/PUT. |
| `worker/src/routes/pages.ts` | `GET /api/pages` inclui `secret` e `revealed` na listagem. |
| `js/room-chat.js` | Bolhas com avatar colorido, nome colorido, auto-scroll inteligente, `setParticipantColors(map)`. |
| `js/room-ws.js` | **Bug crítico corrigido**: `_applyIncremental` agora adiciona `chat_message` ao `s.chatLog` (antes `renderHistory` apagava a bolha recém-adicionada — bug "precisa F5"). Também `player_color_set`. |
| `js/character-form.js` | Campo "Símbolo" separado da foto. `getSymbolUrl()`, `symbolUrl` no payload, carrega do banco em edição. |
| `js/character-render.js` | `renderAvatar()` sobrepõe miniatura do símbolo (PNG branco transparente) no canto do avatar. |
| `js/config.js` | `API_BASE` dinâmico (meta tag / hostname / fallback). |
| `criar-sala.html` | Campo "Nome da sala" obrigatório + `createInFlight` + idempotência backend. |
| `entrar-sala.html` | Color picker (8 swatches + input custom). |
| `criar-personagem.html` | `<script src="js/symbol-drawer.js">`. |
| `index.html` | Card "Meu perfil" no topo. |

---

## 🐛 Bug crítico corrigido (mantido da v4)

**Sintoma:** Chat não atualizava em tempo real — precisava de F5.

**Causa:** `_applyIncremental` em `room-ws.js` não adicionava `chat_message` ao `s.chatLog`. Quando `onStateChange` chamava `renderHistory(state.chatLog)`, limpava o container e re-renderizava sem a mensagem nova — apagando a bolha que `onEvent` acabou de adicionar.

**Fix:** Case `chat_message` agora faz `s.chatLog.push(msg.payload)`.

---

## 🗑️ Arquivos a DELETAR manualmente (não inclusos no pacote)

4 arquivos órfãos em `worker/src/` com imports quebrados:

```cmd
cd C:\caminho\para\rpgdoscria.github.io\worker\src
if exist RoomDO.ts del RoomDO.ts
if exist characters.ts del characters.ts
if exist rule-sets.ts del rule-sets.ts
if exist 0006_rule_sets_and_chat.sql del 0006_rule_sets_and_chat.sql
```

---

## 🚀 Como aplicar

1. **Backup**: `git stash` ou `xcopy /E /I /Y . C:\Backup\rpg-wiki-antes-v5`
2. **Delete os 4 arquivos órfãos** acima
3. **Descompacte** este ZIP por cima da raiz
4. **Rode as 3 migrations** novas:
   ```cmd
   cd worker && npm run db:migrate:remote
   ```
5. **Typecheck + deploy worker**:
   ```cmd
   cd worker && npx tsc --noEmit && npm run deploy
   ```
6. **Deploy frontend**:
   ```cmd
   git add . && git commit -m "v5: header dropdown, fontes Poppins, mini-wiki só secretas, inimigos 2 modos" && git push
   ```

---

## 🧪 Verificações de sucesso

1. **Header**: dropdowns funcionais (Wiki, Personagens, Salas, Admin) — sem textos quebrados. Em mobile, menu hamburguer abre nav lateral.
2. **Fontes**: títulos em Poppins (mais modernos), corpo em Inter.
3. **Salas permanentes**: criação com nome obrigatório, sem duplicação, aparece no perfil do mestre.
4. **Chat tempo real**: mensagens aparecem instantaneamente (sem F5), com foto, nome colorido e balão.
5. **Cor do jogador**: escolhida ao entrar ou trocada durante sessão — refletida em chat e cards.
6. **Dado visual**: gradiente 3D, glow, bounce.
7. **Aba Planejamento** (mestre): 3 sub-abas — Anotações (autosave), Inimigos (básico/avançado com sets de regras + botão Lançar), Mini-wiki (só páginas secretas, criar/editar).
8. **Perfil**: dashboard com personagens, edições wiki, salas.
9. **Símbolo**: desenhar branco sobre transparente, salva como `symbol_url`, aparece no avatar.
10. **Responsividade**: zoom 90-125% e DevTools não quebram layout; mobile reorganiza.

---

## 📋 Resumo do pacote

- **Total de arquivos**: 37 (8 novos + 29 modificados)
- **Migrations novas**: 3 (`0009`, `0010`, `0011`)
- **Destaques v5**: header dropdown categorizado + fontes Poppins + mini-wiki só secretas + inimigos 2 modos
- **Validações**: TypeScript zero erros, JS sem erros, inline OK
