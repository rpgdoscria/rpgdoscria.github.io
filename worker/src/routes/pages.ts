// routes/pages.ts — CRUD de páginas + revisões + backlinks + busca
//
// Permissões:
//   - GET (leitura, histórico, backlinks): qualquer autenticado (viewer+)
//   - POST/PUT/revert: editor+
//   - DELETE: admin

import { Hono } from "hono";
import type { Env } from "../env";
import type { JwtPayload } from "../lib/crypto";
import { slugify } from "../lib/crypto";
import { audit, queryAll, queryFirst, queryRun } from "../lib/db";
import { requireRole } from "../lib/middleware";

export const pageRoutes = new Hono<{ Bindings: Env; Variables: { user?: JwtPayload } }>();

const DEFAULT_CATEGORIES = [
  "Personagens",
  "Locais",
  "Itens & Equipamentos",
  "Lore/História",
  "Sessões Jogadas",
  "Regras da Casa",
  "Criaturas",
];

// GET /api/pages?category=&q=
pageRoutes.get("/", async (c) => {
  const category = c.req.query("category");
  const q = c.req.query("q")?.trim();

  // Busca full-text (FTS5)
  if (q) {
    // Sanitiza query: remove aspas para evitar FTS5 syntax injection.
    const safe = q.replace(/["']/g, " ").trim();
    if (safe.length >= 2) {
      const rows = await queryAll<{
        id: number;
        slug: string;
        title: string;
        category: string;
        snippet: string;
        updated_at: string;
      }>(
        c.env.DB,
        `SELECT p.id, p.slug, p.title, p.category, p.updated_at,
                snippet(pages_fts, 1, '<mark>', '</mark>', '…', 12) AS snippet
         FROM pages_fts f
         JOIN pages p ON p.id = f.rowid
         WHERE pages_fts MATCH ?
         ORDER BY rank
         LIMIT 50`,
        `${safe}*`
      );
      return c.json({ results: rows, categories: DEFAULT_CATEGORIES });
    }
  }

  // Listagem simples (com filtro opcional de categoria)
  const rows = await queryAll<{
    id: number;
    slug: string;
    title: string;
    category: string;
    updated_at: string;
    author: string;
  }>(
    c.env.DB,
    category
      ? `SELECT p.id, p.slug, p.title, p.category, p.updated_at, u.username AS author
         FROM pages p JOIN users u ON u.id = p.created_by
         WHERE p.category = ?
         ORDER BY p.updated_at DESC LIMIT 200`
      : `SELECT p.id, p.slug, p.title, p.category, p.updated_at, u.username AS author
         FROM pages p JOIN users u ON u.id = p.created_by
         ORDER BY p.updated_at DESC LIMIT 200`,
    ...(category ? [category] : [])
  );

  // Alterações recentes (10 últimas revisões) — sempre no dashboard
  const recent = await queryAll<{
    id: number;
    page_slug: string;
    page_title: string;
    editor: string;
    comment: string | null;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT r.id, p.slug AS page_slug, p.title AS page_title,
            u.username AS editor, r.comment, r.created_at
     FROM revisions r
     JOIN pages p ON p.id = r.page_id
     JOIN users u ON u.id = r.editor_id
     ORDER BY r.created_at DESC LIMIT 15`
  );

  return c.json({ pages: rows, recent, categories: DEFAULT_CATEGORIES });
});

// GET /api/pages/:slug
pageRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const page = await queryFirst<{
    id: number;
    slug: string;
    title: string;
    category: string;
    content_md: string;
    created_at: string;
    updated_at: string;
    author: string;
  }>(
    c.env.DB,
    `SELECT p.id, p.slug, p.title, p.category, p.content_md,
            p.created_at, p.updated_at, u.username AS author
     FROM pages p JOIN users u ON u.id = p.created_by
     WHERE p.slug = ?`,
    slug
  );
  if (!page) return c.json({ error: "Página não encontrada." }, 404);
  return c.json(page);
});

// POST /api/pages  — criação (editor+)
pageRoutes.post("/", requireRole("editor"), async (c) => {
  const user = c.get("user") as JwtPayload;
  let body: { title?: string; category?: string; content_md?: string; comment?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON inválido." }, 400);
  }
  const title = (body.title ?? "").trim();
  const content_md = body.content_md ?? "";
  const category = (body.category ?? "Lore/História").trim() || "Lore/História";
  const comment = (body.comment ?? "").trim() || "Criação da página";

  if (title.length < 1) return c.json({ error: "Título obrigatório." }, 400);

  let slug = slugify(title);
  if (!slug) slug = `pagina-${Date.now()}`;

  // Garante slug único. BUG CORRIGIDO: antes, se o slug colidisse, gerávamos
  // um sufixo aleatório de 4 chars sem checar se ELE também colidia (raro,
  // mas possível). Agora tentamos até 5x com sufixo maior.
  let attempt = 0;
  while (attempt < 5) {
    const clash = await queryFirst<{ id: number }>(c.env.DB, `SELECT id FROM pages WHERE slug = ?`, slug);
    if (!clash) break;
    slug = `${slug}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;
    attempt++;
  }

  // BUG CORRIGIDO: antes fazíamos INSERT page seguido de INSERT revision em
  // duas chamadas separadas; se a segunda falhasse, a página ficava sem
  // revisão inicial (inconsistência). Agora usamos batch (transação atômica).
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO pages (slug, title, category, content_md, created_by)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(slug, title, category, content_md, user.sub),
    // Segunda statement usa last_insert_rowid() para referenciar a page recém-criada
    c.env.DB.prepare(
      `INSERT INTO revisions (page_id, content_md, editor_id, comment)
       VALUES (last_insert_rowid(), ?, ?, ?)`
    ).bind(content_md, user.sub, comment),
  ]);

  const pageId = result[0]?.meta?.last_row_id as number;

  await audit(c.env.DB, user.sub, "page.create", slug, `title="${title}"`);
  return c.json({ ok: true, slug, id: pageId }, 201);
});

