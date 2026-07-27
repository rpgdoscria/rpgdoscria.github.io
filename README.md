# Rpg dos Cria — Pacote de Integração da Sala de Jogo (v2)

Este pacote contém **apenas os arquivos modificados ou novos** necessários para integrar as funcionalidades da sala de jogo (abas, polls via WebSocket, trocas com contraproposta, compras, level up mestre+jogador, documentos secretos com animação, construtor visual de fórmulas, cache-bust automático).

A estrutura de pastas preserva o caminho relativo à raiz do projeto. Para aplicar, basta descompactar por cima do seu repositório local.

---

## 📋 Arquivos no pacote

### Arquivos NOVOS

| Caminho | Descrição |
|---------|-----------|
| `README.md` | Este arquivo — lista de mudanças |
| `scripts/cache-bust.js` | Script Node que gera timestamp `YYYYMMDDHHMM` e substitui `?v=ANTIGO` por `?v=NOVO` em todos os HTMLs (raiz + `/wiki/`). Suporta `--check` (dry-run) e versão customizada como argumento posicional. |

### Arquivos MODIFICADOS

#### Frontend — lógica da sala

| Caminho | Descrição da mudança |
|---------|----------------------|
| `sala.html` | **Reestruturação completa**: adicionada barra de abas `<nav class="room-tabs">` com 6 abas (Visão Geral, Ficha Completa, Inimigos, Dados, Chat, Documentos) — cada botão com ID próprio (`tab-geral`, `tab-ficha`, etc.) e cada painel com ID correspondente. Dado visual mantido fixo no topo (visível em todas as abas). Lógica JS `switchTab(name)` com persistência em `location.hash`. Aba "Documentos" só visível para mestre. Adicionada aba "Visão Geral" com cards de estatísticas + ações rápidas (rolar dados, abrir chat, criar enquete, propor troca, oferecer compra). Integrado `formula-builder` como primário (campo de texto manual vira fallback em `<details>`). Integrado `roomChat` na aba Chat. Inicialização de todos os módulos (`pollSystem`, `tradeSystem`, `purchaseSystem`, `levelUpSystem`) após `client.connect()`. Exposição de `window._roomClient` (com `userId` e `username`) e `window._roomState` para os módulos acessarem. `loadSecretsList()` busca páginas secretas via REST e adiciona botão "Revelar" que chama API REST + envia WS `reveal_document`. Botão "🎁 Pontos" injetado dinamicamente em cada ficha de personagem (mestre only) — chama `set_level_up_points`. Handler `onEvent` trata `chat_message`, `reveal_document`, e badge de "nova mensagem" na aba Chat. Inclusão de `vendor/marked.min.js` e `js/markdown.js` (necessários para renderizar markdown dos documentos secretos revelados). |
| `css/style.css` | Adicionados ~340 linhas no final do arquivo: `.room-tabs`/`.room-tab`/`.room-tab-panel` com **borda inferior** colorida na aba ativa (não fundo colorido), `:focus-visible` outline, badge "nova mensagem" pulsante na aba Chat, animação fade-in nos painéis. `.overview-cards`/`.overview-stat` para a aba Visão Geral. `.room-dice-layout` (grid 2 colunas em desktop, 1 coluna em mobile) para a aba Dados. `#chat-mount` com altura fixa e mensagens estilo chat (próprio/outro/sistema). `.secret-card` com borda lateral vermelha e estado "revelado" com cor verde. `.formula-builder` reforçado (preview, botões, validação visual). Responsivo: no mobile os labels das abas somem (só ícones). |
| `js/config.js` | Reescrito: agora resolve `API_BASE` em cascata: (1) `<meta name="rpg-api-base">`, (2) `window.RPG_API_BASE`, (3) detecção por hostname (`localhost`/`127.0.0.1`/`192.168.*`/`10.*` → `http://localhost:8787`, outros → hardcoded), (4) fallback hardcoded. Remove barra trailing. Log em dev para debug. |
| `js/room-ws.js` | `_applyIncremental` estendido com cases para `poll_created`/`poll_updated`/`poll_ended`/`poll_chat`, `trade_proposed`/`trade_updated`, `purchase_offer`/`purchase_updated`, `level_up_available`, `reveal_document` (renomeado de `secret_revealed`), `chat_message`, `participant_joined`/`participant_left`. Cada case inicializa arrays faltantes com `if (!Array.isArray(s.X)) s.X = []` para compatibilidade com snapshots antigos. |
| `js/levelup.js` | Adicionado filtro por `ownerUserId` no `handleLevelUpAvailable` — só o dono do personagem abre o modal. Renomeado `ws.send('level_up_points', ...)` → `ws.send('distribute_level_points', ...)` (novo nome preferido; alias legado mantido no RoomDO). |
| `js/purchase.js` | Renomeado `ws.send('accept_purchase', ...)` → `ws.send('respond_purchase', ...)` (novo nome preferido; alias legado mantido no RoomDO). |
| `js/trade.js` | Adicionado botão "Contraproposta" no modal de troca recebida. `respondTrade()` agora aceita `action` string (`"accept"`/`"reject"`/`"counter"`) em vez de boolean (compat legado mantido). Contraproposta abre `openTradeCreator` invertendo papéis via `window._roomState`. |

