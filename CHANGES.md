# Arquivos incluídos nesta entrega — Rpg dos Cria v10 (Patch de Pathing + CSS Wiki + Breadcrumb)

Patch focado em 3 problemas reportados pelo usuário Odilon:

1. **Bug de pathing `/perfil/sala?code=...`** — ao reabrir sala pelo perfil, URL virava `/perfil/sala?code=...` em vez de `/sala?code=...`. Mesma classe de bug aparecia em múltiplos lugares do site (links relativos em vez de absolutos).
2. **CSS da wiki quebrado/deletado** — `wiki-style.css` estava em `/wiki/css/wiki-style.css` (local errado) mas era referenciado como `/css/wiki-style.css` em todos os HTMLs da wiki, devolvendo 404 e deixando a wiki inteira sem estilos (sidebar, breadcrumb, page-view, backlinks).
3. **Breadcrumb da wiki não navegável** — "Wiki › Lore/História › Situs Hatres / Johnny" usava `href="."` para "Wiki" (resolvia para o diretório atual, não `/wiki`) e `href="?category=..."` para categoria (relativo à URL atual da página, não à home da wiki). Clicar não levava a lugar nenhum útil.

---

## ✅ Validações rodadas

- `node -c` em todos os JS modificados → **todos OK**
- Syntax check de todos os scripts inline dos HTMLs modificados → **todos OK** (via `new Function()`)
- Cache-bust rodado → versão `?v=202607271620` aplicada em 18 HTMLs (130 substituições)
- Validação de chaves CSS → `style.css` 932/932 ✓, `wiki-style.css` 42/42 ✓
- Busca por links relativos problemáticos remanescentes → **zero ocorrências**
- Busca por `location.pathname.replace` problemáticos → **zero ocorrências**
- Busca por `${location.origin}${location.origin}` (origem duplicada) → **zero ocorrências**

---

## ✏️ Arquivos MODIFICADOS

### Tarefa 1 — Corrigir bug `/perfil/sala?code=...` e todos os links relativos do perfil

**Causa raiz:** `js/perfil.js` usava `href="sala?code=..."` (relativo). Como o perfil está em `/perfil/index.html`, o navegador resolvia para `/perfil/sala?code=...` em vez de `/sala?code=...`. Mesmo bug em todos os outros links do perfil (`criar-personagem`, `wiki/`, `criar-sala`, `entrar-sala`, `admin`).

| Caminho | Descrição |
|---------|-----------|
| `js/perfil.js` | **8 substituições**: todos os `href="sala?code=..."`, `href="criar-personagem..."`, `href="wiki/..."`, `href="criar-sala"`, `href="entrar-sala"`, `href="admin"` convertidos para caminhos absolutos (`/sala?code=...`, `/criar-personagem...`, `/wiki...`, `/criar-sala`, `/entrar-sala`, `/admin`). |

### Tarefa 2 — Corrigir CSS da wiki (404 + layout quebrado)

**Causa raiz 1:** `wiki-style.css` estava fisicamente em `/wiki/css/wiki-style.css` mas era referenciado como `/css/wiki-style.css` em todos os 4 HTMLs da wiki. Resultado: 404 → wiki sem nenhum estilo personalizado (sidebar, breadcrumb, page-view, backlinks — tudo sem estilo).

**Causa raiz 2:** Em `css/style.css`, o bloco `.wiki-layout { grid-template-columns: 1fr !important; }` e `.wiki-sidebar { position: static !important; ... }` estava **FORA** do `@media (max-width: 768px)`, aplicando em desktop também e forçando layout de 1 coluna com sidebar não-sticky.

| Caminho | Descrição |
|---------|-----------|
| `css/wiki-style.css` | **NOVO arquivo** (criado por cópia do antigo `/wiki/css/wiki-style.css`). Agora o path `/css/wiki-style.css` que todos os HTMLs da wiki já referenciavam realmente existe. Conteúdo idêntico ao antigo, apenas atualizado o comentário do cabeçalho explicando a mudança. |
| `css/style.css` | Bloco `.wiki-layout` e `.wiki-sidebar` (linhas ~3620-3629) **movido para DENTRO** de `@media (max-width: 768px)`. Agora em desktop o layout flex da wiki (sidebar 240px + conteúdo) funciona conforme o `wiki-style.css` define; só em telas ≤768px empilha em 1 coluna. Adicionado comentário explicativo. |

