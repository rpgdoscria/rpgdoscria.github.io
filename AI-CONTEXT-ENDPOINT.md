# Endpoint de contexto da Wiki para agentes de IA

Este projeto disponibiliza um endpoint **somente leitura** para um agente de IA consultar a wiki e os dados importantes do RPG antes de propor ou escrever novas seções.

## Acesso

```text
GET https://rpg-wiki-api.genericbr-paypal.workers.dev/api/ai/context
Header: X-Wiki-Context-Key: <AI_CONTEXT_KEY>
```

A chave fica configurada como o secret `AI_CONTEXT_KEY` do Cloudflare Worker. Nunca envie a chave na URL, em prompts públicos, no código do site ou em logs. O endpoint devolve `401` sem a chave ou com uma chave incorreta e `503` se o secret não estiver configurado.

Exemplo com cURL:

```bash
curl -sS \
  -H "X-Wiki-Context-Key: ${AI_CONTEXT_KEY}" \
  "https://rpg-wiki-api.genericbr-paypal.workers.dev/api/ai/context"
```

Exemplo em JavaScript:

```js
const response = await fetch(
  "https://rpg-wiki-api.genericbr-paypal.workers.dev/api/ai/context",
  { headers: { "X-Wiki-Context-Key": process.env.AI_CONTEXT_KEY } }
);
const context = await response.json();
```

## Conteúdo da resposta

O JSON contém:

- `readOnly`: sempre `true` neste endpoint.
- `wiki.categories`: categorias existentes.
- `wiki.pages`: todas as páginas, seus títulos, slugs, categorias e conteúdo Markdown. Como o acesso é protegido por uma chave própria da integração, páginas secretas também aparecem; trate a resposta como informação confidencial.
- `chronicles`: crônicas ligadas aos personagens, com título, resumo, capa e `contentMd`.
- `rpg.statTemplates`: modelos de status disponíveis.
- `rpg.ruleSets`: conjuntos de regras e seus status.
- `rpg.characters`: personagens, donos, atributos, inventário e efeitos de status.
- `rpg.rooms`: metadados das salas persistidas.
- `rpg.latestRoomSnapshots`: último estado salvo de cada sala, incluindo personagens, NPCs e inimigos.

## Fluxo recomendado para o agente

1. Faça uma única leitura do endpoint no início da tarefa e mantenha a resposta apenas em memória.
2. Use `wiki.pages` como fonte principal de regras, cenário e terminologia. Procure por `slug`, `title` e `category` antes de sugerir uma nova seção.
3. Consulte `chronicles` para respeitar a história já estabelecida de cada personagem.
4. Não invente que uma informação existe: diferencie fatos encontrados na resposta de sugestões novas.
5. Ao criar conteúdo, prefira Markdown comum e use Markdown avançado/GFM quando precisar de tabelas, listas de tarefas, citações ou blocos de código.
6. Para conectar páginas, use `[[Nome da página]]` ou `[[Nome da página|texto do link]]`.
7. Para imagens, use `![descrição](https://endereco-publico/imagem.png)`. A interface de crônicas também oferece o botão “Inserir imagem”.
8. Este endpoint não aceita `POST`, `PUT`, `PATCH` ou `DELETE`. Qualquer gravação deve passar por uma ação autenticada e autorizada da aplicação, nunca pela chave de contexto.

## Limites e segurança

- A resposta usa `Cache-Control: no-store`.
- O endpoint não recebe a chave por query string.
- A chave deve ser armazenada em um secret do ambiente do agente, por exemplo `AI_CONTEXT_KEY`, e não em arquivos versionados.
- Não publique a resposta completa: ela pode conter inventários, dados de salas e páginas secretas.
- Se o endpoint retornar erro, pare e informe o operador; não tente contornar a proteção nem use endpoints de escrita.

## Operações da aplicação relacionadas

As crônicas são persistidas pela API autenticada em `/api/chronicles`. A página `/cronicas?characterId=<id>` permite visualizar, editar e vincular histórias aos personagens. O endpoint de contexto apenas lê esse material para auxiliar o planejamento do agente.
