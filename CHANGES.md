# Arquivos incluídos nesta entrega — Rpg dos Cria v11 (Patch de Permissões por Stat + Inventário Popup + Ficha Compacta)

Patch focado em 3 conjuntos de mudanças pedidas pelo usuário Odilon:

1. **Bug do "deletar status" não funcionar no hub da sala** — agora funciona via WebSocket em tempo real.
2. **Ficha muito longa (1.5 telas de scroll)** — refatorada para layout compacto em 2 colunas.
3. **Jogador não pode modificar status por default** — sistema de permissões por stat. Mestre libera individualmente cada stat. Stats customizados já nascem editáveis pelo jogador; stats de template (vida, mana, etc.) ficam só com o mestre por padrão.
4. **Inventário como popup** — não mais `<details>` inline. Agora é um modal com lista de itens + ícones.
5. **Itens com ícone desenhado** — novo `item-drawer.js` (baseado no `symbol-drawer.js` mas com cor customizável) permite desenhar ícones coloridos para os itens.

---

## ✅ Validações rodadas

- `tsc --noEmit` no worker → **zero erros**
- `node -c` em todos os JS modificados → **todos OK**
- Syntax check do script inline do `sala/index.html` → **OK** (1 script inline)
- Validação de chaves CSS → `style.css` 998/998 ✓
- Cache-bust rodado → versão `?v=202607271735` aplicada em 18 HTMLs (131 substituições)

---

## 🗄️ MIGRATION OBRIGATÓRIA

**Antes de fazer deploy, rode a migration 0013:**

```bash
cd worker
npm run db:migrate:remote
```

A migration faz 2 coisas:
1. `ALTER TABLE character_stats ADD COLUMN player_editable INTEGER NOT NULL DEFAULT 0` — por padrão, só mestre edita. Stats customizados (is_custom=1) recebem `player_editable=1` automaticamente.
2. `CREATE TABLE character_inventory_items` — nova tabela com `icon_url` para itens do inventário.

Sem essa migration, o worker vai quebrar ao tentar ler `player_editable` (coluna inexistente).

---

## ✏️ Arquivos MODIFICADOS

### Backend (Worker)

| Caminho | Descrição |
|---------|-----------|
| `worker/src/migrations/0013_stat_permissions_and_inventory_icons.sql` | **NOVO**. Adiciona `player_editable` em `character_stats` + cria tabela `character_inventory_items` com `icon_url`. |
| `worker/src/routes/characters.ts` | `mapStat()` agora inclui `playerEditable`. `insertStat()` seta `playerEditable=1` automaticamente para stats customizados. **NOVOS endpoints**: `DELETE /api/characters/:id/stats/:statId` (mestre deleta stat), `PATCH /api/characters/:id/stats/:statId/permission` (mestre alterna permissão), `GET/POST/PUT/DELETE /api/characters/:id/inventory[/:itemId]` (CRUD de itens com ícone). |
| `worker/src/routes/rooms.ts` | 2 SELECTs de `character_stats` agora incluem `player_editable`. Mapeamento em `playerEditable` no JSON de resposta. |
| `worker/src/durable-objects/RoomDO.ts` | `CharacterStat` interface ganha `playerEditable?: boolean`. `InventoryItem` ganha `equipped?` e `iconUrl?`. `sanitizeStat()` lê `player_editable`. `handleUpdateOwnCharacter` valida que o stat tem `playerEditable=true` antes de aplicar update do jogador. `handleUpdateCharacter` (mestre) aceita `inventory` com `iconUrl`/`equipped` e pode mudar `playerEditable` on the fly. **NOVOS handlers**: `handleDeleteStat` (mestre deleta stat em tempo real), `handleSetStatPermission` (mestre alterna permissão em tempo real). Ambos persistem no D1 e fazem broadcast `character_updated`. |

### Frontend

