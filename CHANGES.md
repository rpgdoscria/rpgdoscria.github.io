# Arquivos incluídos nesta entrega — Rpg dos Cria v6

Pacote com 3 novas tarefas: (1) seleção de personagem com opção de espectador, (2) redesenho completo da sala em estilo cartas sem abas, (3) URLs limpas (sem `.html`). Inclui também todas as funcionalidades das versões anteriores (header dropdown, fontes Poppins, chat em tempo real, cor do jogador, planejamento com mini-wiki secreta, inimigos 2 modos, símbolo branco/transparente, responsividade).

---

## ✅ Validações rodadas

- `tsc --noEmit` no worker → **zero erros**
- `node -c` em todos os JS → **todos OK**
- Inline `<script>` do `sala/index.html` → **OK**
- Cache-bust rodado → 18 HTMLs, versão `?v=202607271331`
- Script `clean-urls.js` executado → 17 HTMLs movidos para `pasta/index.html`

---

## 🆕 Arquivos NOVOS

| Caminho | Descrição |
|---------|-----------|
| `scripts/clean-urls.js` | **(Tarefa 3)** Script Node que move HTMLs para `pasta/index.html`, atualiza todos os links removendo `.html`, ajusta paths de assets (css/js/vendor) com prefixo `../` apropriado, atualiza `cache-bust.js` para percorrer subpastas. Rodar UMA VEZ. |
| `worker/src/migrations/0009_rooms_permanence.sql` | **(Tarefa anterior)** Tabela `rooms` permanente com nome. |
| `worker/src/migrations/0010_planning_and_colors.sql` | **(Tarefa anterior)** Coluna `color` em `session_participants`; tabela `master_planning`. |
| `worker/src/migrations/0011_character_symbol.sql` | **(Tarefa anterior)** Coluna `symbol_url` em `characters`. |
| `worker/src/migrations/0012_spectator.sql` | **(Tarefa 1 — NOVO)** Adiciona coluna `is_spectator` (INTEGER NOT NULL DEFAULT 0) em `session_participants`. Permite que jogadores entrem como espectadores (sem personagem). |
| `CHANGES.md` | Este arquivo. |

---

## ✏️ Arquivos MODIFICADOS

### 🔥 NOVIDADES v6

| Caminho | Descrição da mudança |
|---------|----------------------|
| `worker/src/durable-objects/RoomDO.ts` | **(Tarefa 1)** Interface `Connection` ganha campo `isSpectator: boolean`. `handleConnect` lê parâmetro `isSpectator` da query string do WebSocket. Se espectador, `characterId` é undefined e `isSpectator=true` (mestre nunca é espectador). `publicState` inclui `isSpectator` no campo `you`. `participant_joined` broadcast inclui `isSpectator` no payload. |
| `js/room-ws.js` | **(Tarefa 1)** `RoomClient` construtor aceita 3º parâmetro `isSpectator = false`. `connect()` adiciona `isSpectator=1` na query string do WebSocket se verdadeiro. Login redirect usa `depthPrefix()` para funcionar com URLs limpas. |
| `sala/index.html` | **(Tarefa 2 — REDESENHO COMPLETO)** Layout completamente refeito em estilo cartas, **sem abas**: área superior com cartas de inimigos em linha horizontal rolável; área central com dado visual + controles de rolagem inline; área inferior com cartas de jogadores em linha horizontal. Chat vira **botão flutuante (FAB)** no canto inferior direito que abre painel flutuante (com opção fixar). Ferramentas do mestre (Visão Geral, Planejamento, Documentos) viram **botões flutuantes** no canto inferior esquerdo que abrem painel lateral. **(Tarefa 1)** Modal de seleção de personagem com opção "Entrar como espectador" — mostra lista de personagens com foto/nome, botão espectador, e botão cancelar. Se sem personagens, pergunta se quer entrar como espectador. |
| `js/auth.js` | **(Tarefa 3 — URLs limpas)** Nova função `depthPrefix()` calcula prefixo `../` baseado na profundidade do path. `renderHeader()` usa `depthPrefix` + `wikiPrefix` para gerar links relativos corretos em qualquer nível. `requireAuth`, `logout`, `redirectToNext` usam `depthPrefix()` nos redirects. Detecção de página de troca de senha atualizada para funcionar com `/change-password/`. |
| `js/room-chat.js` | **(Tarefa 2)** Chat adaptado para painel flutuante — funciona dentro do `.chat-floating-panel` com altura flexível. |
| `css/style.css` | **(Tarefa 2)** ~300 linhas de CSS novo: `.sala-card-layout` (flex column), `.sala-card-header`, `.sala-section`, `.card-row` (flex horizontal com scroll), `.sala-dice-section`, `.dice-master-inline`. `.chat-fab` (botão flutuante 56px com badge), `.chat-floating-panel` (340px fixo bottom-right), `.master-fab-group` + `.master-fab` (botões flutuantes esquerda), `.room-side-panel` (painel lateral slide-in right). Responsividade mobile: cartas 160px, chat full-width, FABs menores. |
| 14 HTMLs movidos para `pasta/index.html` | **(Tarefa 3)** `admin`, `change-password`, `criar-personagem`, `criar-sala`, `edit`, `entrar-sala`, `gerenciar-sets-regras`, `gerenciar-status`, `history`, `login`, `meus-personagens`, `page`, `perfil`, `sala` — cada um movido de `X.html` para `X/index.html`. Paths de assets (css/js/vendor) ajustados com `../`. Links internos sem `.html`. |
| 3 HTMLs wiki movidos | **(Tarefa 3)** `wiki/editar`, `wiki/historico`, `wiki/pagina` — movidos para `wiki/X/index.html`. Paths ajustados com `../../`. |
| `index.html` (raiz) | **(Tarefa 3)** Permanece na raiz. Links internos atualizados sem `.html`. |
| `wiki/index.html` | **(Tarefa 3)** Permanece em `wiki/`. Links internos atualizados sem `.html`. |
| `scripts/cache-bust.js` | **(Tarefa 3)** `findHtmlFiles()` reescrita para percorrer subpastas (procura `subpasta/index.html` em vez de `*.html` soltos). |
| `js/master-planning.js` | **(Tarefa 3)** Links atualizados para URLs limpas (`wiki/pagina` em vez de `wiki/pagina.html`). |
| `js/perfil.js` | **(Tarefa 3)** Links atualizados para URLs limpas. |
| `js/character-render.js` | **(Tarefa 3)** Links atualizados. |
| `js/config.js` | (mantido de v5) API_BASE dinâmico. |

