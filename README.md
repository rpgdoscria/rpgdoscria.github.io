# Crônicas RPG — Wiki Colaborativa + Sala de Jogo em Tempo Real

Wiki privada para um grupo de RPG de mesa, com **sala de jogo ao vivo** (estilo Kahoot) hospedada pelo mestre. Frontend estático no **GitHub Pages**, backend em **Cloudflare Workers** (Hono + D1 + Durable Objects) e **Cloudinary** para imagens (free 25GB, sem cartão). Auth por JWT (HS256), senha com PBKDF2 via Web Crypto API nativa, parser de dados próprio (sem `eval`).

## O que isto é

Uma wiki markdown com:

- Login com JWT, papéis (`admin` / `editor` / `viewer`), rate limit de tentativas
- Bootstrap do **primeiro admin** via `X-Bootstrap-Key` (depois disso, o endpoint se auto-trava)
- Páginas markdown com preview ao vivo, links internos `[[Nome da Página]]`
- Histórico de revisões, diff lado-a-lado, reverter para revisão antiga
- Busca full-text (FTS5), backlinks, alterações recentes
- Painel admin: criar/editar/desativar usuários, ver log de auditoria
- Upload de imagens para Cloudinary direto do editor (free 25GB, sem cartão de crédito)
- Sanitização obrigatória (DOMPurify) de todo HTML gerado pelo markdown
- CORS restrito ao domínio do GitHub Pages (nunca `*`)
- Tema **preto default** com variáveis CSS — basta editar `frontend/css/style.css` (ou descomentar o link para `theme-custom.css`)

### Sala de Jogo em Tempo Real (nova feature)

- **Sala ao vivo via WebSocket**, hospedada pelo mestre, sincronizada para todos os jogadores em tempo real
- Cada sala é um **Durable Object** isolado (uma instância por código de sala)
- Fichas de personagem com HP, dinheiro, barras customizadas (Mana, Stamina, etc.), inventário, status effects
- Inimigos com **HP numérico** OU **descrição qualitativa** (presets: Ileso, Arranhado, Ferido, Gravemente ferido, À beira da morte, Derrotado — ou texto livre)
- Mestre aplica/adiciona/remove **status/adjetivos** em qualquer personagem ou inimigo
- Sistema de **dados com parser próprio** (sem `eval`): `1d20+5`, `2d6`, `2d20kh1` (vantagem), `4d6dl1` (descarta menor)
- Apenas o mestre rola; jogadores **sugerem fórmulas** que aparecem em destaque na tela do mestre com botão "Rolar agora"
- Reconexão automática com backoff exponencial — fechar e reabrir a aba restaura o estado completo
- Snapshots periódicos em D1 — sala **sobrevive a restart do Durable Object**
- Sala expira após 6h de inatividade (não acumula DOs abertos)
- Rate limit de 1 mensagem / 300ms por socket (evita flood)
- Mestre pode **travar a sala** (impede novas entradas depois que todos entraram)
- Indicador de conectividade visível ("Conectado" / "Reconectando…")
- Responsiva — jogadores usam celular, mestre usa tela grande

## Estrutura