#### Frontend — HTMLs com cache-bust aplicado (apenas versão `?v=` atualizada)

| Caminho | Descrição da mudança |
|---------|----------------------|
| `admin.html` | Apenas atualização do `?v=` em todos `<link>` e `<script>` para `?v=202607271019` |
| `change-password.html` | idem |
| `criar-personagem.html` | idem |
| `criar-sala.html` | idem |
| `edit.html` | idem |
| `entrar-sala.html` | idem |
| `gerenciar-sets-regras.html` | idem |
| `gerenciar-status.html` | idem |
| `history.html` | idem |
| `index.html` | idem |
| `login.html` | idem |
| `meus-personagens.html` | idem |
| `page.html` | idem |
| `wiki/editar.html` | idem |
| `wiki/historico.html` | idem |
| `wiki/index.html` | idem |
| `wiki/pagina.html` | idem |

> **Nota:** Para evitar incluir 17 HTMLs redundantes, você pode simplesmente rodar `node scripts/cache-bust.js` localmente após descompactar — o script gera um timestamp novo e aplica a todos os HTMLs automaticamente. Os HTMLs estão incluídos aqui apenas como conveniência para quem prefere não rodar o script.

#### Backend — Worker

| Caminho | Descrição da mudança |
|---------|----------------------|
| `worker/src/durable-objects/RoomDO.ts` | **Estendido em ~500 linhas**: adicionados novos tipos de estado (`Poll`, `PollVote`, `PollChatMessage`, `Trade`, `TradeItem`, `TradeOffer`, `PurchaseOffer`, `LevelUpOffer`) e novos arrays em `RoomState` (`polls`, `trades`, `purchaseOffers`, `levelUpOffers`). Novos handlers no switch `onMessage`: `create_poll`/`vote_poll`/`send_poll_chat`/`end_poll` (persiste em `polls`/`poll_votes`/`poll_chat_messages`); `propose_trade`/`respond_trade` (action: `accept`/`reject`/`counter` — contraproposta cria nova troca invertendo papéis, status `countered` adicionado ao tipo); `create_purchase`/`respond_purchase` (alias `accept_purchase`); `set_level_up_points` (mestre define pontos, broadcast `level_up_available`) / `distribute_level_points` (alias `level_up_points`); `reveal_document` (alias `reveal_secret`). Helpers: `validateTradeOffer`, `applyTradeEffects`, `transferMoney` (procura stats de dinheiro por nome: `dinheiro`/`moedas`/`gold`/`ouro`/`money`). `handleInit` inicializa os novos arrays vazios. `restoreFromSnapshot` adiciona compat para snapshots antigos (inicializa arrays vazios se faltarem). `publicState` inclui os novos campos no snapshot enviado aos clientes. |
| `worker/wrangler.toml` | Reorganizado com comentários em seções (CORS, dev, D1, Cloudinary, Durable Objects). Adicionado bloco `[dev]` com `port = 8787` e `local_protocol = "http"`. `migrations_dir = "src/migrations"` mantido (já estava presente). |
| `worker/package.json` | Adicionados scripts `cache-bust` (`node ../scripts/cache-bust.js`) e `cache-bust:check` (`node ../scripts/cache-bust.js --check`). Descrição atualizada para mencionar Durable Objects (em vez de R2). |

