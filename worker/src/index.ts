// worker/src/index.ts — ponto de entrada do Worker
// Roteamento Hono + middleware global (CORS + authParser) + sub-routers.
//
// Também exporta a classe RoomDO (Durable Object) que o Wrangler instancia
// quando uma sala é criada/conectada.

import { Hono } from "hono";
import type { Env } from "./env";
import type { JwtPayload } from "./lib/crypto";
import { authParser, corsMiddleware } from "./lib/middleware";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { pageRoutes } from "./routes/pages";
import { uploadRoutes } from "./routes/upload";
import { roomRoutes } from "./routes/rooms";

// Re-export da classe RoomDO — o Wrangler precisa encontrar a classe aqui.
export { RoomDO } from "./durable-objects/RoomDO";

const app = new Hono<{ Bindings: Env; Variables: { user?: JwtPayload } }>();

// Health check público — útil para pingar o deploy.
app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

// CORS em tudo que começa com /api
app.use("/api/*", corsMiddleware());
// Parser de auth (não bloqueia — só popula c.get("user") se houver token válido)
app.use("/api/*", authParser);

// Sub-routers
app.route("/api/auth", authRoutes);            // /login, /me, /change-password, /admin/bootstrap
app.route("/api/pages", pageRoutes);           // CRUD + revisões + backlinks
app.route("/api/admin", adminRoutes);          // usuários + audit-log
app.route("/api/upload", uploadRoutes);        // R2
app.route("/api/rooms", roomRoutes);           // salas + personagens + presets

// WebSocket de conexão à sala — precisa ser roteado aqui porque o navegador
// faz upgrade direto pra /api/rooms/connect sem passar por Hono routes.
// Encaminha para o Durable Object correto usando o código da sala.
app.get("/api/rooms/connect", (c) => {
  const code = c.req.query("code");
  const token = c.req.query("token");
  if (!code || !token) return c.json({ error: "code e token são obrigatórios." }, 400);

  // O Upgrade tem que acontecer no DO, não no Worker principal.
  // O Hono tem c.env.ROOM que é o namespace do DO.
  const id = c.env.ROOM.idFromName(code);
  const stub = c.env.ROOM.get(id);
  // Encaminha a request inteira pro DO — ele faz o upgrade WebSocket.
  return stub.fetch(c.req.raw);
});

// 404 genérico para /api/*
app.notFound((c) => c.json({ error: "Rota não encontrada." }, 404));

// Handler de erros global — nunca vaza stack trace para o cliente.
app.onError((err, c) => {
  console.error("unhandled error", err);
  return c.json({ error: "Erro interno do servidor." }, 500);
});

export default app;
