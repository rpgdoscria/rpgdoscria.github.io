// worker/src/index.ts — ponto de entrada do Worker
// Roteamento Hono + middleware global (CORS + authParser) + sub-routers.
//
// Também exporta a classe RoomDO (Durable Object) que o Wrangler instancia
// quando uma sala é criada/conectada.

import { Hono } from "hono";
import type { Env } from "./env";
import type { JwtPayload } from "./lib/crypto";
import { authParser, corsMiddleware } from "./lib/middleware";
import { authRoutes, bootstrapHandler } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { pageRoutes } from "./routes/pages";
import { uploadRoutes } from "./routes/upload";
import { roomRoutes } from "./routes/rooms";
import { characterRoutes } from "./routes/characters";
import { statTemplateRoutes } from "./routes/stat-templates";
import { ruleSetRoutes } from "./routes/rule-sets";

// Re-export da classe RoomDO — o Wrangler precisa encontrar a classe aqui.
export { RoomDO } from "./durable-objects/RoomDO";

const app = new Hono<{ Bindings: Env; Variables: { user?: JwtPayload } }>();

// Health check público — útil para pingar o deploy.
app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

// CORS em tudo que começa com /api
app.use("/api/*", corsMiddleware());
// Parser de auth (não bloqueia — só popula c.get("user") se houver token válido)
app.use("/api/*", authParser);

// POST /api/admin/bootstrap — registrado ANTES do adminRoutes para NÃO passar
// pelo middleware `requireRole("admin")` (que exigiria um admin já existente,
// impossível na primeira execução). Esta é a ÚNICA rota de admin que funciona
// sem auth (usa header X-Bootstrap-Key no lugar). O caminho legado
// /api/auth/admin/bootstrap também continua funcionando por compatibilidade.
app.post("/api/admin/bootstrap", bootstrapHandler);

// WebSocket de conexão à sala — PRECISA ser registrado ANTES do app.route
// /api/rooms porque o Hono faz match na ordem de registro, e o router de rooms
// capturaria /connect antes deste handler (retornando 404 porque a rota
// "connect" não existe em rooms.ts). Aqui pegamos direto e encaminhamos pro DO.
app.get("/api/rooms/connect", (c) => {
  const code = c.req.query("code");
  const token = c.req.query("token");
  if (!code || !token) return c.json({ error: "code e token são obrigatórios." }, 400);

  // O Upgrade tem que acontecer no DO, não no Worker principal.
  const id = c.env.ROOM.idFromName(code);
  const stub = c.env.ROOM.get(id);
  // Encaminha a request inteira pro DO — ele faz o upgrade WebSocket.
  return stub.fetch(c.req.raw);
});

// Sub-routers
app.route("/api/auth", authRoutes);            // /login, /me, /change-password, /admin/bootstrap (legado)
app.route("/api/pages", pageRoutes);           // CRUD + revisões + backlinks
app.route("/api/admin", adminRoutes);          // usuários + audit-log (exige admin)
app.route("/api/upload", uploadRoutes);        // Cloudinary
app.route("/api/rooms", roomRoutes);           // salas + presets de dados
app.route("/api/characters", characterRoutes); // personagens + stats (homebrew)
app.route("/api/stat-templates", statTemplateRoutes); // status base (mestre+)
app.route("/api/rule-sets", ruleSetRoutes);           // sets de regras (mestre+)

// 404 genérico para /api/*
app.notFound((c) => c.json({ error: "Rota não encontrada." }, 404));

// Handler de erros global — nunca vaza stack trace para o cliente.
app.onError((err, c) => {
  console.error("unhandled error", err);
  return c.json({ error: "Erro interno do servidor." }, 500);
});

export default app;
