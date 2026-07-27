# Arquivos incluídos nesta entrega — Rpg dos Cria v13 (Refatoração Visual + Delete Sala + Inventário Melhorado)

Patch focado em 4 problemas reportados pelo usuário Odilon:

1. **Configuração de fichas para admin/mestre feia** — botões minúsculos (🔒/🔓/×) ao lado de cada stat, botão "editar" sobrepondo o nome, coisas stackadas. **Refatoração visual completa.**
2. **Sem função de deletar sala** — agora existe em `/criar-sala` e `/perfil`.
3. **"Criar item" sempre visível no inventário** — agora é colapsável (só aparece ao clicar "+ Novo item").
4. **Inventário sem opção de visualização** — agora tem toggle entre **Detalhado** (ícones grandes) e **Lista** (compacto).

---

## ✅ Validações rodadas

- `tsc --noEmit` no worker → **zero erros** (sem mudanças no backend)
- `node -c` em todos os JS modificados → **todos OK**
- Syntax check dos scripts inline (sala + criar-sala) → **OK**
- Validação de chaves CSS → `style.css` 1159/1159 ✓
- Cache-bust rodado → versão `?v=202607271851` em 18 HTMLs

---

## ✏️ Arquivos MODIFICADOS

### Frontend — Refatoração Visual de Fichas

| Caminho | Descrição |
|---------|-----------|
| `js/character-render.js` | **Refatoração completa**: (1) Removidos botões minúsculos 🔒/🔓/× de cada stat row — stats agora são limpos (só nome + valor + botões +/- quando editável). (2) Indicador de permissão agora é só um ícone pequeno informativo (não-botão) que aparece APENAS para o jogador dono (mestre não precisa ver — ele gerencia via painel). (3) Header refatorado: avatar + nome + owner em coluna limpa, sem botões sobrepostos. (4) Toolbar de ações horizontal com botões de tamanho CONSISTENTE (min-height 34px) e labels claras: "Gerenciar" (mestre), "Editar" (jogador), "Propor item" (jogador), "Inventário" (todos). (5) Removidos "meta-pills" que flutuavam sem clareza. (6) **NOVA função `renderManagePanel(ch)`** — gera o HTML do painel de gestão de personagem (lista todos os stats com botões de permissão e delete, organizados em linhas com info + ações). |

### Frontend — Painel de Gestão (novo modal)

| Caminho | Descrição |
|---------|-----------|
| `sala/index.html` | **Novo modal `#manage-character-modal`** — abre quando o mestre clica em "Gerenciar" no card do personagem. Mostra: avatar + nome + owner no header, seguido de lista de todos os stats com: nome, badge customizado (★), tipo, valor atual, e botões "🔓 Editável / 🔒 Bloqueado" (toggle permissão) + "🗑 Deletar". Botões têm tamanho decente (padding 6px 12px, font 12px) e labels claras. Otimismo: ao clicar em toggle, UI atualiza imediatamente (não espera WS round-trip). Ao deletar, linha desaparece do painel imediatamente. **Bindings atualizados**: `delete-stat` e `toggle-perm` agora são vinculados DENTRO do painel de gestão (não mais inline em cada stat). |

### Frontend — Inventário Refatorado

| Caminho | Descrição |
|---------|-----------|
| `sala/index.html` | **Modal de inventário refatorado**: (1) **Topbar nova** com título + toggle de visualização (Detalhado / Lista) + botão "+ Novo item" + botão fechar. (2) **Form de criar item ESCONDIDO por padrão** — só aparece ao clicar "+ Novo item" (toggle com classe `hidden`). Tem botão "Cancelar" (✕) para fechar. Após salvar, form esconde automaticamente. (3) **Toggle de visualização**: "Detalhado" (ícone 44×44 + nome + qty + descrição + botões "🎨 Ícone" / "🗑 Remover") vs "Lista" (ícone mini 24×24 + nome + qty + botões compactos). Cache de itens (`inventoryModalItems`) permite trocar de view sem recarregar da API. (4) Botões de ação têm labels claras (não só ícones minúsculos). |

### Frontend — Delete Sala

