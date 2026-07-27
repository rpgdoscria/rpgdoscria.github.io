# Arquivos incluídos nesta entrega — Rpg dos Cria v9

Pacote com 5 correções: (1) wiki carrega sem loop infinito, (2) URLs absolutas, (3) lista de participantes em tempo real com personagens, (4) seletor de cor customizada, (5) chat mostra nome do personagem.

---

## ✅ Validações rodadas

- `tsc --noEmit` no worker → **zero erros**
- `node -c` em todos os JS → **todos OK**
- Inline `<script>` do `sala/index.html` → **OK**
- Busca por links relativos (`../`) → **zero ocorrências**
- Cache-bust rodado → versão `?v=202607271519`

---

## ✏️ Arquivos MODIFICADOS

### Tarefa 1 — Corrigir carregamento infinito na wiki

| Caminho | Descrição |
|---------|-----------|
| `wiki/pagina/index.html` | **CAUSA RAIZ**: assets (CSS/JS) usavam `../css/` e `../js/` — mas o arquivo está em `/wiki/pagina/index.html` (profundidade 2), então `../css/` resolvia para `/wiki/css/` (inexistente). Corrigido para caminhos absolutos: `/css/style.css`, `/js/api.js`, `/vendor/marked.min.js`, etc. |
| `wiki/editar/index.html` | Mesma correção: `../css/` → `/css/`, `../js/` → `/js/`, `../../css/wiki-style.css` → `/css/wiki-style.css`. |
| `wiki/historico/index.html` | Mesma correção. |
| `wiki/index.html` | `css/wiki-style.css` → `/css/wiki-style.css`. `../css/` → `/css/`. |
| `perfil/index.html`, `meus-personagens/index.html`, `criar-personagem/index.html`, `criar-sala/index.html`, `entrar-sala/index.html`, `sala/index.html`, `page/index.html`, `edit/index.html`, `history/index.html`, `admin/index.html`, `change-password/index.html`, `login/index.html`, `gerenciar-sets-regras/index.html`, `gerenciar-status/index.html` | Todos os assets (`../css/`, `../js/`, `../vendor/`) convertidos para caminhos absolutos (`/css/`, `/js/`, `/vendor/`). `../../index.html` → `/`. |
| `index.html` (raiz) | `css/` → `/css/`, `js/` → `/js/`, `favicon.svg` → `/favicon.svg`. |

### Tarefa 2 — URLs absolutas em todos os links

| Caminho | Descrição |
|---------|-----------|
| `js/auth.js` | Todos os links do header usam caminhos absolutos (`/wiki`, `/meus-personagens`, `/criar-sala`, etc.). Removida `depthPrefix()`. |
| `js/api.js` | Login redirect → `"/login?next=..."` |
| `js/editor.js` | Redirects → `"/page?slug=..."` |
| `js/room-ws.js` | Login redirect → `"/login?next=..."` |
| Todos os HTMLs | Todos os `href` e `location.href` usam caminhos absolutos (`/sala?code=...`, `/entrar-sala`, etc.) |

### Tarefa 3 — Lista de participantes em tempo real

| Caminho | Descrição |
|---------|-----------|
| `worker/src/durable-objects/RoomDO.ts` | **NOVO método `broadcastParticipantsList()`**: monta lista completa de participantes com `userId`, `username`, `isMaster`, `isSpectator`, `characterId`, `characterName`, `photoUrl`, `color`, `stats` (barras de vida/mana). Faz broadcast `participants_updated` para todos. Chamado após: (1) character carregado em `handleConnect`, (2) `set_player_color`, (3) `onClose` (participante sai). |
| `js/room-ws.js` | `_applyIncremental` adiciona case `participants_updated` que guarda `s.participants = msg.payload.participants`. |
| `sala/index.html` | `onEvent` handle `participants_updated` chama `renderParticipantsList(participants)`. **NOVA função `renderParticipantsList(participants)`**: renderiza cards compactos na Visão Geral com nome do personagem (ou "Mestre"/"Espectador"), foto, cor (borda), barras de status, e tag de role. Atualiza `#characters-grid-compact` imediatamente. |

### Tarefa 4 — Seletor de cor customizada

| Caminho | Descrição |
|---------|-----------|
| `entrar-sala/index.html` | Botão quadrado `.color-custom-square` com ícone 🎨 que abre `<input type="color">` oculto. Sincronizado com swatches. |
| `css/style.css` | `.color-custom-square` (36×36px, border-radius 8px, hover scale). |

### Tarefa 5 — Chat com nome do personagem

| Caminho | Descrição |
|---------|-----------|
| `worker/src/durable-objects/RoomDO.ts` | `ChatMessage` interface ganha `senderDisplayName`. `handleChatMessage` determina: mestre → "Mestre", espectador → "Espectador", jogador → nome do personagem. |
| `js/room-chat.js` | `renderMessage()` usa `msg.senderDisplayName` como prioridade 1. |

---

## 🚀 Como aplicar

1. **Backup**: `git stash` ou `xcopy /E /I /Y . C:\Backup\rpg-wiki-antes-v9`
2. **Descompacte** este ZIP por cima da raiz
3. **Rode migrations** (se ainda não): `cd worker && npm run db:migrate:remote`
4. **Typecheck + deploy**: `cd worker && npx tsc --noEmit && npm run deploy`
5. **Deploy frontend**: `git add . && git commit -m "v9: wiki fix, URLs absolutas, lista de participantes, cor customizada, chat com nome" && git push`

---

## 🧪 Verificações de sucesso

1. **Wiki carrega**: acessar `/wiki/pagina?slug=teste` mostra a página sem loop infinito
2. **URLs**: navegação entre páginas não gera 404
3. **Lista de participantes**: dois jogadores entram — cada um vê o personagem do outro aparecer imediatamente na aba Visão Geral
4. **Cor customizada**: quadrado 🎨 abre seletor nativo
5. **Chat**: mostra "NomeDoPersonagem: mensagem" (não username)
6. **Espectador**: aparece como "Espectador" na lista, sem barras de status