---

## 🗑️ Arquivos a DELETAR manualmente (não inclusos no pacote)

Os 4 arquivos abaixo são duplicatas antigas que estavam em `worker/src/` (não em `worker/src/durable-objects/` ou `worker/src/routes/`) com imports quebrados. **Delete eles do seu repositório local** antes de aplicar este pacote:

| Caminho | Motivo da deleção |
|---------|-------------------|
| `worker/src/RoomDO.ts` | Duplicata antiga do `worker/src/durable-objects/RoomDO.ts` com imports quebrados (caminhos relativos errados) |
| `worker/src/characters.ts` | Duplicata antiga de `worker/src/routes/characters.ts` com imports quebrados |
| `worker/src/rule-sets.ts` | Duplicata antiga de `worker/src/routes/rule-sets.ts` com imports quebrados |
| `worker/src/0006_rule_sets_and_chat.sql` | Duplicata de `worker/src/migrations/0006_rule_sets_and_chat.sql` |

Comandos CMD Windows para deletar:
```cmd
cd C:\caminho\para\rpgdoscria.github.io\worker\src
if exist RoomDO.ts del RoomDO.ts
if exist characters.ts del characters.ts
if exist rule-sets.ts del rule-sets.ts
if exist 0006_rule_sets_and_chat.sql del 0006_rule_sets_and_chat.sql
```

---

## 🚀 Como aplicar (resumo)

1. **Faça backup** do seu projeto atual (`git stash` ou `xcopy /E /I /Y . C:\Backup\rpg-wiki-antes`)
2. **Delete os 4 arquivos órfãos** listados acima (se existirem)
3. **Descompacte** este ZIP por cima da raiz do projeto (preserva estrutura de pastas)
4. **Rode typecheck** para confirmar que está tudo OK:
   ```cmd
   cd worker && npx tsc --noEmit
   ```
5. **Deploy do Worker**:
   ```cmd
   cd worker && npm run deploy
   ```
6. **Deploy do Frontend**:
   ```cmd
   git add . && git commit -m "Integração v2: abas, polls/trades/purchases/levelup WS, segredos, formula-builder, cache-bust" && git push
   ```

---

## ✅ Validações rodadas antes do empacotamento

- `tsc --noEmit` no worker → **zero erros**
- `node -c` em todos os 23 JS files → **todos OK**
- Inline `<script>` do `sala.html` (42762 chars) extraído e validado → **OK**
- `wrangler deploy --dry-run` (com wrangler+hono+@cloudflare/workers-types limpos) → **PASSOU** (228.50 KiB / 49.70 KiB gzip, bindings D1+Durable Objects detectados)
- Cache-bust rodado → **18 arquivos, 127 substituições, versão `?v=202607271019`**

---

## 📋 Arquitetura final dos handlers WebSocket no RoomDO

