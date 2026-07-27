# Arquivos incluídos nesta entrega — Rpg dos Cria v3

Pacote com 7 novas funcionalidades + correções de bugs. Estrutura de pastas preservada relativa à raiz do projeto. Aplique descompactando por cima do repositório local.

---

## ✅ Validações rodadas antes do empacotamento

- `tsc --noEmit` no worker → **zero erros**
- `node -c` em todos os 26 JS files → **todos OK**
- Inline `<script>` do `sala.html` (46KB) extraído e validado → **OK**
- `wrangler deploy --dry-run` (com wrangler+hono+types limpos) → **PASSOU** (236KB / 51KB gzip, bindings D1+Durable Objects detectados)
- Cache-bust rodado → 19 arquivos, 135 substituições, versão `?v=202607271115`

---

## 🆕 Arquivos NOVOS

| Caminho | Descrição |
|---------|-----------|
| `perfil.html` | **(Tarefa 6)** Página de dashboard pessoal após login. Mostra personagens do usuário (mini cards com foto), 5 últimas edições na wiki, e (para mestres) salas ativas/encerradas. Layout responsivo em grid. |
| `js/perfil.js` | **(Tarefa 6)** Lógica do perfil — carrega em paralelo `/api/characters`, `/api/pages`, `/api/rooms` (se mestre) e renderiza os cards. Sem novos endpoints no backend. |
| `js/symbol-drawer.js` | **(Tarefa 7)** Componente canvas para desenhar símbolo do personagem. Pincel, borracha, paleta de 12 cores + input color custom, tamanho ajustável (2-40px), cor de fundo, limpar canvas. Mouse + touch. Salva como PNG via `/api/upload` (mesmo fluxo da foto). Implementação do zero com Canvas API (sem bibliotecas externas). |
| `js/master-planning.js` | **(Tarefa 5)** Lógica da aba Planejamento do mestre. Carrega do `GET /api/rooms/:code/planning`, salva automaticamente com debounce 1s no `PUT /api/rooms/:code/planning/:section`. Status visual ("salvando…", "salvo ✓"). |
| `worker/src/migrations/0009_rooms_permanence.sql` | **(Tarefa 1)** Cria tabela `rooms` com colunas `code`, `name`, `master_user_id`, `created_at`, `ended_at`, `is_active`, `last_activity`. Substitui a inferência por snapshots — agora a sala é persistente. |
| `worker/src/migrations/0010_planning_and_colors.sql` | **(Tarefas 4 e 5)** Adiciona coluna `color` em `session_participants` (persiste cor do jogador entre reconexões) e cria tabela `master_planning` com campos `room_code`, `user_id`, `section` (notes/enemies/scenarios), `content`, `updated_at`. |
| `CHANGES.md` | Este arquivo — lista de mudanças. |

---

## ✏️ Arquivos MODIFICADOS

### Backend (Worker)

| Caminho | Descrição da mudança |
|---------|----------------------|
| `worker/src/durable-objects/RoomDO.ts` | **(Tarefas 1, 4, 5)** Adicionado campo `name` e `participantColors: Record<number, ParticipantInfo>` em `RoomState`. `handleInit` agora recebe `roomName` da query string. Novo handler `set_player_color` (Tarefa 4) — valida hex `#rrggbb`, atualiza Connection.color e `participantColors[userId]`, persiste em `session_participants.color` (D1), broadcast `player_color_set`. `publicState` agora inclui `name`, `participantColors` e `you.color`. `restoreFromSnapshot` adiciona compat para snapshots antigos (inicializa `participantColors` e `name` se faltarem). Interface `ParticipantInfo` e `Connection.color` adicionadas. |
| `worker/src/routes/rooms.ts` | **(Tarefas 1, 5)** `POST /api/rooms` agora: (1) aceita campo `name` no body, (2) implementa **idempotência** — se o mestre já tem sala ativa criada nos últimos 30s com o mesmo nome, retorna aquela em vez de criar outra (proteção contra duplo clique), (3) persiste na tabela `rooms` (migration 0009), (4) gera código verificando unicidade em `rooms` (não mais em snapshots). `GET /api/rooms` agora lê da tabela `rooms` (ativas E inativas) em vez de inferir dos snapshots. `GET /:code/status` agora lê da tabela `rooms` primeiro (com fallback pra snapshots antigos). `POST /:code/end` marca `is_active=0` em `rooms` (sala permanece, não é deletada). **NOVO** `DELETE /:code` — exclui sala definitivamente (só mestre criador; remove rooms + snapshots + chat + polls + trades + purchases + session_participants + master_planning). **NOVOS** `GET /:code/planning` e `PUT /:code/planning/:section` (Tarefa 5) — só mestre acessa; upsert na tabela `master_planning`. |

