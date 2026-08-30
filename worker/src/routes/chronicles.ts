// routes/chronicles.ts — crônicas Markdown ligadas a personagens.
//
// Leitura: qualquer usuário autenticado.
// Escrita: dono do personagem ou administrador/mestre.

import { Hono } from "hono";
import type { Env } from "../env";
import type { JwtPayload } from "../lib/crypto";
import { audit, queryAll, queryFirst } from "../lib/db";
import { slugify } from "../lib/crypto";

export const chronicleRoutes = new Hono<{ Bindings: Env; Variables: { user?: JwtPayload } }>();

async function getUser(c: any): Promise<JwtPayload | null> {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return null;
  const row = await queryFirst<{ role: string; active: number }>(c.env.DB, `SELECT role, active FROM users WHERE id = ?`, user.sub);
  return row?.active === 1 ? { ...user, role: row.role as JwtPayload["role"] } : null;
}

async function canManageCharacter(db: D1Database, user: JwtPayload, characterId: number): Promise<boolean> {
  if (user.role === "admin") return true;
  const row = await queryFirst<{ owner_user_id: number }>(db, `SELECT owner_user_id FROM characters WHERE id = ?`, characterId);
  return !!row && row.owner_user_id === user.sub;
}

function mapChronicle(row: any) {
  return {
    id: Number(row.id),
    characterId: Number(row.character_id),
    characterName: row.character_name ?? null,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt ?? "",
    contentMd: row.content_md ?? "",
    coverImageUrl: row.cover_image_url ?? null,
    createdBy: Number(row.created_by),
    createdByUsername: row.created_by_username ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_CHRONICLES = `
  SELECT cr.*, c.name AS character_name, u.username AS created_by_username
  FROM chronicles cr
  JOIN characters c ON c.id = cr.character_id
  JOIN users u ON u.id = cr.created_by`;

chronicleRoutes.get("/", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const characterIdRaw = c.req.query("characterId");
  const characterId = characterIdRaw ? Number(characterIdRaw) : null;
  if (characterId && !(await queryFirst(c.env.DB, `SELECT id FROM characters WHERE id = ?`, characterId))) {
    return c.json({ error: "Personagem não encontrado." }, 404);
  }
  const rows = await queryAll<any>(c.env.DB,
    characterId
      ? `${SELECT_CHRONICLES} WHERE cr.character_id = ? ORDER BY cr.updated_at DESC, cr.id DESC`
      : `${SELECT_CHRONICLES} ORDER BY cr.updated_at DESC, cr.id DESC LIMIT 300`,
    ...(characterId ? [characterId] : [])
  );
  return c.json({ chronicles: rows.map(mapChronicle) });
});

chronicleRoutes.get("/:id", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const row = await queryFirst<any>(c.env.DB, `${SELECT_CHRONICLES} WHERE cr.id = ?`, id);
  if (!row) return c.json({ error: "Crônica não encontrada." }, 404);
  return c.json(mapChronicle(row));
});

chronicleRoutes.post("/", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const characterId = Number(body?.characterId);
  if (!characterId || !(await queryFirst(c.env.DB, `SELECT id FROM characters WHERE id = ?`, characterId))) {
    return c.json({ error: "Personagem inválido." }, 400);
  }
  if (!(await canManageCharacter(c.env.DB, user, characterId))) return c.json({ error: "Você não pode criar crônicas para este personagem." }, 403);
  const title = String(body?.title ?? "").trim();
  const contentMd = String(body?.contentMd ?? body?.content_md ?? "");
  if (!title || title.length > 160) return c.json({ error: "Título obrigatório (máx. 160 caracteres)." }, 400);
  if (contentMd.length > 200000) return c.json({ error: "A crônica excede o limite de 200 mil caracteres." }, 400);
  const excerpt = String(body?.excerpt ?? "").trim().slice(0, 500) || contentMd.replace(/[#*_`>\[\]!-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  const coverImageUrl = body?.coverImageUrl ? String(body.coverImageUrl).slice(0, 500) : null;
  const baseSlug = slugify(title) || `cronica-${Date.now()}`;
  const slug = `${baseSlug}-${Date.now().toString(36)}`;
  const result = await c.env.DB.prepare(
    `INSERT INTO chronicles (character_id, title, slug, excerpt, content_md, cover_image_url, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(characterId, title, slug, excerpt, contentMd, coverImageUrl, user.sub).run();
  await audit(c.env.DB, user.sub, "chronicle.create", slug, `character=${characterId}`);
  return c.json({ ok: true, id: Number(result.meta.last_row_id), slug }, 201);
});

chronicleRoutes.put("/:id", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const existing = await queryFirst<any>(c.env.DB, `SELECT * FROM chronicles WHERE id = ?`, id);
  if (!existing) return c.json({ error: "Crônica não encontrada." }, 404);
  if (!(await canManageCharacter(c.env.DB, user, Number(existing.character_id)))) return c.json({ error: "Sem permissão para editar esta crônica." }, 403);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const title = body.title !== undefined ? String(body.title).trim() : existing.title;
  const contentMd = body.contentMd !== undefined || body.content_md !== undefined ? String(body.contentMd ?? body.content_md ?? "") : existing.content_md;
  if (!title || title.length > 160) return c.json({ error: "Título obrigatório (máx. 160 caracteres)." }, 400);
  if (contentMd.length > 200000) return c.json({ error: "A crônica excede o limite de 200 mil caracteres." }, 400);
  const excerpt = body.excerpt !== undefined
    ? String(body.excerpt).trim().slice(0, 500)
    : existing.excerpt;
  const coverImageUrl = body.coverImageUrl !== undefined
    ? (body.coverImageUrl ? String(body.coverImageUrl).slice(0, 500) : null)
    : existing.cover_image_url;
  await c.env.DB.prepare(
    `UPDATE chronicles SET title = ?, excerpt = ?, content_md = ?, cover_image_url = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(title, excerpt, contentMd, coverImageUrl, id).run();
  await audit(c.env.DB, user.sub, "chronicle.update", String(id), `character=${existing.character_id}`);
  return c.json({ ok: true });
});

chronicleRoutes.delete("/:id", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const id = Number(c.req.param("id"));
  const existing = await queryFirst<any>(c.env.DB, `SELECT * FROM chronicles WHERE id = ?`, id);
  if (!existing) return c.json({ error: "Crônica não encontrada." }, 404);
  if (!(await canManageCharacter(c.env.DB, user, Number(existing.character_id)))) return c.json({ error: "Sem permissão para excluir esta crônica." }, 403);
  await c.env.DB.prepare(`DELETE FROM chronicles WHERE id = ?`).bind(id).run();
  await audit(c.env.DB, user.sub, "chronicle.delete", String(id), `character=${existing.character_id}`);
  return c.json({ ok: true });
});