| Tipo de mensagem | Handler | Quem pode chamar |
|------------------|---------|------------------|
| `roll_dice` | `handleRollDice` | só mestre |
| `suggest_formula` | `handleSuggestFormula` | qualquer um |
| `update_own_character` | `handleUpdateOwnCharacter` | jogador (próprio char) |
| `update_character` | `handleUpdateCharacter` | só mestre |
| `create_enemy` / `update_enemy` / `delete_enemy` | `handleCreateEnemy` etc | só mestre |
| `add_status_effect` / `remove_status_effect` | `handleAddStatusEffect` etc | só mestre |
| `lock_room` / `end_room` | `handleLockRoom` / `handleEndRoom` | só mestre |
| `send_chat_message` | `handleChatMessage` | qualquer um |
| `create_poll` | `handleCreatePoll` | qualquer um |
| `vote_poll` | `handleVotePoll` | qualquer um (voto upsert) |
| `send_poll_chat` | `handlePollChat` | qualquer um (só em poll ativa) |
| `end_poll` | `handleEndPoll` | criador ou mestre |
| `propose_trade` | `handleProposeTrade` | jogador (não mestre) |
| `respond_trade` | `handleRespondTrade` | receiver (ou mestre) — action: `accept`/`reject`/`counter` |
| `create_purchase` | `handleCreatePurchase` | só mestre |
| `respond_purchase` | `handleRespondPurchase` | target_user (alias: `accept_purchase`) |
| `set_level_up_points` | `handleSetLevelUpPoints` | só mestre → envia `level_up_available` |
| `distribute_level_points` | `handleLevelUpPoints` | jogador (próprio char) (alias: `level_up_points`) |
| `reveal_document` | `handleRevealDocument` | só mestre (alias: `reveal_secret`) |

---

## 🧪 Verificações básicas após deploy (testar em 2 abas)

1. **Troca de abas independente**: mestre e jogador conseguem estar em abas diferentes simultaneamente
2. **Enquetes**: mestre cria poll → jogador vota → contagem atualiza em tempo real → chat da poll funciona
3. **Documento secreto**: mestre clica "Revelar" na aba Documentos → animação abre nas 2 abas simultaneamente
4. **Construtor de fórmulas**: mestre monta `d20 + 5` no construtor → clica "Rolar" → dado visual anima nas 2 abas
5. **Compras**: mestre oferece compra → jogador aceita → inventário do jogador recebe item + preço debitado
6. **Level up**: mestre clica "🎁 Pontos" numa ficha → digita 5 → jogador recebe modal → distribui → ficha atualiza
7. **Cache-bust**: após rodar `node scripts/cache-bust.js`, todas as URLs `?v=` em todos os HTMLs apontam para o mesmo timestamp novo

---

## 🐛 Troubleshooting rápido

| Sintoma | Causa provável | Solução |
|---------|----------------|---------|
| `Cannot find module 'hono'` no tsc | `node_modules` não instalado | `cd worker && npm install` |
| `workerd platform mismatch` | `node_modules` copiado de outro SO | `rmdir /S /Q node_modules && npm install` |
| WebSocket não conecta (401) | Token expirado | Faça login de novo em `login.html` |
| `Tipo de mensagem desconhecido: X` no console | RoomDO não deployado | `cd worker && npm run deploy` |
| Aba "Documentos" não aparece | Usuário não é mestre | Verifique `role = admin` no banco |
| Modal de level up não abre no jogador | `ownerUserId` não bate | Verifique se o mestre clicou "🎁 Pontos" na ficha do jogador correto |
| Botão "Contraproposta" não funciona | `window._roomState` vazio | Aguarde o `onStateChange` popular o estado |

---

## 📞 Próximos passos sugeridos (não inclusos neste pacote)

- **Inimigos com foto e status próprios** (precisa de migration 0009 com tabela `enemy_stats`)
- **Notificações sonoras** para polls/trocas/compras (Web Audio API — já existe em `damage-system.js`)
- **Histórico de polls encerradas** (aba ou lista na sala)
- **Sistema de XP automático** (mestre define XP por encontro, sistema soma)
- **Tema claro/escuro alternável**
- **Exportar ficha como PDF**

Para essas funcionalidades, abra uma nova sessão com o handoff atualizado.