### Frontend — HTML

| Caminho | Descrição da mudança |
|---------|----------------------|
| `sala.html` | **(Tarefas 1, 2, 4, 5)** Adicionada aba "Planejamento" (mestre only) com 3 seções (anotações, inimigos pré-prontos, cenários). `showRoomScreen` agora mostra `name` da sala no título e no `<title>` do navegador. Inicializa `masterPlanning.init(code)` quando mestre conecta. `onStateChange` enriquece `participantColors` com `characterName`/`photoUrl` dos personagens na sala e sincroniza com `roomChat.setParticipantColors()`. Ao receber primeiro `room_state`, jogador envia `set_player_color` com cor do `sessionStorage` (ou cor aleatória baseada em userId). Badge de papel (MESTRE/JOGADOR) agora é clicável para jogador trocar cor durante a sessão (abre color picker nativo). Adicionado `<script src="js/master-planning.js">`. Cache-bust `?v=202607271115` aplicado. |
| `criar-sala.html` | **(Tarefa 1)** Adicionado campo obrigatório "Nome da sala" no topo. Botão "Criar sala" só habilita quando nome é preenchido. **Proteção contra duplo clique**: flag `createInFlight` no JS + idempotência no backend (30s). Lista de salas existentes agora mostra nome, status (ativa/encerrada), data de criação. Salas encerradas têm botão "Excluir" (chama `DELETE /api/rooms/:code`). Salas ativas têm "Reabrir", "Copiar link", "Encerrar". |
| `entrar-sala.html` | **(Tarefa 4)** Adicionado color picker: 8 cores predefinidas (swatches circulares) + input color customizado. Cor selecionada é guardada em `sessionStorage` (`rpg_player_color`) antes de redirecionar para `sala.html`. Display da cor atual em tempo real. |
| `criar-personagem.html` | **(Tarefa 7)** Adicionado `<script src="js/symbol-drawer.js">` antes do `character-form.js`. |
| `index.html` | **(Tarefa 6)** Adicionado card "Meu perfil" no topo dos quick-access cards (link para `perfil.html`). |
| `perfil.html` | (já listado em NOVOS) |
| `admin.html`, `change-password.html`, `edit.html`, `gerenciar-sets-regras.html`, `gerenciar-status.html`, `history.html`, `login.html`, `meus-personagens.html`, `page.html`, `wiki/editar.html`, `wiki/historico.html`, `wiki/index.html`, `wiki/pagina.html` | Apenas atualização do `?v=` para `?v=202607271115` (cache-bust). Sem mudanças de lógica. |

### Frontend — CSS

| Caminho | Descrição da mudança |
|---------|----------------------|
| `css/style.css` | **(Tarefas 2, 3, 4, 5, 6, 7)** Adicionadas ~480 linhas no final: **Tarefa 4** (`.color-picker-row`, `.color-swatch` com estados hover/selected); **Tarefa 2** (`.chat-bubble-row` com layout flex, `.chat-bubble-avatar` circular com borda colorida, `.chat-bubble-content`, `.chat-bubble-sender` colorido, `.chat-bubble` com fundo colorido pra self / surface pra others, `.chat-bubble-system` diferenciado em itálico); **Tarefa 3** (`.dice-visual-bar` com gradiente + blur + sombra interna/externa, `.dice-visual-die` com gradiente 3D + sombras internas + transição bounce, `.dice-visual-die.settled` com glow vermelho, `@keyframes dice-number-glow` para brilho do número final, `@keyframes dice-total-pop` para pop do total, `.dice-visual-die-count` badge com sombra); **Tarefa 5** (`.planning-section`, `.planning-textarea`, `.planning-save-status`, `.planning-enemy-card`); **Tarefa 6** (`.perfil-grid`, `.perfil-card`, `.perfil-char-mini` com avatar, `.perfil-list-item`, `.perfil-room-row` com estado inativo); **Tarefa 7** (`.symbol-drawer-overlay` modal, `.symbol-drawer-card`, `.symbol-drawer-canvas-wrap` com fundo xadrez transparente, `.symbol-drawer-tools`, `.symbol-drawer-color-palette`). |

### Frontend — JS

