# Arquivos incluídos nesta entrega — Rpg dos Cria v4 (FINAL)

Pacote com 8 tarefas completas: salas permanentes, chat em tempo real com bolhas, dado visual melhorado, cor do jogador, planejamento com mini-wiki, perfil, símbolo branco/transparente, responsividade global. Estrutura de pastas preservada relativa à raiz.

---

## ✅ Validações rodadas antes do empacotamento

- `tsc --noEmit` no worker → **zero erros**
- `node -c` em todos os 26 JS files → **todos OK**
- Inline `<script>` do `sala.html` (46KB) → **OK**
- Cache-bust rodado → 19 HTMLs, versão `?v=202607271159`

---

## 🆕 Arquivos NOVOS

| Caminho | Descrição |
|---------|-----------|
| `perfil.html` | **(Tarefa 6)** Página de dashboard pessoal pós-login: personagens (mini cards), edições recentes wiki, salas (se mestre). |
| `js/perfil.js` | **(Tarefa 6)** Lógica do perfil — carrega `/api/characters`, `/api/pages`, `/api/rooms` em paralelo. |
| `js/symbol-drawer.js` | **(Tarefa 7)** Canvas para desenhar símbolo. **Branco sobre transparente** (sem paleta de cores). Pincel + borracha (apaga pra transparência via `globalCompositeOperation = "destination-out"`). Exporta PNG com alpha. Mouse + touch. |
| `js/master-planning.js` | **(Tarefa 5)** Aba Planejamento com 3 sub-abas: Anotações (autosave), Inimigos pré-prontos (autosave), **Mini-wiki** (CRUD completo de páginas via `/api/pages`, com flag `secret`). |
| `worker/src/migrations/0009_rooms_permanence.sql` | **(Tarefa 1)** Cria tabela `rooms` (code, name, master_user_id, created_at, ended_at, is_active, last_activity). |
| `worker/src/migrations/0010_planning_and_colors.sql` | **(Tarefas 4, 5)** Adiciona `color` em `session_participants`; cria tabela `master_planning` (room_code, user_id, section, content, updated_at). |
| `worker/src/migrations/0011_character_symbol.sql` | **(Tarefa 7)** Adiciona coluna `symbol_url` em `characters` (PNG branco transparente separado da foto). |
| `CHANGES.md` | Este arquivo. |

---

## ✏️ Arquivos MODIFICADOS

### Backend (Worker)

| Caminho | Descrição da mudança |
|---------|----------------------|
| `worker/src/durable-objects/RoomDO.ts` | **(Tarefas 1, 4)** `RoomState` ganha `name` e `participantColors: Record<number, ParticipantInfo>`. `handleInit` aceita `roomName`. Novo handler `set_player_color` (valida `#rrggbb`, atualiza Connection + participantColors, persiste em session_participants, broadcast `player_color_set`). `publicState` inclui `name`, `participantColors`, `you.color`. `restoreFromSnapshot` compat com snapshots antigos. |
| `worker/src/routes/rooms.ts` | **(Tarefas 1, 5)** `POST /api/rooms` com **idempotência** (30s mesmo nome = mesma sala) + campo `name` obrigatório + persiste em tabela `rooms`. `GET /api/rooms` lê de `rooms` (ativas E inativas). `GET /:code/status` lê de `rooms` primeiro (fallback snapshots). `POST /:code/end` marca `is_active=0`. **NOVO** `DELETE /:code` (exclui definitivo, cascade manual). **NOVOS** `GET /:code/planning` e `PUT /:code/planning/:section` (só mestre). |
| `worker/src/routes/characters.ts` | **(Tarefa 7)** GET/POST/PUT agora incluem `symbolUrl` (coluna `symbol_url` da migration 0011). INSERT e UPDATE aceitam `symbolUrl` no body. |
| `worker/src/routes/pages.ts` | **(Tarefa 5)** `GET /api/pages` agora inclui colunas `secret` e `revealed` na listagem (necessário pra mini-wiki do mestre mostrar flags 🔒/👁). |

### Frontend — HTML

