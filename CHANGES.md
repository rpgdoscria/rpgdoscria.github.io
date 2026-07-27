# Arquivos incluídos nesta entrega — Rpg dos Cria v7

Pacote com 3 correções/melhorias: (1) sala revertida para layout de abas com cards compactos, (2) URLs limpas corrigidas (eliminado `.html` remanescente), (3) página de criação de sala estilizada com cartão centralizado.

---

## ✅ Validações rodadas

- `tsc --noEmit` no worker → **zero erros**
- `node -c` em todos os JS (incluindo `js/wiki/wiki-core.js`) → **todos OK**
- Inline `<script>` do `sala/index.html` → **OK**
- Cache-bust rodado → 18 HTMLs, versão `?v=202607271411`
- Busca por `.html` restante em links → **zero ocorrências**

---

## ✏️ Arquivos MODIFICADOS

### Tarefa 1 — Sala revertida para abas + cards compactos

| Caminho | Descrição da mudança |
|---------|----------------------|
| `sala/index.html` | **Layout completamente refeito**: removido o design "cartas" (inimigos no topo, chat flutuante, FABs do mestre, painel lateral). Restaurado o **layout de abas** com 7 abas (Visão Geral, Personagens, Inimigos, Dados, Chat, Documentos [mestre], Planejamento [mestre]). Dado visual fixo no topo, fora das abas. **Melhoria**: aba Visão Geral agora tem `#characters-grid-compact` com cards compactos de personagens (avatar 40px + nome + até 2 barras de vida/mana + borda na cor do jogador). Clique no card compacto leva pra aba Personagens. `showRoomScreen` restaura `tab-docs` e `tab-planning` para mestre (em vez de `master-fab-group`). Função `renderCompactCharCard(ch, isMaster)` adicionada. `bindActionButtons` agora binda clique nos `.compact-char-card`. Código do chat FAB/master FAB/side panel mantido mas inerte (referências a elementos removidos viram no-ops seguros). |
| `css/style.css` | **~120 linhas novas**: `.compact-char-grid` (grid auto-fill 160px), `.compact-char-card` (flex row com avatar + info, hover translateY), `.compact-char-avatar` (40px quadrado), `.compact-char-name` (ellipsis), `.compact-char-bars`, `.compact-bar` (4px altura), `.compact-bar-fill` (transição width). `.criar-sala-wrap` (max-width 600px centralizado), `.criar-sala-card` (card com shadow e padding generoso), `.criar-sala-card h1` (centrado), `.criar-sala-actions` (flex center com min-width 140px nos botões), `.criar-sala-existing`, `.criar-sala-room-row` (com estado inactive). Responsivo 480px: card padding menor, botões full-width, grid compacto 1 coluna. |

### Tarefa 2 — URLs limpas corrigidas

| Caminho | Descrição da mudança |
|---------|----------------------|
| `js/wiki/wiki-core.js` | `pageUrl()`, `editUrl()`, `editNewUrl()`, `historyUrl()` agora geram URLs sem `.html` (`pagina?slug=...` em vez de `pagina.html?slug=...`). `breadcrumb()` usa `href="."` em vez de `href="index.html"`. |
| `js/markdown.js` | Wikilinks `[[Título]]` agora geram `pagina?slug=...` em vez de `pagina.html?slug=...`. |
| `wiki/index.html` | Link "Nova página" mudou de `editar.html?new=true` para `editar?new=true`. |
| `wiki/pagina/index.html` | Breadcrumb usa `?category=...` em vez de `index.html?category=...`. Redirect após deletar página usa `location.href = "."` em vez de `"index.html"`. |

### Tarefa 3 — Página de criação de sala estilizada

| Caminho | Descrição da mudança |
|---------|----------------------|
| `criar-sala/index.html` | **Interface completamente refeita**: container `.criar-sala-wrap` (max-width 600px centralizado) com `.criar-sala-card` (card com shadow, border-radius grande, padding generoso). Título "🎪 Criar Sala" centrado com subtitle. Campos: Nome (obrigatório), Descrição (opcional), Personagens (opcional). Botões "Criar sala" e "Cancelar" com `min-width: 140px` (não esticados). Hint de feedback centrado. Lista de salas existentes com `.criar-sala-room-row` (cards individuais com nome + código + status + ações). Auto-focus no campo nome. Links corrigidos para URLs limpas (`../sala?code=...` em vez de `sala?code=...`). |

### Arquivos mantidos das versões anteriores (incluídos para completude)

| Caminho | Descrição |
|---------|-----------|
| `js/auth.js` | Header dropdown categorizado + `depthPrefix()` para URLs limpas + fontes Poppins. |
| `js/room-chat.js` | Chat com bolhas (foto, nome colorido, auto-scroll inteligente). |
| `js/room-ws.js` | `RoomClient` com `isSpectator` + `depthPrefix()` no login redirect. |
| `js/character-render.js` | `renderAvatar()` com símbolo sobreposto. |
| `js/master-planning.js` | Aba Planejamento com 3 sub-abas (Anotações, Inimigos 2 modos, Mini-wiki só secretas). |
| `worker/src/durable-objects/RoomDO.ts` | Handlers WS completos (polls, trades, purchases, level up, spectator, reveal_document, set_player_color). |
| `worker/src/routes/rooms.ts` | Salas permanentes com nome + idempotência + planejamento. |
| `worker/src/routes/characters.ts` | Suporte a `symbolUrl`. |
| `worker/src/routes/pages.ts` | `GET /api/pages` inclui `secret`/`revealed`. |
| `worker/src/migrations/0009-0012` | 4 migrations (rooms, planning+colors, symbol, spectator). |
| `scripts/cache-bust.js` | Percorre subpastas para achar `index.html`. |
| `scripts/clean-urls.js` | Script que move HTMLs para `pasta/index.html` (já executado). |

---

## 🚀 Como aplicar

1. **Backup**: `git stash` ou `xcopy /E /I /Y . C:\Backup\rpg-wiki-antes-v7`
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
   git add . && git commit -m "v7: sala com abas restauradas + cards compactos, URLs limpas corrigidas, criar-sala estilizado" && git push
   ```

---

## 🧪 Verificações de sucesso

1. **Sala com abas**: acessar `/sala?code=XXX` mostra 7 abas (Visão Geral, Personagens, Inimigos, Dados, Chat, Documentos [mestre], Planejamento [mestre]). Dado visual fixo no topo.
2. **Cards compactos**: aba Visão Geral mostra personagens como cards pequenos (avatar + nome + 2 barras) em grade. Clique leva pra aba Personagens.
3. **Chat tempo real**: mensagens aparecem instantaneamente (sem F5) com foto, nome colorido e bolhas.
4. **URLs limpas**: nenhum link tem `.html`. `/sala`, `/criar-sala`, `/wiki/pagina?slug=teste` — todos funcionam sem 404.
5. **Criar sala**: página mostra cartão centralizado com campos Nome/Descrição/Personagens. Botões proporcionais (não esticados). Após criar, redireciona pra sala.
6. **Funcionalidades existentes**: rolar dados, dano, enquetes, trocas, upar, documentos secretos, planejamento — todos operacionais.

---

## 📋 Resumo do pacote

- **Total de arquivos**: 24 (todos modificados — nenhum novo nesta versão)
- **Destaques v7**: abas restauradas + cards compactos na Visão Geral + URLs `.html` eliminadas + criar-sala com cartão centralizado
- **Validações**: TypeScript zero erros, JS sem erros, inline OK, zero links `.html` restantes