// PUT /api/pages/:slug — edita e cria nova revisão (editor+)
pageRoutes.put("/:slug", requireRole("editor"), async (c) => {
  const user = c.get("user") as JwtPayload;
  const slug = c.req.param("slug");
  let body: { title?: string; category?: string; content_md?: string; comment?: string; expected_updated_at?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON inválido." }, 400);
  }

  const existing = await queryFirst<{ id: number; slug: string; updated_at: string }>(
    c.env.DB,
    `SELECT id, slug, updated_at FROM pages WHERE slug = ?`,
    slug
  );
  if (!existing) return c.json({ error: "Página não encontrada." }, 404);

  // Detecção de edição simultânea: se o cliente enviou expected_updated_at
  // (timestamp que ele viu ao abrir o editor), e a página foi editada por
  // outra pessoa depois disso, retornamos 409 para o cliente avisar o usuário.
  if (body.expected_updated_at && body.expected_updated_at !== existing.updated_at) {
    return c.json({
      error: "Esta página foi editada por outra pessoa enquanto você editava. Recarregue a página e tente novamente.",
      conflict: true,
      current_updated_at: existing.updated_at,
    }, 409);
  }

  const title = (body.title ?? "").trim();
  const category = (body.category ?? "").trim();
  const content_md = body.content_md;
  const comment = (body.comment ?? "").trim() || "Edição";

  if (title.length < 1) return c.json({ error: "Título obrigatório." }, 400);
  // BUG CORRIGIDO: antes `body.content_md ?? ""` — se o cliente esquecesse o
  // campo, o conteúdo da página era silenciosamente apagado. Agora exigimos
  // explicitamente que o campo esteja presente (mesmo que seja string vazia).
  if (content_md === undefined || content_md === null) {
    return c.json({ error: "content_md é obrigatório no corpo da requisição." }, 400);
  }

  // Atualiza página + cria revisão numa transação
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE pages
       SET title = ?, category = COALESCE(NULLIF(?, ''), category), content_md = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(title, category, content_md, existing.id),
    c.env.DB.prepare(
      `INSERT INTO revisions (page_id, content_md, editor_id, comment) VALUES (?, ?, ?, ?)`
    ).bind(existing.id, content_md, user.sub, comment),
  ]);

  await audit(c.env.DB, user.sub, "page.update", slug, comment);
  return c.json({ ok: true, slug });
});