| Caminho | Descrição da mudança |
|---------|----------------------|
| `sala.html` | **(Tarefas 1, 2, 4, 5, 8)** Aba "Planejamento" (mestre only) com 3 sub-abas (Anotações, Inimigos, Mini-wiki). Mini-wiki lista páginas com flags secret/revealed + botão "Nova página" abre modal editor (reutiliza `/api/pages`). Título da sala mostra `name`. Badge JOGADOR clicável abre color picker. `onStateChange` enriquece `participantColors` com characterName/photoUrl e sincroniza com `roomChat`. Ao conectar, jogador envia `set_player_color` (sessionStorage ou cor aleatória). `<script src="js/master-planning.js">` adicionado. Cache-bust `?v=202607271159`. |
| `criar-sala.html` | **(Tarefa 1)** Campo "Nome da sala" obrigatório. Botão Criar desabilitado até preencher. `createInFlight` flag + idempotência backend (30s). Lista salas com nome, status, data. Salas encerradas têm botão Excluir. |
| `entrar-sala.html` | **(Tarefa 4)** Color picker: 8 swatches circulares + input color custom. Cor guardada em `sessionStorage` antes de redirecionar. |
| `criar-personagem.html` | **(Tarefa 7)** Adicionado `<script src="js/symbol-drawer.js">`. |
| `index.html` | **(Tarefa 6)** Card "Meu perfil" no topo dos quick-access. |
| `perfil.html` | (listado em NOVOS) |
| `admin.html`, `change-password.html`, `edit.html`, `gerenciar-sets-regras.html`, `gerenciar-status.html`, `history.html`, `login.html`, `meus-personagens.html`, `page.html`, `wiki/editar.html`, `wiki/historico.html`, `wiki/index.html`, `wiki/pagina.html` | Apenas cache-bust `?v=202607271159`. |

### Frontend — CSS

| Caminho | Descrição da mudança |
|---------|----------------------|
| `css/style.css` | **(Tarefas 2-8)** ~700 linhas adicionadas no final: **Tarefa 2** (chat bolhas com avatar colorido, self/other, sistema); **Tarefa 3** (dado visual com gradiente 3D, sombras, glow, bounce, pop no total); **Tarefa 4** (color picker com swatches circulares); **Tarefa 5** (sub-abas planejamento, mini-wiki rows); **Tarefa 6** (perfil grid, mini cards); **Tarefa 7** (símbolo transparente com xadrez); **Tarefa 8** (responsividade global: container fluido, header quebra em mobile, grids auto-fit, modais com max-width:min(100%,500px), breakpoints 480/768/1024px, chat altura clamp, tabelas com scroll horizontal, etc.). |

### Frontend — JS

| Caminho | Descrição da mudança |
|---------|----------------------|
| `js/auth.js` | **(Tarefa 6)** `redirectToNext()` → `perfil.html` (não `index.html`). user-chip no header é link pra `perfil.html`. |
| `js/room-chat.js` | **(Tarefas 2, 2B)** Bolhas com avatar (foto ou inicial com borda colorida), nome colorido, fundo colorido pra self. Auto-scroll inteligente (desabilita se usuário rolou pra cima). `setParticipantColors(map)`. |
| `js/room-ws.js` | **(Tarefa 2B — FIX CRÍTICO)** `_applyIncremental` agora adiciona `chat_message` ao `s.chatLog` (antes não fazia isso, então `onStateChange` chamava `renderHistory()` que apagava a bolha que `onEvent` acabou de adicionar — bug "precisa F5"). Também adiciona case `player_color_set`. |
| `js/character-form.js` | **(Tarefa 7)** Etapa 1 tem campo **separado** "Símbolo" além de "Foto". Botão "🎨 Desenhar símbolo" abre `SymbolDrawer.open()` que salva em `symbolUrl` (não em `photoUrl`). `getSymbolUrl()` exportado. `save()` inclui `symbolUrl` no payload. Edição carrega `symbolUrl` do banco. |
| `js/character-render.js` | **(Tarefa 7)** `renderAvatar()` agora sobrepõe miniatura do símbolo (PNG branco transparente) no canto inferior direito do avatar, com fundo escuro e sombra. |
| `js/config.js` | (já vinha de versão anterior) `API_BASE` dinâmico (meta tag / hostname / fallback). |