### Tarefa 3 — Corrigir breadcrumb da wiki (links não-navegáveis)

**Causa raiz:** `js/wiki/wiki-core.js` gerava `<a href=".">Wiki</a>` (resolvia para o diretório atual, ex: `/wiki/pagina/` em vez de `/wiki`) e as URLs `pageUrl/editUrl/historyUrl` usavam paths relativos (`pagina?slug=...`) que quebravam fora do contexto `/wiki/`. O breadcrumb de categoria em `wiki/pagina/index.html` usava `href: "?category=..."` (relativo à URL da página atual).

| Caminho | Descrição |
|---------|-----------|
| `js/wiki/wiki-core.js` | **Rewrite completo das funções de URL**: `pageUrl(slug)` agora retorna `/wiki/pagina?slug=...` (absoluto). Mesmo para `editUrl`, `editNewUrl`, `historyUrl`. `breadcrumb()` agora gera `<a href="/wiki">Wiki</a>` em vez de `href="."`. **NOVA função `homeUrl({category, q})`** gera `/wiki?category=...` ou `/wiki?q=...` para filtros. |
| `wiki/pagina/index.html` | Breadcrumb de categoria: `href: \`?category=...\`` → `href: wikiCore.homeUrl({ category: page.category })` (gera `/wiki?category=Lore%2FHist%C3%B3ria`). Redirect após excluir página: `location.href = "."` → `location.href = "/wiki"`. |

### Tarefa 4 — Corrigir wikilinks (`[[Nome]]` no markdown)

**Causa raiz:** `js/markdown.js` gerava `href="pagina?slug=..."` se estivesse dentro de `/wiki/` ou `href="wiki/pagina?slug=..."` se estivesse fora. Ambos quebravam em algum contexto (ex: `/wiki/pagina` relativo ia para `/wiki/pagina?slug=...` que é a própria página).

| Caminho | Descrição |
|---------|-----------|
| `js/markdown.js` | `preProcessWikilinks()` agora gera sempre `href="/wiki/pagina?slug=..."` (absoluto). Removida a detecção `inWiki = location.pathname.includes("/wiki/")` e o `prefix` condicional. Funciona de qualquer contexto (wiki, sala, perfil, page legacy). |

### Tarefa 5 — Corrigir links relativos em HTMLs da wiki

| Caminho | Descrição |
|---------|-----------|
| `wiki/index.html` | `location.href = '../login?next=...'` → `/login?next=...`. `location.href = 'index.html?q=...'` → `/wiki?q=...`. `location.href = "index.html"` → `/wiki`. |

### Tarefa 6 — Corrigir links relativos em HTMLs legacy e outros

| Caminho | Descrição |
|---------|-----------|
| `change-password/index.html` | `location.href = "index.html"` → `location.href = "/"` (após trocar senha, ia para `/change-password/index.html` em vez de home). |
| `criar-personagem/index.html` | `location.href = "meus-personagens"` → `/meus-personagens` (após salvar personagem, ia para `/criar-personagem/meus-personagens`). |
| `page/index.html` (legacy) | `location.href = "index.html"` → `/`. `location.href = \`edit?title=...\`` → `/edit?title=...` (interceptação de wikilink missing). |
| `history/index.html` (legacy) | `backLink.href = \`page?slug=...\`` → `/page?slug=...`. |

### Tarefa 7 — Corrigir bug do "Copiar link" da sala (URL dupla)

**Causa raiz:** Em `sala/index.html`, o botão "Copiar link" montava a URL com `${location.origin}${location.pathname.replace(/[^/]*$/, "")}sala?code=...`. Em produção, `location.pathname` é `/sala/index.html` (ou `/sala/`), então after o `.replace()` sobrava `/sala/`, e concatenar `sala?code=...` gerava `/sala/sala?code=...` (URL dupla). Em `criar-sala/index.html`, havia `${location.origin}${location.origin}sala?code=...` (origem duplicada, gerava `https://rpgdoscria.github.iohttps://rpgdoscria.github.io/sala?code=...`).