// DELETE /api/pages/:slug — admin only
pageRoutes.delete("/:slug", requireRole("admin"), async (c) => {
  const user = c.get("user") as JwtPayload;
  const slug = c.req.param("slug");
  const existing = await queryFirst<{ id: number }>(c.env.DB, `SELECT id FROM pages WHERE slug = ?`, slug);
  if (!existing) return c.json({ error: "Página não encontrada." }, 404);

  // BUG CORRIGIDO: o schema declara `ON DELETE CASCADE` em revisions.page_id,
  // mas o D1/SQLite NÃO habilita `PRAGMA foreign_keys = ON` por padrão. Confiar
  // no CASCADE deixaria revisões órfãs no banco. Removemos explicitamente.
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM revisions WHERE page_id = ?`).bind(existing.id),
    c.env.DB.prepare(`DELETE FROM pages WHERE id = ?`).bind(existing.id),
  ]);
  await audit(c.env.DB, user.sub, "page.delete", slug, null);
  return c.json({ ok: true });
});

// GET /api/pages/:slug/revisions
pageRoutes.get("/:slug/revisions", async (c) => {
  const slug = c.req.param("slug");
  const rows = await queryAll<{
    id: number;
    content_md: string;
    editor: string;
    editor_id: number;
    comment: string | null;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT r.id, r.content_md, r.comment, r.created_at, r.editor_id, u.username AS editor
     FROM revisions r
     JOIN pages p ON p.id = r.page_id
     JOIN users u ON u.id = r.editor_id
     WHERE p.slug = ?
     ORDER BY r.created_at DESC LIMIT 200`,
    slug
  );
  return c.json({ revisions: rows });
});

// GET /api/pages/:slug/revisions/:revId
pageRoutes.get("/:slug/revisions/:revId", async (c) => {
  const slug = c.req.param("slug");
  const revId = Number(c.req.param("revId"));
  if (!Number.isInteger(revId)) return c.json({ error: "revId inválido." }, 400);

  const rev = await queryFirst<{
    id: number;
    content_md: string;
    editor: string;
    comment: string | null;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT r.id, r.content_md, r.comment, r.created_at, u.username AS editor
     FROM revisions r
     JOIN pages p ON p.id = r.page_id
     JOIN users u ON u.id = r.editor_id
     WHERE p.slug = ? AND r.id = ?`,
    slug,
    revId
  );
  if (!rev) return c.json({ error: "Revisão não encontrada." }, 404);
  return c.json(rev);
});

// POST /api/pages/:slug/revert/:revId — editor+
pageRoutes.post("/:slug/revert/:revId", requireRole("editor"), async (c) => {
  const user = c.get("user") as JwtPayload;
  const slug = c.req.param("slug");
  const revId = Number(c.req.param("revId"));
  if (!Number.isInteger(revId)) return c.json({ error: "revId inválido." }, 400);

  const page = await queryFirst<{ id: number }>(c.env.DB, `SELECT id FROM pages WHERE slug = ?`, slug);
  if (!page) return c.json({ error: "Página não encontrada." }, 404);

  const rev = await queryFirst<{ content_md: string }>(
    c.env.DB,
    `SELECT content_md FROM revisions WHERE id = ? AND page_id = ?`,
    revId,
    page.id
  );
  if (!rev) return c.json({ error: "Revisão não encontrada." }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE pages SET content_md = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(rev.content_md, page.id),
    c.env.DB.prepare(
      `INSERT INTO revisions (page_id, content_md, editor_id, comment) VALUES (?, ?, ?, ?)`
    ).bind(page.id, rev.content_md, user.sub, `Reversão para revisão #${revId}`),
  ]);

  await audit(c.env.DB, user.sub, "page.revert", slug, `rev=${revId}`);
  return c.json({ ok: true });
});

// GET /api/pages/:slug/backlinks
// Procura por [[<slug>]] ou [[<title>]] em todas as outras páginas.
pageRoutes.get("/:slug/backlinks", async (c) => {
  const slug = c.req.param("slug");
  const page = await queryFirst<{ id: number; title: string }>(
    c.env.DB,
    `SELECT id, title FROM pages WHERE slug = ?`,
    slug
  );
  if (!page) return c.json({ backlinks: [] });

  // Procura por [[Title]] (case-insensitive) — backlink via título é o padrão
  // usado pelo frontend. Também aceita [[slug]].
  const likeTitle = `%[[${page.title}]%`;
  const likeSlug = `%[[${slug}]%`;
  const rows = await queryAll<{
    id: number;
    slug: string;
    title: string;
    updated_at: string;
  }>(
    c.env.DB,
    `SELECT DISTINCT p.id, p.slug, p.title, p.updated_at
     FROM pages p
     WHERE p.id <> ?
       AND (p.content_md LIKE ? OR p.content_md LIKE ?)
     ORDER BY p.updated_at DESC LIMIT 100`,
    page.id,
    likeTitle,
    likeSlug
  );
  return c.json({ backlinks: rows });
});
