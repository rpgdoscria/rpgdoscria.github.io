# Arquivos incluídos nesta entrega — Rpg dos Cria v8

Pacote com 4 correções: (1) URLs absolutas em todos os links, (2) personagem aparece automaticamente na sala ao entrar, (3) seletor de cor customizada (quadrado RGB), (4) chat mostra nome do personagem em vez de username.

---

## ✅ Validações rodadas

- `tsc --noEmit` no worker → **zero erros**
- `node -c` em todos os JS (incluindo `js/wiki/wiki-core.js`) → **todos OK**
- Inline `<script>` do `sala/index.html` → **OK**
- Busca por links relativos (`href="[a-z]` sem `/`) → **zero ocorrências**
- Cache-bust rodado → 18 HTMLs, versão `?v=202607271440`

---

## ✏️ Arquivos MODIFICADOS

### Tarefa 1 — URLs absolutas (eliminar `.html` e caminhos relativos)

| Caminho | Descrição da mudança |
|---------|----------------------|
| `js/auth.js` | **Reescrito**: removida função `depthPrefix()` e toda lógica de `prefix`/`wikiPrefix`/`inWiki`. Todos os links do header agora usam caminhos absolutos (`/wiki`, `/meus-personagens`, `/criar-sala`, `/entrar-sala`, `/perfil`, `/admin`, etc.). `logout()` → `"/login"`. `requireAuth()` → `"/login?next=..."`. `redirectToNext()` → `"/perfil"`. `change-password` redirect → `"/change-password"`. Brand link → `"/"`. Search form → `"/wiki?q=..."`. |
| `js/api.js` | Login redirect de `"login?next=..."` para `"/login?next=..."`. |
| `js/editor.js` | Redirects de `"page?slug=..."` para `"/page?slug=..."`. |
| `js/room-ws.js` | Login redirect de `dp + "login?next=..."` (relativo) para `"/login?next=..."` (absoluto). Removida lógica `depthPrefix` do connect(). |
| `entrar-sala/index.html` | `location.href = "sala?code=..."` → `"/sala?code=..."`. `<a href="criar-sala">` → `<a href="/criar-sala">`. |
| `criar-sala/index.html` | `href="../"` → `"/"`. `href="../sala?code=..."` → `"/sala?code=..."`. `location.href = "../sala?code=..."` → `"/sala?code=..."`. Copy link URL fix. |
| `sala/index.html` | `href="entrar-sala"` → `"/entrar-sala"`. `href="../../index.html"` → `"/"`. `href='meus-personagens'` → `href='/meus-personagens'`. `location.href = "criar-sala"` → `"/criar-sala"`. |
| `index.html` | Todos os `href="perfil"` → `"/perfil"`, `href="wiki/"` → `"/wiki"`, `href="meus-personagens"` → `"/meus-personagens"`, `href="entrar-sala"` → `"/entrar-sala"`, `href="criar-sala"` → `"/criar-sala"`, `href="admin"` → `"/admin"`. `location.href = "login?next=..."` → `"/login?next=..."`. `location.href = "sala?code=..."` → `"/sala?code=..."`. |
| `perfil/index.html` | `href="criar-personagem"` → `"/criar-personagem"`. `href="wiki/editar?new=true"` → `"/wiki/editar?new=true"`. |
| `meus-personagens/index.html` | `href="criar-personagem"` → `"/criar-personagem"`. `href="criar-personagem?id=..."` → `"/criar-personagem?id=..."`. |
| `criar-personagem/index.html` | `href="meus-personagens"` → `"/meus-personagens"`. |
| `page/index.html` | `href="edit?title=..."` → `"/edit?title=..."`. `href="edit?slug=..."` → `"/edit?slug=..."`. `href="history?slug=..."` → `"/history?slug=..."`. `href="page?slug=..."` → `"/page?slug=..."`. |
| `wiki/index.html` | `href="editar?new=true"` → `"/wiki/editar?new=true"`. |
| `js/wiki/wiki-core.js` | URLs sem `.html` (já corrigido na v7, mantido). |
| `js/markdown.js` | Wikilinks sem `.html` (já corrigido na v7, mantido). |