| Caminho | Descrição da mudança |
|---------|----------------------|
| `js/auth.js` | **(Tarefa 6)** `redirectToNext()` agora redireciona para `perfil.html` (em vez de `index.html`) após login quando não há `?next=`. `renderHeader()` agora torna o user-chip clicável (link para `perfil.html` ou `../perfil.html` se em `/wiki/`). |
| `js/room-chat.js` | **(Tarefa 2)** Reescrito: agora cada mensagem é uma bolha com avatar (foto ou inicial com borda colorida), nome na cor do jogador, fundo colorido para mensagens self. Mensagens de sistema em estilo diferenciado (itálico, cinza, sem foto). Auto-scroll inteligente — desabilita se usuário rolou pra cima, reabilita ao enviar mensagem. Nova função `setParticipantColors(map)` para receber o mapa userId→info do sala.html. |
| `js/room-ws.js` | **(Tarefa 4)** `_applyIncremental` adiciona case `player_color_set` que atualiza `s.participantColors[userId].color` localmente. |
| `js/character-form.js` | **(Tarefa 7)** Etapa 1 agora tem botão "🎨 Desenhar símbolo" além de "📷 Escolher foto". Clique abre `window.SymbolDrawer.open(callback)` — callback recebe URL da imagem enviada e atualiza `photoUrl` do personagem. |

---

## 🗑️ Arquivos a DELETAR manualmente (não inclusos no pacote)

Os 4 arquivos abaixo são duplicatas antigas em `worker/src/` (não em `worker/src/durable-objects/` ou `worker/src/routes/`) com imports quebrados. **Delete eles do seu repositório local** antes de aplicar este pacote:

| Caminho | Motivo |
|---------|--------|
| `worker/src/RoomDO.ts` | Duplicata antiga do `worker/src/durable-objects/RoomDO.ts` com imports quebrados |
| `worker/src/characters.ts` | Duplicata antiga de `worker/src/routes/characters.ts` com imports quebrados |
| `worker/src/rule-sets.ts` | Duplicata antiga de `worker/src/routes/rule-sets.ts` com imports quebrados |
| `worker/src/0006_rule_sets_and_chat.sql` | Duplicata de `worker/src/migrations/0006_rule_sets_and_chat.sql` |

Comandos CMD Windows:
```cmd
cd C:\caminho\para\rpgdoscria.github.io\worker\src
if exist RoomDO.ts del RoomDO.ts
if exist characters.ts del characters.ts
if exist rule-sets.ts del rule-sets.ts
if exist 0006_rule_sets_and_chat.sql del 0006_rule_sets_and_chat.sql
```

---

## 🚀 Como aplicar

1. **Backup**: `git stash` ou `xcopy /E /I /Y . C:\Backup\rpg-wiki-antes-v3`
2. **Delete os 4 arquivos órfãos** listados acima
3. **Descompacte** este ZIP por cima da raiz do projeto (preserva estrutura)
4. **Rode migrations** (DUAS novas):
   ```cmd
   cd worker
   npm run db:migrate:remote
   ```
5. **Typecheck**:
   ```cmd
   cd worker && npx tsc --noEmit
   ```
6. **Deploy Worker**:
   ```cmd
   cd worker && npm run deploy
   ```
7. **Deploy Frontend**:
   ```cmd
   git add . && git commit -m "v3: salas permanentes, chat com bolhas, dado melhorado, cor do jogador, planejamento, perfil, símbolo" && git push
   ```

---

## 🧪 Verificações de sucesso (testar em 2 abas após deploy)

1. **Salas permanentes**: mestre cria sala com nome "A Mansão Assombrada" → apenas 1 entrada no banco → sala aparece na lista de salas em `criar-sala.html` → após encerrar, ainda aparece (marcada como encerrada) → pode excluir definitivamente.
2. **Chat com bolhas**: 2 jogadores entram com cores diferentes → chat mostra mensagens com foto (ou inicial), nome na cor do jogador, bolhas self à direita, others à esquerda. Mensagens de sistema em itálico cinza.
3. **Dado visual melhorado**: rolagem mostra dado com gradiente 3D, sombras, bounce ao parar, número final com brilho animado, total com pop.
4. **Cor do jogador**: jogador clica no badge "JOGADOR" no header da sala → abre color picker → troca cor → todos vêem a mudança no chat e na ficha instantaneamente.
5. **Aba Planejamento**: mestre vê aba "Planejamento" (jogador não vê) → escreve anotações → recarrega página → anotações persistem.
6. **Perfil**: após login, usuário é redirecionado para `perfil.html` → vê seus personagens, edições recentes na wiki, e (se mestre) suas salas.
7. **Símbolo desenhado**: em `criar-personagem.html` etapa 1 → clica "🎨 Desenhar símbolo" → desenha no canvas → salva → desenho vira a foto do personagem.

---

## 📋 Resumo do pacote

- **Total de arquivos**: 34 (7 novos + 27 modificados)
- **Tamanho do ZIP**: ~120KB
- **Migrations novas**: 2 (`0009_rooms_permanence.sql`, `0010_planning_and_colors.sql`)
- **Validações**: TypeScript zero erros, JS sem erros de sintaxe, wrangler bundling OK
