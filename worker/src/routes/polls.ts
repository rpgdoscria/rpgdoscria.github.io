// routes/polls.ts — CRUD de enquetes (polls) da sala

import { Hono } from "hono";
import type { Env } from "../env";
import type { JwtPayload } from "../lib/crypto";
import { queryAll, queryFirst, queryRun } from "../lib/db";

export const pollRoutes = new Hono<{ Bindings: Env; Variables: { user?: JwtPayload } }>();

// GET /api/polls?roomCode=XXXX — lista polls de uma sala
pollRoutes.get("/", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const roomCode = c.req.query("roomCode");
  if (!roomCode) return c.json({ error: "roomCode é obrigatório." }, 400);

  const polls = await queryAll<any>(
    c.env.DB,
    `SELECT p.*, u.username AS created_by_name FROM polls p JOIN users u ON u.id = p.created_by_user_id WHERE p.room_code = ? ORDER BY p.created_at DESC`,
    roomCode
  );

  const out = [];
  for (const p of polls) {
    let options = [];
    try { options = JSON.parse(p.options_json); } catch {}
    const votes = await queryAll<any>(
      c.env.DB,
      `SELECT pv.user_id, pv.option_index, u.username FROM poll_votes pv JOIN users u ON u.id = pv.user_id WHERE pv.poll_id = ?`,
      p.id
    );
    const chat = await queryAll<any>(
      c.env.DB,
      `SELECT pcm.id, pcm.user_id, u.username, pcm.message, pcm.created_at FROM poll_chat_messages pcm JOIN users u ON u.id = pcm.user_id WHERE pcm.poll_id = ? ORDER BY pcm.created_at ASC LIMIT 50`,
      p.id
    );
    out.push({
      id: p.id,
      roomCode: p.room_code,
      question: p.question,
      options,
      createdBy: p.created_by_user_id,
      createdByName: p.created_by_name,
      createdAt: p.created_at,
      endedAt: p.ended_at,
      isActive: !p.ended_at,
      votes: votes.map(v => ({ userId: v.user_id, username: v.username, optionIndex: v.option_index })),
      chat: chat.map(m => ({ id: m.id, userId: m.user_id, username: m.username, message: m.message, createdAt: m.created_at })),
    });
  }
  return c.json({ polls: out });
});

// POST /api/polls — cria poll
pollRoutes.post("/", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const roomCode = String(body?.roomCode ?? "");
  const question = String(body?.question ?? "").trim();
  const options: string[] = Array.isArray(body?.options) ? body.options.map((s: string) => String(s).trim()).filter(Boolean) : [];
  if (!roomCode || !question) return c.json({ error: "roomCode e question são obrigatórios." }, 400);
  if (options.length < 2 || options.length > 5) return c.json({ error: "Precisa entre 2 e 5 opções." }, 400);

  const result = await c.env.DB.prepare(
    `INSERT INTO polls (room_code, question, options_json, created_by_user_id) VALUES (?, ?, ?, ?)`
  ).bind(roomCode, question, JSON.stringify(options), user.sub).run();
  const newId = result.meta.last_row_id as number;
  return c.json({ ok: true, id: newId, question, options }, 201);
});

// POST /api/polls/:id/vote — vota numa opção
pollRoutes.post("/:id/vote", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const pollId = Number(c.req.param("id"));
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const optionIndex = Number(body?.optionIndex);
  if (!Number.isInteger(optionIndex) || optionIndex < 0) return c.json({ error: "optionIndex inválido." }, 400);

  const poll = await queryFirst<any>(c.env.DB, `SELECT * FROM polls WHERE id = ?`, pollId);
  if (!poll) return c.json({ error: "Poll não encontrada." }, 404);
  if (poll.ended_at) return c.json({ error: "Poll já encerrada." }, 400);

  let options = [];
  try { options = JSON.parse(poll.options_json); } catch {}
  if (optionIndex >= options.length) return c.json({ error: "Opção inválida." }, 400);

  // Upsert voto (DELETE + INSERT pra simplificar)
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?`).bind(pollId, user.sub),
    c.env.DB.prepare(`INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES (?, ?, ?)`).bind(pollId, user.sub, optionIndex),
  ]);
  return c.json({ ok: true });
});

// POST /api/polls/:id/end — encerra poll
pollRoutes.post("/:id/end", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const pollId = Number(c.req.param("id"));
  const poll = await queryFirst<any>(c.env.DB, `SELECT * FROM polls WHERE id = ?`, pollId);
  if (!poll) return c.json({ error: "Poll não encontrada." }, 404);
  if (poll.ended_at) return c.json({ error: "Poll já encerrada." }, 400);
  // Criador ou admin pode encerrar
  if (poll.created_by_user_id !== user.sub) {
    const u = await queryFirst<{ role: string }>(c.env.DB, `SELECT role FROM users WHERE id = ?`, user.sub);
    if (!u || u.role !== "admin") return c.json({ error: "Apenas o criador ou um admin pode encerrar." }, 403);
  }
  await c.env.DB.prepare(`UPDATE polls SET ended_at = datetime('now') WHERE id = ?`).bind(pollId).run();
  return c.json({ ok: true });
});

// POST /api/polls/:id/chat — envia mensagem no chat da poll
pollRoutes.post("/:id/chat", async (c) => {
  const user = c.get("user") as JwtPayload | undefined;
  if (!user) return c.json({ error: "Não autenticado." }, 401);
  const pollId = Number(c.req.param("id"));
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON inválido." }, 400); }
  const message = String(body?.message ?? "").trim();
  if (!message || message.length > 500) return c.json({ error: "Mensagem inválida." }, 400);

  const poll = await queryFirst<any>(c.env.DB, `SELECT * FROM polls WHERE id = ?`, pollId);
  if (!poll) return c.json({ error: "Poll não encontrada." }, 404);
  if (poll.ended_at) return c.json({ error: "Poll encerrada — chat fechado." }, 400);

  await c.env.DB.prepare(
    `INSERT INTO poll_chat_messages (poll_id, user_id, message) VALUES (?, ?, ?)`
  ).bind(pollId, user.sub, message).run();
  return c.json({ ok: true }, 201);
});