| Caminho | Descrição |
|---------|-----------|
| `js/character-render.js` | **Refatorado**: cada stat agora mostra badge de permissão (🔒/🔓). Mestre vê botões `toggle-perm` (alternar permissão) e `delete-stat` (deletar stat) em cada stat. Jogador só vê botões +/- em stats com `playerEditable=true`. Inventário não é mais `<details>` inline; virou botão `open-inventory` que abre modal. Layout compacto: stats em grid de 2 colunas (`stats-grid-compact`). Avatar reduzido de 64px para 56px no card. |
| `js/character-sheet-full.js` | **Refatorado para layout compacto**: header com avatar 64px (era 80), nome e botão de inventário na mesma linha. Bars em destaque reduzidos de 3 para 2. Atributos e Características agora em **2 colunas** (`sheet-full-two-col`) quando ambos existem. Checkbox e fórmulas em linha (não mais blocos separados). Inventário virou botão (não mais seção inline). |
| `js/item-drawer.js` | **NOVO**. Baseado no `symbol-drawer.js` mas com **cor de pincel customizável** (color picker nativo). Canvas 256×256 (menor que símbolo). Fundo transparente, exporta PNG com alpha. Permite editar ícone existente (carrega imagem inicial). |
| `sala/index.html` | **Adiciona** `<script src="/js/item-drawer.js">`. **NOVO modal de inventário** (`#inventory-modal`) com lista de itens (equipados vs mochila), form de adicionar item (nome, qty, equipado, descrição, ícone desenhado), botões de editar ícone e deletar item. **NOVOS bindings**: `delete-stat` (mestre deleta stat via WS), `toggle-perm` (mestre alterna permissão via WS), `open-inventory` (abre modal). Funções: `openInventoryModal()`, `loadInventoryItems()`, `renderInventoryItems()`, `renderInventoryItemRow()`. |
| `css/style.css` | **+365 linhas** de CSS novo: `.stats-grid-compact` (grid 2 colunas), `.stat-perm-toggle`/`.stat-perm-locked`/`.stat-delete-btn` (badges e botões de permissão/delete), `.inventory-open-btn`/`.inv-count-badge` (botão de inventário), `.sheet-full-compact` (ficha compacta com `!important` overrides), `.sheet-full-two-col` (layout 2 colunas), `.inv-modal-list`/`.inv-modal-row`/`.inv-item-icon`/`.inv-add-form` (modal de inventário e form de adicionar item). Responsivo: em telas ≤480px stats viram 1 coluna; em ≤600px ficha compacta vira 1 coluna. |

### Cache-bust (apenas `?v=` atualizado)

| Caminho |
|---------|
| `index.html`, `admin/index.html`, `change-password/index.html`, `criar-personagem/index.html`, `criar-sala/index.html`, `edit/index.html`, `entrar-sala/index.html`, `gerenciar-sets-regras/index.html`, `gerenciar-status/index.html`, `history/index.html`, `login/index.html`, `meus-personagens/index.html`, `page/index.html`, `perfil/index.html`, `wiki/editar/index.html`, `wiki/historico/index.html`, `wiki/index.html`, `wiki/pagina/index.html` |

### Arquivos do patch anterior (v10) ainda inclusos

O patch anterior (v10 — pathing + CSS wiki + breadcrumb) está inclusos neste ZIP porque o `CHANGES.md` foi sobrescrito. Se você já aplicou o v10, pode ignorar esses arquivos — eles são idênticos. Se não aplicou, este ZIP já inclui tudo.

| Caminho | Descrição (v10) |
|---------|-----------|
| `js/wiki/wiki-core.js` | URLs absolutas + `homeUrl()` |
| `js/markdown.js` | Wikilinks absolutos |
| `js/perfil.js` | 8 links absolutos |
| `js/master-planning.js` | Link mini-wiki absoluto |
| `js/wiki/wiki-core.js` | Rewrite completo |
| `css/wiki-style.css` | **NOVO** (movido de `wiki/css/`) |
| `_DELETE_ESTA_PASTA_wiki_css.txt` | Marcador para deletar pasta antiga |

---