| Caminho | Descrição |
|---------|-----------|
| `sala/index.html` | Botão "Copiar link" e clique no código da sala: `${location.origin}${location.pathname.replace(/[^/]*$/, "")}sala?code=...` → `${location.origin}/sala?code=...` (2 ocorrências). |
| `criar-sala/index.html` | Botão "Copiar" da lista de salas: `${location.origin}${location.origin}sala?code=...` → `${location.origin}/sala?code=...` (origem duplicada removida). |

### Tarefa 8 — Corrigir wikilinks em JS de personagens

| Caminho | Descrição |
|---------|-----------|
| `js/master-planning.js` | `href="wiki/pagina?slug=..."` → `href="/wiki/pagina?slug=..."` (link "↗ Ver" na mini-wiki do Planejamento do mestre). |
| `js/character-render.js` | 2 ocorrências: `href="wiki/pagina?slug=personagem-${ch.id}"` → `/wiki/pagina?slug=...` e `href="wiki/pagina?id=${ch.pageId}"` → `/wiki/pagina?id=...` (links "📄 Ver lore" e "📄 Ver página de lore vinculada" na ficha de personagem). |
| `js/character-sheet-full.js` | `href="page.html?id=${ch.pageId}"` → `href="/page?id=${ch.pageId}"` (link "ver lore" na ficha completa na sala). |

---

## 🗑️ Arquivo REMOVIDO

| Caminho | Descrição |
|---------|-----------|
| `wiki/css/wiki-style.css` | **Removido** — era o local antigo (errado) do `wiki-style.css`. O conteúdo foi movido para `/css/wiki-style.css` (que é o path que todos os HTMLs da wiki já referenciavam). O diretório `wiki/css/` também foi removido (ficou vazio). |

---

## 📋 Lista completa de arquivos no patch

```
css/style.css                       (modificado — bloco wiki movido para dentro do media query)
css/wiki-style.css                  (NOVO — movido de wiki/css/ para cá)
js/markdown.js                      (modificado — wikilinks absolutos)
js/master-planning.js               (modificado — link mini-wiki absoluto)
js/perfil.js                        (modificado — 8 links absolutos)
js/character-render.js              (modificado — 2 links lore absolutos)
js/character-sheet-full.js          (modificado — link ver lore absoluto)
js/wiki/wiki-core.js                (modificado — rewrite: URLs absolutas + homeUrl())
wiki/index.html                     (modificado — redirects absolutos + cache-bust)
wiki/pagina/index.html              (modificado — breadcrumb categoria + redirect exclusão + cache-bust)
wiki/editar/index.html              (cache-bust)
wiki/historico/index.html           (cache-bust)
change-password/index.html          (modificado — redirect absoluto + cache-bust)
criar-personagem/index.html         (modificado — redirect absoluto + cache-bust)
criar-sala/index.html               (modificado — copy link origem única + cache-bust)
entrar-sala/index.html              (cache-bust)
index.html                          (cache-bust)
page/index.html                     (modificado — 2 redirects absolutos + cache-bust)
history/index.html                  (modificado — back-link absoluto + cache-bust)
admin/index.html                    (cache-bust)
login/index.html                    (cache-bust)
meus-personagens/index.html         (cache-bust)
gerenciar-status/index.html         (cache-bust)
gerenciar-sets-regras/index.html    (cache-bust)
perfil/index.html                   (cache-bust)
sala/index.html                     (modificado — copy link absoluto + cache-bust)
edit/index.html                     (cache-bust)
```

**Total: 26 arquivos** (1 novo, 1 removido, 14 modificados com correções de path/CSS, 11 apenas com cache-bust)

---

## 🚀 Como aplicar

1. **Backup** (recomendado): `xcopy /E /I /Y . C:\Backup\rpg-wiki-antes-v10`
2. **Descompacte** este ZIP por cima da raiz do repositório (preserva estrutura de pastas)
3. **Confirme** que `wiki/css/` foi removido (o ZIP não inclui, mas se você tiver a versão antiga local, delete essa pasta)
4. **Deploy frontend**: `git add . && git commit -m "v10: corrige pathing /perfil/sala, CSS wiki 404, breadcrumb não-navegável" && git push`
5. **Não precisa** rodar `node scripts/cache-bust.js` (já rodado, versão `?v=202607271620`)
6. **Não precisa** de migration nova nem deploy do worker (só frontend)