```
rpg-wiki/
├── frontend/              # publicado no GitHub Pages
│   ├── index.html         # dashboard: alterações recentes + lista + busca
│   ├── login.html
│   ├── change-password.html  # exibida quando admin resetou senha (must_change_password=1)
│   ├── page.html          # visualização ?slug=
│   ├── edit.html          # editor split ?slug=  (ou ?title= para criar)
│   ├── history.html       # revisões + diff + reverter ?slug=
│   ├── admin.html         # painel admin
│   ├── sala-criar.html       # mestre: criar/gerenciar salas
│   ├── sala-mestre.html      # mestre: sala ao vivo (controle total)
│   ├── sala-jogador.html     # jogador: sala ao vivo (sua ficha editável + leitura dos outros)
│   ├── meus-personagens.html # CRUD de personagens do usuário
│   ├── css/
│   │   ├── style.css          # tema preto default (variáveis em :root)
│   │   └── theme-custom.css   # linkado em todos HTMLs; vazio por padrão, edita para mudar tema
│   ├── js/
│   │   ├── config.js          # ← APENAS este arquivo precisa editar (API_BASE)
│   │   ├── api.js             # fetch wrapper + 401 handler
│   │   ├── auth.js            # login/logout/sessão + header comum + força change-password
│   │   ├── markdown.js        # marked + DOMPurify + parser de [[links]]
│   │   ├── editor.js          # editor + preview + upload + detecção de edição simultânea
│   │   ├── admin.js
│   │   ├── room-ws.js         # cliente WebSocket (reconexão automática, sync de estado)
│   │   ├── dice-ui.js         # parser de preview + construtor visual de fórmulas
│   │   └── room-render.js     # render fichas/inimigos/status (com sanitização)
│   └── vendor/
│       ├── marked.min.js
│       └── purify.min.js
├── worker/                # backend Cloudflare Worker
│   ├── src/
│   │   ├── index.ts       # Hono app + middleware global + rota WS /api/rooms/connect
│   │   ├── env.ts         # tipo Env (bindings + secrets)
│   │   ├── lib/
│   │   │   ├── crypto.ts      # PBKDF2 + JWT HS256 via Web Crypto
│   │   │   ├── db.ts          # helpers de query + audit log
│   │   │   ├── middleware.ts  # CORS + authParser + requireRole + rate limit
│   │   │   └── dice-parser.ts # parser de dados seguro (sem eval) + roller
│   │   ├── durable-objects/
│   │   │   └── RoomDO.ts      # sala: WebSocket, broadcast, snapshot, auth, rate limit
│   │   ├── routes/
│   │   │   ├── auth.ts    # /login, /me, /change-password, /admin/bootstrap
│   │   │   ├── pages.ts   # CRUD + revisões + backlinks + busca
│   │   │   ├── admin.ts   # usuários + audit-log
│   │   │   ├── upload.ts  # Cloudinary (PNG/JPEG/WebP/GIF, magic bytes validados, assinatura SHA-1)
│   │   │   └── rooms.ts   # salas + personagens + presets de dados
│   │   └── migrations/
│   │       ├── 0001_init.sql     # wiki (users, pages, revisions, audit_log, login_attempts, pages_fts)
│   │       └── 0002_rooms.sql    # sala (characters, dice_presets, room_snapshots, dice_log, is_game_master)
│   ├── wrangler.toml
│   ├── package.json
│   └── tsconfig.json
└── .github/workflows/
    └── deploy-pages.yml   # publica /frontend no GitHub Pages
```

## Pré-requisitos

- Node.js 20+
- Conta Cloudflare (gratuita serve)
- Conta GitHub
- `npm install -g wrangler` e `wrangler login`

## Setup do backend (uma vez)

### 1. Instalar dependências

```bash
cd worker
npm install
```

### 2. Criar o banco D1

```bash
npx wrangler d1 create rpg-wiki-db
```

O comando imprime um `database_id`. **Copie** e cole em `worker/wrangler.toml` no campo `database_id` do binding `[[d1_databases]]`.

### 3. Criar conta Cloudinary (para upload de imagens)

R2 foi removido porque exige cartão de crédito mesmo no free tier. Usamos **Cloudinary** no lugar: 25 GB free, 25 GB de bandwidth, CDN global, sem cartão.