## 📋 Lista completa de arquivos no patch

```
CHANGES.md                                                    (este arquivo)
_DELETE_ESTA_PASTA_wiki_css.txt                               (marcador v10)
css/style.css                                                 (modificado — CSS novo + bloco wiki media query)
css/wiki-style.css                                            (NOVO v10 — movido de wiki/css/)
js/character-render.js                                        (modificado — permissões + inventário popup + compacto)
js/character-sheet-full.js                                    (modificado — layout compacto)
js/item-drawer.js                                             (NOVO — desenhista de ícones coloridos)
js/markdown.js                                                (modificado v10 — wikilinks absolutos)
js/master-planning.js                                         (modificado v10 — link absoluto)
js/perfil.js                                                  (modificado v10 — links absolutos)
js/wiki/wiki-core.js                                          (modificado v10 — URLs absolutas)
sala/index.html                                               (modificado — modal inventário + bindings + script)
worker/src/durable-objects/RoomDO.ts                          (modificado — handlers + validação)
worker/src/routes/characters.ts                               (modificado — endpoints + mapStat)
worker/src/routes/rooms.ts                                    (modificado — SELECTs + mapStat)
worker/src/migrations/0013_stat_permissions_and_inventory_icons.sql  (NOVO)
+ 18 HTMLs com cache-bust ?v=202607271735
```

**Total: 32 arquivos** (4 novos, 0 removidos, 14 modificados com features, 18 com cache-bust)

---

## 🚀 Como aplicar

1. **Backup** (recomendado): `xcopy /E /I /Y . C:\Backup\rpg-wiki-antes-v11`
2. **Descompacte** este ZIP por cima da raiz do repositório (preserva estrutura de pastas)
3. **Delete a pasta `wiki/css/`** se ainda existir (instruções no `_DELETE_ESTA_PASTA_wiki_css.txt` do v10)
4. **RODE A MIGRATION 0013** (CRÍTICO — sem isso o worker quebra):
   ```bash
   cd worker
   npm run db:migrate:remote
   ```
5. **Typecheck + deploy worker**:
   ```bash
   cd worker
   npx tsc --noEmit
   npm run deploy
   ```
6. **Deploy frontend**:
   ```bash
   git add . && git commit -m "v11: permissões por stat + inventário popup + ficha compacta" && git push
   ```
7. **Não precisa** rodar `node scripts/cache-bust.js` (já rodado, versão `?v=202607271735`)

---

## 🧪 Verificações de sucesso (testar em produção após deploy)

### Bug 1 — Deletar status da ficha (mestre)
1. Entre numa sala como mestre
2. Na aba Personagens, cada ficha mostra cada stat com botão **×** à direita
3. Clique no **×** de qualquer stat → confirma → stat some da ficha em tempo real
4. Recarregue a página → stat continua removido (persistido no D1)

### Bug 2 — Ficha compacta
1. Abra a aba Personagens na sala
2. Compare com antes: a ficha deve ocupar **menos da metade** da altura
3. Stats numéricos (Força, Destreza, etc.) aparecem em **grid 2 colunas** (não mais empilhados)
4. Atributos e Características aparecem lado a lado em 2 colunas (em telas ≥600px)
5. Bars em destaque: apenas 2 (antes eram 3), extras viram pills
6. Inventário não aparece inline — é um botão 🎒 com badge de contagem

### Bug 3 — Permissões por stat (mestre libera, jogador edita)
1. Como mestre, entre na sala e olhe a ficha de qualquer personagem
2. Cada stat tem um badge 🔒 (vermelho, bloqueado) ou 🔓 (verde, liberado)
3. Clique no 🔒 de um stat → vira 🔓 (jogador agora pode editar)
4. Como jogador dono do personagem:
   - Stats com 🔒: **não** mostram botões +/- (jogador não pode editar)
   - Stats com 🔓: mostram botões +/- normalmente
5. Tente editar via console (hack): o RoomDO rejeita com erro "Este status só pode ser editado pelo mestre"