---

## 🐛 Bug crítico corrigido (Tarefa 2B)

**Sintoma:** Chat não atualizava em tempo real — jogador precisava apertar F5 pra ver novas mensagens.

**Causa raiz:** No `room-ws.js`, o `_applyIncremental` tinha um case `chat_message` que apenas dava `break` (não adicionava ao estado). O fluxo era:
1. `chat_message` chega → `_applyIncremental` não modifica `s.chatLog`
2. `onEvent` chama `roomChat.renderMessage(msg.payload)` → bolha aparece no DOM
3. `onStateChange` chama `roomChat.renderHistory(state.chatLog)` → **limpa o container** e re-renderiza do estado (que **não tem** a mensagem nova) → bolha some

**Fix:** Adicionar `chat_message` ao `s.chatLog` no `_applyIncremental`:
```js
case "chat_message": {
  if (!Array.isArray(s.chatLog)) s.chatLog = [];
  s.chatLog.push(msg.payload);
  if (s.chatLog.length > 50) s.chatLog.shift();
  break;
}
```
Agora quando `renderHistory` é chamado, o estado já tem a mensagem nova — nada some.

---

## 🗑️ Arquivos a DELETAR manualmente (não inclusos no pacote)

Os 4 arquivos abaixo são duplicatas antigas em `worker/src/` com imports quebrados. **Delete eles** antes de aplicar:

| Caminho | Motivo |
|---------|--------|
| `worker/src/RoomDO.ts` | Duplicata de `worker/src/durable-objects/RoomDO.ts` |
| `worker/src/characters.ts` | Duplicata de `worker/src/routes/characters.ts` |
| `worker/src/rule-sets.ts` | Duplicata de `worker/src/routes/rule-sets.ts` |
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

1. **Backup**: `git stash` ou `xcopy /E /I /Y . C:\Backup\rpg-wiki-antes-v4`
2. **Delete os 4 arquivos órfãos** listados acima
3. **Descompacte** este ZIP por cima da raiz do projeto
4. **Rode as 3 migrations novas**:
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
   git add . && git commit -m "v4: salas permanentes, chat tempo real, dado melhorado, cor jogador, planejamento c/ mini-wiki, perfil, símbolo branco/transparente, responsividade" && git push
   ```

---

## 🧪 Verificações de sucesso (testar em 2 abas após deploy)

1. **Salas permanentes**: mestre cria sala com nome → apenas 1 entrada no banco → aparece em `criar-sala.html` → encerrar mantém na lista → pode excluir definitivamente.
2. **Chat tempo real**: 2 jogadores entram com cores diferentes → mensagem aparece **instantaneamente** nas 2 telas (sem F5) → bolhas com foto, nome colorido, self à direita.
3. **Dado visual**: rolagem mostra dado com gradiente 3D, glow vermelho ao parar, número com brilho, total com pop.
4. **Cor do jogador**: clica no badge JOGADOR → color picker → troca cor → todos vêem mudança no chat instantaneamente.
5. **Planejamento c/ mini-wiki**: mestre vê aba "Planejamento" (jogador não vê) → 3 sub-abas → pode criar página secreta na mini-wiki → página aparece na lista com flag 🔒 → pode revelar depois.
6. **Perfil**: após login, vai pra `perfil.html` → vê personagens + edições wiki + (se mestre) salas.
7. **Símbolo branco/transparente**: criar-personagem etapa 1 → "🎨 Desenhar símbolo" → só branco disponível → fundo transparente (xadrez) → salvar → símbolo aparece como miniatura sobreposta no avatar.
8. **Responsividade**: abrir no celular ou zoom 150% → layout se ajusta → modais centralizados → abas viram só ícones no mobile → grids reorganizam.

---

## 📋 Resumo do pacote

- **Total de arquivos**: 37 (8 novos + 29 modificados)
- **Migrations novas**: 3 (`0009_rooms_permanence.sql`, `0010_planning_and_colors.sql`, `0011_character_symbol.sql`)
- **Bug crítico corrigido**: chat em tempo real (Tarefa 2B)
- **Validações**: TypeScript zero erros, JS sem erros de sintaxe, inline script OK