### Já implementados nas versões anteriores (mantidos)

- **Header dropdown categorizado** (Wiki, Personagens, Salas, Admin) com menu hamburguer mobile
- **Fontes Poppins** para títulos, Inter para corpo
- **Salas permanentes** com nome + idempotência (30s)
- **Chat em tempo real** com bolhas (bug do F5 corrigido)
- **Cor pessoal do jogador** (paleta + persistência + badge clicável)
- **Dado visual melhorado** (gradiente 3D, glow, bounce, pop)
- **Aba Planejamento** com 3 sub-abas (Anotações, Inimigos 2 modos, Mini-wiki só secretas)
- **Perfil/dashboard** após login
- **Símbolo branco/transparente** (canvas com `destination-out`)
- **Responsividade global** (breakpoints 480/768/1024px)

---

## 🚀 Como aplicar

1. **Backup**: `git stash` ou `xcopy /E /I /Y . C:\Backup\rpg-wiki-antes-v6`
2. **Delete os 4 arquivos órfãos** em `worker/src/` (se ainda existirem):
   ```cmd
   cd C:\caminho\para\rpgdoscria.github.io\worker\src
   if exist RoomDO.ts del RoomDO.ts
   if exist characters.ts del characters.ts
   if exist rule-sets.ts del rule-sets.ts
   if exist 0006_rule_sets_and_chat.sql del 0006_rule_sets_and_chat.sql
   ```
3. **Descompacte** este ZIP por cima da raiz do projeto. Os HTMLs antigos (`sala.html`, etc.) serão substituídos pelas novas pastas (`sala/index.html`). **Delete os `.html` antigos da raiz** se o Git não remover automaticamente:
   ```cmd
   cd C:\caminho\para\rpgdoscria.github.io
   if exist sala.html del sala.html
   if exist criar-sala.html del criar-sala.html
   if exist entrar-sala.html del entrar-sala.html
   :: (repita para todos os outros .html da raiz, exceto index.html)
   if exist wiki\editar.html del wiki\editar.html
   if exist wiki\historico.html del wiki\historico.html
   if exist wiki\pagina.html del wiki\pagina.html
   ```
4. **Rode as 4 migrations** novas (se ainda não rodou as anteriores):
   ```cmd
   cd worker && npm run db:migrate:remote
   ```
5. **Typecheck + deploy worker**:
   ```cmd
   cd worker && npx tsc --noEmit && npm run deploy
   ```
6. **Deploy frontend**:
   ```cmd
   git add . && git commit -m "v6: espectador, sala estilo cartas, URLs limpas" && git push
   ```

---

## 🧪 Verificações de sucesso

1. **Espectador**: ao entrar numa sala (sem ser mestre), aparece modal com personagens + botão "Entrar como espectador". Escolhendo espectador, entra na sala sem personagem — vê tudo mas não pode rolar dados ou trocar itens.
2. **Sala estilo cartas**: inimigos aparecem como cartas no topo (rolável horizontal), dado no centro, jogadores embaixo. Sem abas. Chat acessível via botão flutuante no canto. Ferramentas do mestre via botões flutuantes no canto esquerdo.
3. **URLs limpas**: `rpgdoscria.github.io/sala` (sem `.html`), `rpgdoscria.github.io/wiki/pagina?slug=teste`. Todos os links internos funcionam sem 404.
4. **Funcionalidades existentes**: rolar dados, dano em inimigos, chat tempo real, enquetes, trocas, upar, documentos secretos, planejamento — todos operacionais no novo layout.
5. **Responsividade**: cartas rolam horizontalmente em telas estreitas, chat vira painel full-width no mobile, botões flutuantes menores.

---

## 📋 Resumo do pacote

- **Total de arquivos**: 38 (5 novos + 33 modificados/movidos)
- **Migrations novas**: 4 (`0009`, `0010`, `0011`, `0012`)
- **Destaques v6**: modal espectador + sala sem abas (cartas) + URLs limpas
- **Validações**: TypeScript zero erros, JS sem erros, inline OK