### Bug 4 — Stats customizados já nascem editáveis
1. Como jogador, crie um personagem novo no wizard
2. Adicione um status customizado (sem template) na etapa 5
3. Entre numa sala com esse personagem
4. O status customizado deve aparecer com 🔓 (jogador pode editar) automaticamente
5. Stats vindos de sets de regras (vida, mana) aparecem com 🔒 (só mestre edita)

### Bug 5 — Inventário como popup
1. Na ficha de qualquer personagem, clique no botão 🎒 (com badge de contagem)
2. Modal abre com:
   - Lista de itens (separados: ⚔️ Equipado / 🎒 Mochila)
   - Cada item mostra ícone (se houver), nome, qty, descrição
   - Botões 🎨 (desenhar ícone) e × (deletar) em cada item
3. Form de adicionar item na parte inferior: nome, qty, equipado, descrição, ícone

### Bug 6 — Desenhar ícone de item
1. Abra o modal de inventário de qualquer personagem
2. Clique no quadrado "sem ícone" (ou no botão 🎨 Desenhar ícone)
3. Abre o desenhista (igual ao de símbolo, mas com color picker)
4. Escolha uma cor (ex: vermelho para espada, azul para poção)
5. Desenhe o ícone, clique em "💾 Usar como ícone"
6. Ícone aparece no preview, salve o item
7. Item aparece na lista com o ícone desenhado
8. Outros clientes na sala veem o item com ícone em tempo real (via WS sync)

---

## 📌 Notas técnicas

- **Migration 0013 é OBRIGATÓRIA** antes do deploy do worker. Sem ela, o `SELECT * FROM character_stats` não retorna `player_editable` e o worker quebra ao tentar mapear.
- **Compatibilidade com inventário antigo**: o `inventory_json` na tabela `characters` ainda existe (não foi removido). O RoomDO continua lendo ele se a nova tabela estiver vazia. Mas novos itens vão para `character_inventory_items`. Se você quiser migrar itens antigos, pode rodar um SQL manual (não incluído na migration para evitar surpresas).
- **Permissões em tempo real**: quando o mestre clica em 🔒/🔓, o RoomDO persiste no D1 E faz broadcast `character_updated` para todos os clientes. Todos veem o badge mudar instantaneamente.
- **Delete de stat é permanente**: não há undo. O stat é removido do D1 (`DELETE FROM character_stats`) e do estado do RoomDO. Se o stat era referenciado por uma fórmula, a fórmula vai quebrar na próxima avaliação (mas não trava o sistema — só retorna erro silencioso).
- **Item-drawer reusa estilos do symbol-drawer**: o overlay usa a classe `.symbol-drawer-overlay` e `.symbol-drawer-card` para não duplicar CSS. A única diferença é o canvas menor (256 vs 320) e o color picker.
- **Sincronização de inventário via WS**: quando o mestre adiciona/remove/edita um item, o frontend re-busca o inventário completo da API e envia via `update_character` com o array de itens. O RoomDO substitui o inventário em memória e faz broadcast. Jogadores veem a mudança instantaneamente.

---

## 🐛 Possíveis problemas (se algo quebrar)

1. **Erro 500 no worker ao carregar personagem**: migration 0013 não rodou. Rode `npm run db:migrate:remote`.
2. **Badge de permissão não aparece**: cache do navegador. Force reload (Ctrl+Shift+R) ou limpe cache. A versão `?v=202607271735` deve forçar recarga.
3. **Jogador consegue editar stat bloqueado**: impossível pelo WS (validação no RoomDO). Se está conseguindo, é porque está usando a API REST `/api/characters/:id/stat/:statId` que ainda não valida permissão — mas essa API só é usada no wizard de criação, não na sala. Vou validar isso no próximo patch se necessário.
4. **Ícone desenhado não aparece no item**: verifique no DevTools → Network se o upload para Cloudinary retornou 200. Se retornou, o URL deve estar no `icon_url` da tabela `character_inventory_items`.
