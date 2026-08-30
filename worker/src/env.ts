// worker/src/env.ts — tipo global Env (bindings + secrets)
// Mantém tudo em um lugar só pra não espalhar `any` pelo código.

import type { RoomDO } from "./durable-objects/RoomDO";

export interface Env {
  // bindings
  DB: D1Database;
  ROOM: DurableObjectNamespace;
  // NOTA: R2 foi removido — exigia cartão de crédito mesmo no free tier.
  // Imagens agora vão para Cloudinary (25GB free, sem cartão).

  // vars (não-secretas)
  CORS_ORIGIN: string;
  PAGES_ORIGIN: string;
  JWT_TTL_DAYS: string;
  RATE_LIMIT_MAX_FAILS: string;
  RATE_LIMIT_WINDOW_MIN: string;
  // Cloudinary — cloud name é público (não é sensível)
  CLOUDINARY_CLOUD_NAME: string;

  // secrets (definidos via `wrangler secret put`)
  JWT_SECRET: string;
  ADMIN_BOOTSTRAP_KEY: string;
  // Cloudinary — API key e secret são sensíveis (vão como secret, não como var)
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
}

// Re-exporta o tipo do Durable Object para conveniência.
export { RoomDO };