---

## 🧪 Verificações de sucesso (testar em produção após deploy)

### Bug 1 — Pathing `/perfil/sala`
1. Login como mestre → vá para `/perfil`
2. Clique em "Reabrir" em qualquer sala ativa
3. ✅ URL deve ser `https://rpgdoscria.github.io/sala?code=XXXXXX` (não `/perfil/sala?code=...`)
4. Sala abre normalmente

### Bug 2 — CSS da wiki
1. Acesse `https://rpgdoscria.github.io/wiki`
2. ✅ DevTools → Network → deve carregar `wiki-style.css?v=202607271620` com status 200 (antes era 404)
3. ✅ Sidebar de categorias aparece à ESQUERDA do conteúdo (240px de largura, fixa com scroll próprio)
4. ✅ Em desktop (≥769px), sidebar e conteúdo ficam lado a lado; em mobile (≤768px), empilham

### Bug 3 — Breadcrumb da wiki
1. Acesse qualquer página da wiki, ex: `/wiki/pagina?slug=situs-hatres-johnny`
2. ✅ Breadcrumb mostra: `Wiki › Lore/História › Situs Hatres / Johnny`
3. ✅ Clicar em "Wiki" → vai para `/wiki` (home da wiki)
4. ✅ Clicar em "Lore/História" → vai para `/wiki?category=Lore%2FHist%C3%B3ria` (home filtrada por categoria, mostra só páginas daquela categoria)
5. ✅ NÃO vai mais para `/wiki/pagina?category=...` (que não filtrava nada)

### Bugs extras — Copiar link da sala
1. Entre numa sala como mestre
2. Clique em "📋 Copiar link"
3. ✅ Cole em qualquer lugar — link deve ser `https://rpgdoscria.github.io/sala?code=XXXXXX` (não `https://...sala/sala?code=...`)
4. Em `/criar-sala`, clique em "Copiar" ao lado de uma sala ativa
5. ✅ Link deve ser `https://rpgdoscria.github.io/sala?code=XXXXXX` (não com origem duplicada)

### Bugs extras — Wikilinks `[[Nome]]`
1. Edite uma página da wiki, escreva `[[Personagens]]` no conteúdo
2. Salve e visualize
3. ✅ Clique no link → vai para `/wiki/pagina?slug=personagens` (absoluto)
4. ✅ Funciona mesmo se a página estiver sendo visualizada em `/wiki/pagina?slug=outra-coisa`

### Bugs extras — Redirects
1. Crie um personagem → após salvar, ✅ redireciona para `/meus-personagens` (não `/criar-personagem/meus-personagens`)
2. Troque senha → após salvar, ✅ redireciona para `/` (home, não `/change-password/index.html`)
3. Na wiki home, digite algo na busca e tecle Enter → ✅ vai para `/wiki?q=...` (não `/wiki/index.html?q=...`)

---

## 📌 Notas técnicas

- **Cache-bust**: todos os 18 HTMLs do projeto receberam nova versão `?v=202607271620`. Foram 130 substituições no total. Se você rodar `node scripts/cache-bust.js --check` agora, deve mostrar zero diferenças.
- **Sem mudanças no backend**: este patch é 100% frontend. Worker, migrations, secrets — nada mudou.
- **Sem mudanças na estrutura de URLs**: os paths limpos (`/sala`, `/wiki`, `/perfil`, etc.) continuam os mesmos. Só corrigimos links que estavam apontando para lugares errados.
- **Compatibilidade com legado**: as páginas `page/index.html`, `edit/index.html`, `history/index.html` (versões legacy fora de `/wiki/`) continuam funcionando com links absolutos corrigidos. Se você quiser removê-las no futuro (já que `/wiki/pagina`, `/wiki/editar`, `/wiki/historico` as substituem), fique à vontade — mas não é necessário para este patch.