| Caminho | Descrição |
|---------|-----------|
| `sala/index.html` | (sem mudanças relacionadas a delete de sala) |
| `criar-sala/index.html` | **Botão "🗑 Excluir" agora aparece para TODAS as salas** (ativas e encerradas — antes só encerradas). Confirmação dupla para salas ativas: pede para digitar o nome da sala (mais seguro que só confirm). Layout refatorado: info da sala (nome + código + tag ativa/encerrada + data) agrupada à esquerda, ações agrupadas à direita. Tags visuais: verde "ativa" vs cinza "encerrada". |
| `js/perfil.js` | **Botão "🗑" adicionado** na lista de salas do perfil. Mesma confirmação dupla para salas ativas. Após excluir, mostra alerta de sucesso e recarrega a lista. Layout refatorado: info + ações agrupadas, tags visuais de status. |

### CSS

| Caminho | Descrição |
|---------|-----------|
| `css/style.css` | **+460 linhas** de CSS novo: `.character-actions-bar` / `.char-action-btn` (toolbar de ações com botões consistentes, hover lift, responsivo — labels somem em telas ≤600px), `.stat-perm-indicator` (ícone informativo não-botão), `.manage-panel-content` / `.manage-stat-row` / `.manage-perm-btn` / `.manage-delete-btn` (painel de gestão com linhas organizadas), `.inv-modal-topbar` / `.inv-view-toggle` / `.inv-view-btn` (topbar do inventário com toggle segmentado), `.inv-modal-row-compact` / `.inv-row-mini-*` / `.inv-item-icon-mini*` (visualização compacta), `.inv-modal-row-detailed` (visualização detalhada refinada), `.criar-sala-room-row` / `.criar-sala-room-info` / `.criar-sala-room-actions` (lista de salas refatorada), `.perfil-room-row` / `.perfil-room-info` / `.perfil-room-actions` (perfil refatorado), `.tag-on` (tag verde para salas ativas). Responsivo: em ≤480px manage-stat-row vira coluna; em ≤600px char-action-btn esconde labels. |

### Cache-bust (apenas `?v=` atualizado)

18 HTMLs com versão `?v=202607271851`.

---

## 📋 Lista completa de arquivos no patch

```
CHANGES.md                                                      (este arquivo)
css/style.css                                                   (modificado — CSS novo v13)
js/character-render.js                                          (modificado — refatoração visual + renderManagePanel)
js/perfil.js                                                    (modificado — delete sala + layout)
criar-sala/index.html                                           (modificado — delete sala + layout)
sala/index.html                                                 (modificado — painel gestão + inventário refatorado)
+ 18 HTMLs com cache-bust ?v=202607271851
```

**Total: 24 arquivos** (0 novos, 0 removidos, 5 modificados com features, 18 com cache-bust)

> **Nota**: Este patch inclui apenas os arquivos modificados nesta versão. Se você não aplicou os patches anteriores (v10-v12), precisa aplicá-los primeiro (eles contêm pathing, CSS wiki, permissões por stat, inventário popup, NPCs avançados, undo/redo, etc.). Este patch v13 é incremental sobre o v12.

---

## 🚀 Como aplicar

1. **Backup** (recomendado): `xcopy /E /I /Y . C:\Backup\rpg-wiki-antes-v13`
2. **Descompacte** este ZIP por cima da raiz do repositório (preserva estrutura de pastas)
3. **Deploy frontend**: `git add . && git commit -m "v13: refatoração visual fichas + delete sala + inventário melhorado" && git push`
4. **Não precisa** de migration nem deploy do worker (só frontend)
5. **Não precisa** rodar `node scripts/cache-bust.js` (já rodado, versão `?v=202607271851`)

---

## 🧪 Verificações de sucesso (testar em produção após deploy)

### 1. Ficha de personagem limpa (sem botões minúsculos)
1. Entre numa sala como mestre
2. Aba Personagens: cada card tem:
   - ✅ Header limpo: avatar + nome + "jogador: X" (sem botões sobrepostos)
   - ✅ Toolbar horizontal com botões de tamanho consistente: "⚙️ Gerenciar" + "✨ Status" + "🎒 Inventário"
   - ✅ Stats LIMPOS: só nome (uppercase, muted) + valor + botões +/- (quando editável)
   - ✅ **NÃO há mais** 🔒/🔓/× minúsculos em cada stat
