// routes/upload.ts — upload de imagem para Cloudinary (free tier, 25GB, sem cartão)
//
// Substitui o R2 que exigia cartão de crédito mesmo no free tier.
// Cloudinary oferece:
//   - 25 GB de armazenamento (mais que os 10 GB necessários)
//   - 25 GB de bandwidth mensal
//   - CDN global (imagens servem rápido de qualquer lugar)
//   - Transformações automáticas (resize, otimização)
//   - Sem cartão de crédito no signup
//
// Setup (uma vez):
//   1. Criar conta free em https://cloudinary.com
//   2. Pegar Cloud Name, API Key e API Secret no dashboard
//   3. Colocar Cloud Name em wrangler.toml (var CLOUDINARY_CLOUD_NAME)
//   4. wrangler secret put CLOUDINARY_API_KEY
//   5. wrangler secret put CLOUDINARY_API_SECRET

import { Hono } from "hono";
import type { Env } from "../env";
import type { JwtPayload } from "../lib/crypto";
import { audit } from "../lib/db";
import { requireRole } from "../lib/middleware";

export const uploadRoutes = new Hono<{ Bindings: Env; Variables: { user?: JwtPayload } }>();

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  // SVG removido: pode conter <script> que executa no navegador.
]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

uploadRoutes.post("/", requireRole("editor"), async (c) => {
  const user = c.get("user") as JwtPayload;
  const env = c.env;

  // Pré-checa: cloud name precisa estar configurado
  if (!env.CLOUDINARY_CLOUD_NAME || env.CLOUDINARY_CLOUD_NAME === "SEU_CLOUD_NAME") {
    return c.json({ error: "Cloudinary não configurado. Veja instruções em wrangler.toml." }, 500);
  }
  if (!env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    return c.json({ error: "CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET não definidos. Rode `wrangler secret put`." }, 500);
  }

  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return c.json({ error: "Esperado multipart/form-data." }, 400);
  }

  const form = await c.req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return c.json({ error: "Campo 'file' ausente ou inválido." }, 400);
  }
  const f = file as { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };
  if (!ALLOWED_TYPES.has(f.type)) {
    return c.json({ error: `Tipo não permitido: ${f.type}.` }, 400);
  }
  if (f.size > MAX_BYTES) {
    return c.json({ error: "Arquivo excede 5 MB." }, 400);
  }

  // Validação de magic bytes (Content-Type do cliente pode ser forjado)
  const buf = new Uint8Array(await f.arrayBuffer());
  if (!hasValidMagicBytes(buf)) {
    return c.json({ error: "Arquivo não corresponde ao Content-Type declarado (magic bytes inválidos)." }, 400);
  }

  // Converte para data URI base64 (formato aceito pelo Cloudinary)
  const b64 = bufToBase64(buf);
  const dataUri = `data:${f.type};base64,${b64}`;

  // Gera assinatura HMAC-SHA1 (Cloudinary usa SHA-1 para upload assinado)
  const timestamp = Math.floor(Date.now() / 1000);
  const sigString = `timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
  const signature = await sha1Hex(sigString);

  // Monta form do Cloudinary
  const uploadForm = new FormData();
  uploadForm.append("file", dataUri);
  uploadForm.append("timestamp", String(timestamp));
  uploadForm.append("api_key", env.CLOUDINARY_API_KEY);
  uploadForm.append("signature", signature);
  // Pasta organizacional dentro do Cloudinary (opcional, mas ajuda a separar)
  uploadForm.append("folder", "rpg-wiki");

  const uploadUrl = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`;

  let resp: Response;
  try {
    resp = await fetch(uploadUrl, {
      method: "POST",
      body: uploadForm,
    });
  } catch (e) {
    console.error("Cloudinary fetch failed", e);
    return c.json({ error: "Falha de rede ao contatar Cloudinary." }, 502);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error("Cloudinary upload failed", resp.status, errText);
    return c.json({ error: `Cloudinary rejeitou o upload (status ${resp.status}).` }, 502);
  }

  const result = await resp.json() as {
    secure_url: string;
    public_id: string;
    bytes: number;
    format: string;
  };

  await audit(env.DB, user.sub, "upload.image", result.public_id, `${f.type} ${f.size}b → ${result.bytes}b`);
  return c.json({
    ok: true,
    url: result.secure_url,
    publicId: result.public_id,
    bytes: result.bytes,
  });
});

// ---------- helpers ----------
function bufToBase64(buf: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

async function sha1Hex(message: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hasValidMagicBytes(buf: Uint8Array): boolean {
  if (buf.length < 4) return false;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // GIF: 47 49 46 38 (GIF8)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  // WebP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return true;
  return false;
}