1. Crie conta em [cloudinary.com](https://cloudinary.com) (plano free, sem cartão)
2. Após signup, vá no **Dashboard**
3. Anote:
   - **Cloud Name** (algo como `dx9abc123` — público, vai em wrangler.toml)
   - **API Key** (sensível — vai como `wrangler secret put`)
   - **API Secret** (sensível — vai como `wrangler secret put`)

Coloque o Cloud Name no `wrangler.toml`:
```toml
CLOUDINARY_CLOUD_NAME = "dx9abc123"   # seu cloud name real
```

Salve os outros dois como secrets (Passo 7 abaixo).

### 4. Rodar as migrations

Local (para testar antes de publicar):

```bash
npm run db:migrate:local
```

Remoto (ja no D1 de produção):

```bash
npm run db:migrate:remote
```

> **Importante:** rode AMBAS as migrations (`0001_init.sql` cria o schema da wiki; `0002_rooms.sql` adiciona o schema da sala de jogo — `characters`, `dice_presets`, `room_snapshots`, `dice_log`, e a coluna `is_game_master` em `users`). O Wrangler aplica todas automaticamente na ordem.

### 5. Definir os secrets

```bash
# Segredo usado para assinar/verificar JWT (HS256). Gere algo longo e aleatório.
npx wrangler secret put JWT_SECRET
# (cole uma string de 32+ caracteres — ex: openssl rand -base64 48)

# Chave de bootstrap do primeiro admin. Pode descartar depois.
npx wrangler secret put ADMIN_BOOTSTRAP_KEY
# (cole outra string aleatória — ex: openssl rand -base64 32)
```

### 6. Configurar origins no `wrangler.toml`

Edite as variáveis `[vars]`:

```toml
[vars]
CORS_ORIGIN = "http://localhost:8000"            # para testar local
PAGES_ORIGIN = "https://SEU_USUARIO.github.io"   # seu GitHub Pages real
```

### 7. Definir os secrets do Cloudinary

Pegue sua API Key e API Secret do dashboard do Cloudinary (Passo 3):

```bash
npx wrangler secret put CLOUDINARY_API_KEY
# cole a API Key

npx wrangler secret put CLOUDINARY_API_SECRET
# cole a API Secret
```

> Cloudinary serve imagens automaticamente via CDN global — não precisa configurar domínio público como no R2.

### 8. Deploy do Worker

```bash
npm run deploy
```

O Wrangler imprime a URL final, algo como `https://rpg-wiki-api.SEU_SUBDOMAIN.workers.dev`. **Copie**.

### 9. Criar o primeiro admin (bootstrap)

```bash
curl -X POST https://rpg-wiki-api.SEU_SUBDOMAIN.workers.dev/api/admin/bootstrap \
  -H "Content-Type: application/json" \
  -H "X-Bootstrap-Key: COLE_A_ADMIN_BOOTSTRAP_KEY_AQUI" \
  -d '{"username":"admin","password":"uma_senha_forte_aqui"}'
```

Se receber `201 Created`, o admin foi criado. **Depois disso, este endpoint nunca mais funciona** — qualquer chamada futura retorna `409 Conflict`.

## Setup do frontend

### 1. Apontar para o Worker

Edite **`frontend/js/config.js`**:

```js
window.WIKI_CONFIG = {
  API_BASE: "https://rpg-wiki-api.SEU_SUBDOMAIN.workers.dev",
  SITE_NAME: "Crônicas RPG",
  ENABLE_THEME_TOGGLE: false,
};
```

### 2. Subir para o GitHub

1. Crie um repositório no GitHub (ex: `rpg-wiki`).
2. `git init && git add . && git commit -m "init" && git remote add origin … && git push -u origin main`.
3. No GitHub: **Settings → Pages → Source: GitHub Actions**.
4. Faça um push qualquer na `main` para disparar o workflow `.github/workflows/deploy-pages.yml`.

A URL final será `https://SEU_USUARIO.github.io/rpg-wiki/`.

### 3. Voltar ao wrangler.toml e bater o `PAGES_ORIGIN` correto

Se o seu GitHub Pages for `https://joao.github.io/rpg-wiki/`, então:

```toml
PAGES_ORIGIN = "https://joao.github.io"
```

(CORS valida só a origin, sem path.)

Re-deploy do Worker:

```bash
cd worker && npm run deploy
```

## Rodar localmente

```bash
# Terminal 1 — Worker em http://localhost:8787
cd worker
npm run db:migrate:local
npm run dev

# Terminal 2 — frontend estático em http://localhost:8000
cd frontend
python3 -m http.server 8000
```

Edite `frontend/js/config.js` → `API_BASE: "http://localhost:8787"` e `wrangler.toml` → `CORS_ORIGIN = "http://localhost:8000"`.

> Para usar o bootstrap localmente, crie o arquivo `worker/.dev.vars` com:
> ```
> JWT_SECRET=qualquer-coisa-local
> ADMIN_BOOTSTRAP_KEY=chave-bootstrap-local
> ```
> **Nunca** comite `.dev.vars` (já está no `.gitignore`).

## Customizar o tema (aparência)

Tudo é controlado por variáveis CSS em `frontend/css/style.css` no bloco `:root`:

```css
:root {
  --bg: #0a0a0c;             /* fundo principal */
  --bg-elev: #141418;        /* header, cards */
  --surface: #1a1a1f;        /* inputs, listras */
  --border: #2a2a31;
  --text: #e8e8ea;
  --text-muted: #9a9aa3;
  --accent: #a78bfa;         /* roxo arcano — links, botões */
  --accent-hover: #bca0ff;
  --accent-fg: #0a0a0c;      /* texto sobre fundo accent */
  --link-missing: #ef4444;   /* [[página inexistente]] */
  --font-serif: 'Lora', Georgia, serif;
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', Menlo, monospace;
  --content-max: 880px;      /* largura máxima do conteúdo */
}
```

### Sem mexer no default

Descomente o `<link rel="stylesheet" href="css/theme-custom.css">` em todos os HTMLs e edite só `theme-custom.css`. Ele já vem com três exemplos comentados (verde-floresta, vermelho-sangue, azul-real). Assim você mantém o default intacto para updates.

### Trocar fontes

As fontes vêm do Google Fonts via `<link>` no `<head>` de cada HTML. Para usar outra, troque o `<link>` e a variável `--font-*`.

## Fluxo de uso típico

### Wiki

1. Admin faz bootstrap → entra no `/admin.html`.
2. Cria usuários `editor` e `viewer` para o resto do grupo.
3. Editores criam páginas. Cada salvamento gera uma revisão.
4. Links `[[Personagem]]` aparecem em vermelho tracejado até a página existir — clicar leva direto ao editor com o título pré-preenchido.
5. Histórico permite ver diff e reverter.
6. `viewer` consegue ler tudo, mas não edita. O botão "Editar"some e o backend rejeita PUT/POST com `403`.
7. Auditoria registra criação/edição/exclusão/reversão/upload/login.

### Sala de Jogo (durante a sessão de RPG)

1. **Mestre habilita permissão**: no painel admin, marque `is_game_master=1` para os usuários que podem criar salas (ou deixe só o admin criar — admin sempre pode).
2. **Jogadores cadastram personagens**: cada jogador entra em `meus-personagens.html` e cria seus personagens (nome, HP, dinheiro, etc.). Esses personagens ficam salvos no D1 e podem ser reusados em múltiplas sessões.
3. **Mestre cria a sala**: entra em `sala-criar.html`, seleciona quais personagens entram nesta sessão, clica em "Criar sala". Recebe um código de 6 caracteres (ex: `K7P3M2`).
4. **Mestre compartilha o código**: manda o código pros jogadores (WhatsApp, papel, etc).
5. **Mestre abre sua sala**: clica em "Reabrir como mestre" — abre `sala-mestre.html?code=K7P3M2`. Tem controle total: rolar dados, criar inimigos, aplicar status em qualquer um.
6. **Jogadores entram**: cada um abre `sala-jogador.html?code=K7P3M2`. Escolhe qual personagem usar. Vê todos na mesa (leitura) e edita só o próprio.
7. **Durante a sessão**:
   - Mestre rola `1d20` → todos veem o resultado ao mesmo tempo, com animação de destaque.
   - Jogador sugere "Ataque com espada (1d20+5)" → aparece em destaque na tela do mestre, com botão "Rolar agora".
   - Mestre cria inimigo "Goblin" com HP 15/15.
   - Mestre aplica status "Envenenado" no personagem do jogador X — todo mundo vê o badge amarelo.
   - Mestre troca inimigo de HP numérico para descrição qualitativa ("Ferido") sem perder o inimigo.
   - Jogador derruba o próprio HP de 30 para 12 — todos veem a barra ficar laranja.
   - Celular do jogador caiu? Ele reabre a página, escolhe o mesmo personagem, e o estado completo é restaurado automaticamente.
8. **Fim da sessão**: mestre clica em "Encerrar sala". Todos são desconectados, snapshot final é salvo em D1 (auditoria).

## Endpoints

| Método | Rota                              | Auth mínima | Descrição |
|---|---|---|---|
| POST | `/api/admin/bootstrap`            | X-Bootstrap-Key | Cria o primeiro admin (uma única vez) |
| POST | `/api/auth/login`                 | —            | Login, devolve JWT |
| GET  | `/api/auth/me`                    | viewer       | Dados do usuário logado |
| POST | `/api/auth/change-password`       | viewer       | Usuário troca a própria senha (quando must_change_password=1) |
| GET  | `/api/pages`                      | viewer       | Lista + busca (?q=) + filtro (?category=) |
| GET  | `/api/pages/:slug`                | viewer       | Página atual |
| POST | `/api/pages`                      | editor       | Criar página |
| PUT  | `/api/pages/:slug`                | editor       | Editar (cria revisão; aceita `expected_updated_at` para detecção de edição simultânea) |
| DELETE | `/api/pages/:slug`              | admin        | Excluir página |
| GET  | `/api/pages/:slug/revisions`      | viewer       | Lista de revisões |
| GET  | `/api/pages/:slug/revisions/:id`  | viewer       | Revisão específica |
| POST | `/api/pages/:slug/revert/:id`     | editor       | Reverter para revisão |
| GET  | `/api/pages/:slug/backlinks`      | viewer       | Páginas que linkam para esta |
| GET  | `/api/admin/users`                | admin        | Lista usuários |
| POST | `/api/admin/users`                | admin        | Criar usuário |
| PATCH | `/api/admin/users/:id`           | admin        | Editar role/active/senha |
| DELETE | `/api/admin/users/:id`          | admin        | Desativar (soft) |
| GET  | `/api/admin/audit-log`            | admin        | Log de auditoria |
| POST | `/api/upload`                     | editor       | Upload de imagem para Cloudinary (PNG/JPEG/WebP/GIF, máx 5 MB, magic bytes validados) |
| POST | `/api/rooms`                      | is_game_master ou admin | Cria sala (gera código de 6 chars) |
| GET  | `/api/rooms`                      | autenticado | Lista salas ativas do usuário (como mestre) |
| GET  | `/api/rooms/:code`                | autenticado | Info de uma sala |
| POST | `/api/rooms/:code/end`            | mestre da sala | Encerra sala |
| GET  | `/api/rooms/connect`              | WebSocket (JWT via query string) | Conecta à sala em tempo real |
| GET  | `/api/rooms/characters`           | autenticado | Lista personagens do usuário |
| POST | `/api/rooms/characters`           | autenticado | Cria personagem |
| PUT  | `/api/rooms/characters/:id`       | dono | Edita personagem |
| DELETE | `/api/rooms/characters/:id`     | dono | Apaga personagem |
| GET  | `/api/rooms/dice-presets`         | autenticado | Lista presets (próprios + públicos) |
| POST | `/api/rooms/dice-presets`         | autenticado | Cria preset de fórmula |
| DELETE | `/api/rooms/dice-presets/:id`   | dono | Apaga preset |

### Notação de dados suportada (parser seguro, sem `eval`)

| Notação | Significado | Exemplo |
|---|---|---|
| `NdS` | N dados de S lados | `2d6`, `1d20` |
| `+X` / `-X` | Modificador fixo | `1d20+5`, `1d8-2` |
| `A+B+C` | Múltiplos termos | `1d20+2d6+3` |
| `NdSkhK` | Mantém os K maiores | `2d20kh1` (vantagem) |
| `NdSklK` | Mantém os K menores | `2d20kl1` (desvantagem) |
| `NdSdhK` | Descarta os K maiores | `4d6dh1` |
| `NdSdlK` | Descarta os K menores | `4d6dl1` (geração de atributos) |

Limites de segurança: máx 100 dados por termo, 1000 lados, 20 termos, 200 caracteres. Quaisquer entradas fora dessa gramática são rejeitadas com erro claro — incluindo tentativas de injeção como `1d20+process.exit()`, `1d20; new Function(...)`, etc.

## Segurança — checklist

- [x] Nenhuma senha ou secret hardcoded no código.
- [x] CORS restrito ao domínio do GitHub Pages (`PAGES_ORIGIN`), nunca `*`.
- [x] Todo HTML gerado pelo markdown passa por DOMPurify antes de virar `innerHTML`.
- [x] Bootstrap do admin só executa uma vez (recusa se já existe admin).
- [x] Rate limit: 5 falhas em 15 min bloqueiam username E ip.
- [x] `viewer` é bloqueado pelo backend em rotas de escrita (não só escondido no front).
- [x] JWT expira em 7 dias. 401 no front limpa token e redireciona para login.
- [x] Senha com PBKDF2-SHA256, 100k iterações, salt aleatório de 16 bytes por usuário.
- [x] Não pode desativar/rebaixar o último admin ativo (trava no backend).
- [x] `DELETE /admin/users/:id` é soft-delete (preserva histórico de edições).
- [x] `console.log` nunca recebe senha, hash ou token.
- [x] Rate limit por IP também (não só por username) — dificulta enumeração.

### Sala de Jogo — checklist específica

- [x] **WebSocket valida JWT** na query string com a mesma lógica do REST — sem caminho de auth paralelo mais fraco.
- [x] **Entrar na sala exige JWT válido E código da sala** — nunca só um dos dois.
- [x] **Parser de dados sem `eval`/`new Function`** — só parser manual com whitelist de tokens. Injeções (`process.exit()`, `new Function(...)`, etc.) rejeitadas.
- [x] **Permissões checadas no `RoomDO`** (não só no front): jogador não consegue rodar dados, criar inimigos, aplicar status ou editar personagem de outro mandando mensagem WS manual.
- [x] **Rate limit por socket** (1 msg / 300ms) — evita flood.
- [x] **Validação de entrada**: HP, dinheiro, quantidades são clamp-int com limites duros. Status/descrição têm limite de 200 chars e são sanitizados.
- [x] **Textos livres** (status, descrição de inimigo, label de fórmula) passam por `DOMPurify.sanitize` + `escapeHtml` antes de renderizar.
- [x] **Reconexão restaura estado completo** — cliente recebe `room_state` ao conectar/reconectar, não fica em branco.
- [x] **Snapshot sobrevive a restart do DO** — salvo no storage interno do DO E em D1 (`room_snapshots`).
- [x] **Sala expira** após 6h de inatividade via `alarm()` do Durable Object.
- [x] **Mestre pode travar sala** — backend rejeita novas conexões se `locked=true` (exceto o próprio mestre).
- [x] **Apenas mestre encerra** — `end_room` checa `conn.isMaster` no DO.
- [x] **Rolagem criptográfica** — `crypto.getRandomValues` com re-roll para evitar modulo bias.

## Backups

Para um backup manual de todas as páginas:

```bash
# Roda do diretório worker/, depois de wrangler login
npx wrangler d1 execute rpg-wiki-db --remote --command "SELECT slug, title, category, content_md FROM pages ORDER BY title" --output json > backup.json
```

## Troubleshooting

**CORS bloqueando requests no GitHub Pages**: confira `PAGES_ORIGIN` no `wrangler.toml` (sem path, sem barra final) e re-deploy do Worker.

**Login retorna 401 mesmo com credenciais corretas**: o `JWT_SECRET` foi trocado? Qualquer mudança invalida todos os tokens existentes — usuários precisam logar de novo.

**Bootstrap retorna 409**: comportamento esperado se já existe um admin. Para criar outro admin, use o painel admin (`/admin.html`).

**Páginas FTS não retornam resultados**: a tabela `pages_fts` é mantida por triggers. Se você importou dados manualmente sem os triggers rodarem, reconstrua:

```sql
INSERT INTO pages_fts(pages_fts) VALUES('rebuild');
```

**Imagens não aparecem no editor**: Cloudinary não configurado. Veja Passo 3 e 7 do setup — precisa de Cloud Name em `wrangler.toml` + API Key/Secret como `wrangler secret put`. Re-deploy do Worker.

## Licença

Privado, uso interno do grupo. Código livre para adaptar.