3. Como jogador dono do personagem:
   - ✅ Vê indicador 🔒 (cinza) ou 🔓 (verde) ao lado do nome do stat (informativo, não-botão)
   - ✅ Botão "📦 Propor item" aparece na toolbar

### 2. Painel de Gestão (mestre)
1. Como mestre, clique em "⚙️ Gerenciar" no card de qualquer personagem
2. ✅ Modal abre com: avatar + nome + owner no header
3. ✅ Lista de todos os stats, cada um em uma linha com:
   - Nome + ★ (se custom) + tipo + valor atual
   - Botão "🔓 Editável" (verde) ou "🔒 Bloqueado" (vermelho)
   - Botão "🗑 Deletar"
4. ✅ Clicar em "🔓 Editável" → vira "🔒 Bloqueado" instantaneamente (otimismo)
5. ✅ Clicar em "🗑 Deletar" → confirma com nome do stat → linha desaparece do painel
6. ✅ A ficha do personagem (aba Personagens) atualiza em tempo real via WS

### 3. Inventário refatorado
1. Clique em "🎒 Inventário" de qualquer personagem
2. ✅ Topbar com: título + toggle "▦ Detalhado / ≡ Lista" + botão "+ Novo item" + ✕
3. ✅ **Form de criar item NÃO aparece** por padrão (antes ficava sempre visível)
4. Clique em "+ Novo item" → form aparece com foco no campo "Nome"
5. Clique em "✕ Cancelar" ou salve → form some
6. ✅ Toggle "≡ Lista": itens ficam compactos (ícone 24px + nome + qty em uma linha)
7. ✅ Toggle "▦ Detalhado": itens com ícone 44px + nome + qty + descrição + botões com labels
8. ✅ Botões de ação têm labels claras: "🎨 Ícone" e "🗑 Remover" (não só ícones minúsculos)

### 4. Deletar sala
1. Vá para `/criar-sala`
2. ✅ Toda sala (ativa ou encerrada) tem botão "🗑 Excluir"
3. Clique em "Excluir" de uma sala **encerrada** → confirma simples → exclui
4. Clique em "Excluir" de uma sala **ativa** → pede para digitar o nome da sala → só exclui se digitar correto
5. Vá para `/perfil` → mesmas salas têm botão 🗑 → mesma confirmação dupla para ativas

### 5. Layout das listas de sala
1. `/criar-sala` → lista de salas: info à esquerda (nome + código + tag status + data), ações à direita
2. ✅ Tag verde "ativa" ou cinza "encerrada"
3. `/perfil` → mesma estrutura, mais compacta

---

## 📌 Notas técnicas

- **Sem mudanças no backend**: este patch é 100% frontend. O endpoint `DELETE /api/rooms/:code` já existia (foi implementado no v11). Apenas a UI não mostrava o botão para salas ativas.
- **Otimismo no painel de gestão**: ao clicar em toggle permissão ou delete, a UI atualiza imediatamente sem esperar o WS round-trip. Se o WS falhar, o próximo `character_updated` broadcast vai corrigir o estado.
- **Cache de itens no inventário**: `inventoryModalItems` guarda os itens carregados para permitir trocar entre "Detalhado" e "Lista" sem recarregar da API. Após adicionar/remover item, a lista é recarregada.
- **Responsividade**: em telas ≤600px, os botões da toolbar do personagem escondem as labels (só ícones). Em ≤480px, as linhas do painel de gestão viram coluna.
- **Confirmação dupla para salas ativas**: excluir uma sala ativa desconecta todos os jogadores e apaga dados. Por isso pede para digitar o nome — é mais seguro que um simples "confirm".

---

## 🐛 Possíveis problemas

1. **Painel de gestão não abre**: verifique se `window.characterRender.renderManagePanel` existe no console. Se não, o cache-bust pode não ter pego — force reload (Ctrl+Shift+R).
2. **Botão "Gerenciar" não aparece**: só aparece para o mestre. Verifique se você está logado como admin/mestre.
3. **Toggle de visualização não funciona**: verifique se não há erro de JS no DevTools. O listener é registrado em `document.querySelectorAll("#inv-view-toggle .inv-view-btn")`.
4. **Delete de sala ativa falha**: verifique no DevTools → Network se o DELETE retornou 200. Se retornou 403, pode ser que você não é o dono da sala.