### Tarefa 2 — Personagem aparece automaticamente na sala

| Caminho | Descrição da mudança |
|---------|----------------------|
| `worker/src/durable-objects/RoomDO.ts` | `handleConnect`: após criar a Connection, se o jogador tem `characterId` (não-mestre, não-espectador) e o personagem **não está** em `state.characters`, carrega do D1 (tabela `characters` + `character_stats`), adiciona ao estado, faz **broadcast** `character_updated` para todos os clientes, e atualiza `participantColors[userId]` com `characterName` e `photoUrl`. Isso garante que todos os clientes vejam o personagem aparecer imediatamente. |

### Tarefa 3 — Seletor de cor customizada (quadrado RGB)

| Caminho | Descrição da mudança |
|---------|----------------------|
| `entrar-sala/index.html` | Substituído o `<input type="color">` cru por um **botão quadrado estilizado** (`#color-custom-btn`) com fundo da cor atual e ícone 🎨. O `<input type="color">` fica oculto (`position:absolute;width:0;height:0;opacity:0`). Clique no quadrado dispara `colorCustom.click()` que abre o seletor nativo. Quando uma cor é selecionada (seja do quadrado ou dos swatches), o quadrado atualiza seu `background`. |
| `css/style.css` | Novo seletor `.color-custom-square` (36×36px, border-radius 8px, hover scale 1.1, border-color accent no hover) com `.color-custom-icon` (emoji 🎨 com drop-shadow). |

### Tarefa 4 — Chat mostra nome do personagem

| Caminho | Descrição da mudança |
|---------|----------------------|
| `worker/src/durable-objects/RoomDO.ts` | Interface `ChatMessage` ganha campo opcional `senderDisplayName`. `handleChatMessage` agora determina o nome de exibição: se mestre → `"Mestre"`, se espectador → `"Espectador"`, se tem personagem → nome do personagem do estado, senão → username. Esse nome é incluído no payload do broadcast `chat_message`. |
| `js/room-chat.js` | `renderMessage()` agora usa `msg.senderDisplayName` (vindo do backend) como prioridade 1, depois `info.characterName` (do participantColors), depois `msg.senderUsername` como fallback. |

---

## 🚀 Como aplicar

1. **Backup**: `git stash` ou `xcopy /E /I /Y . C:\Backup\rpg-wiki-antes-v8`
2. **Descompacte** este ZIP por cima da raiz do projeto
3. **Rode migrations** (se ainda não rodou as 4 novas):
   ```cmd
   cd worker && npm run db:migrate:remote
   ```
4. **Typecheck + deploy worker**:
   ```cmd
   cd worker && npx tsc --noEmit && npm run deploy
   ```
5. **Deploy frontend**:
   ```cmd
   git add . && git commit -m "v8: URLs absolutas, personagem aparece ao entrar, cor customizada, chat com nome do personagem" && git push
   ```

---

## 🧪 Verificações de sucesso

1. **URLs absolutas**: a partir de `/entrar-sala/`, submeter o código vai para `/sala?code=XXX` (não `/entrar-sala/sala?code=XXX`). Nenhum link interno resulta em 404.
2. **Personagem aparece**: dois jogadores entram com personagens diferentes; cada um vê o personagem do outro aparecer imediatamente na aba Visão Geral e Personagens.
3. **Cor customizada**: na tela de entrar-sala, o quadrado 🎨 abre o seletor de cores nativo; a cor escolhida é aplicada no chat e nos cards.
4. **Chat com nome do personagem**: mensagens mostram "NomeDoPersonagem: texto" em vez do username. Mestre mostra "Mestre: texto". Espectador mostra "Espectador: texto".
5. **Todas as funcionalidades anteriores** continuam funcionando (dados, dano, enquetes, trocas, planejamento, documentos secretos).

---

## 📋 Resumo do pacote

- **Total de arquivos**: 33 (todos modificados — nenhum novo nesta versão)
- **Destaques v8**: URLs 100% absolutas (zero 404), personagem carregado do D1 ao entrar na sala, seletor de cor RGB customizado, chat com nome do personagem
- **Validações**: TypeScript zero erros, JS sem erros, inline OK, zero links relativos restantes
