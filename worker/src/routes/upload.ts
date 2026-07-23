// routes/upload.ts — upload de imagem para Cloudinary (free tier, 25GB, sem cartão)
//
// BUG CORRIGIDO (401 do Cloudinary):
// A assinatura anterior não incluía o parâmetro `folder` no hash SHA-1, mas o
// enviava no form. O Cloudinary exige que TODOS os parâmetros (exceto `file` e
// `api_key`) estejam na assinatura, ordenados alfabeticamente por nome,
// concatenados como `param=valor&param=valor...`, com a API secret ANEXADA
// no final antes de gerar o hash. Qualquer parâmetro fora da assinatura
// invalida tudo → 401 "Invalid Signature".
//
// Adicionado também: captura e log do corpo da resposta de erro do Cloudinary,
// pra diagnóstico rápido em caso de futuros problemas.

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

  // Pré-checa: cloud name precisa estar configurado (não pode ser o placeholder)
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

  // ---- GERAÇÃO DA ASSINATURA (corrigida) ----
  // Cloudinary exige: TODOS os parâmetros que vão no form (exceto `file` e
  // `api_key`) devem ser incluídos na assinatura, ordenados alfabeticamente
  // por nome, concatenados como "name=value&name=value", com a API secret
  // anexada no final, antes de gerar o hash SHA-1.
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "rpg-wiki";

  // 1. Monta objeto com todos os params que vão no form (exceto file, api_key, signature)
  const paramsToSign: Record<string, string> = {
    folder,
    timestamp: String(timestamp),
  };

  // 2. Ordena alfabeticamente por nome e concatena
  const sortedKeys = Object.keys(paramsToSign).sort();
  const sigString = sortedKeys.map(k => `${k}=${paramsToSign[k]}`).join("&") + env.CLOUDINARY_API_SECRET;

  // 3. Gera SHA-1 hex
  const signature = await sha1Hex(sigString);

  // Monta form do Cloudinary — envia EXATAMENTE os mesmos params que foram assinados
  const uploadForm = new FormData();
  uploadForm.append("file", dataUri);
  uploadForm.append("api_key", env.CLOUDINARY_API_KEY);
  uploadForm.append("signature", signature);
  // Importante: timestamp e folder na MESMA ordem/valores que foram assinados
  uploadForm.append("timestamp", String(timestamp));
  uploadForm.append("folder", folder);

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

  // ---- CAPTURA CORPO DO ERRO (corrigido) ----
  // Antes: só checava resp.ok e logava status. Agora captura o corpo JSON
  // completo do erro do Cloudinary, que tem campos como
  // { error: { message: "Invalid Signature", http_code: 401 } } — essencial
  // pra diagnosticar a causa exata.
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    let errBody: any = null;
    try { errBody = JSON.parse(errText); } catch { /* não é JSON */ }
    const errMsg = errBody?.error?.message || errText || "erro desconhecido";
    console.error("Cloudinary upload failed", {
      status: resp.status,
      cloudinaryError: errBody || errText,
      // NÃO logar signature/api_key/secret nunca — só o que é seguro
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      folder,
      timestamp,
    });
    // Mensagem pro cliente inclui o erro específico do Cloudinary — facilita
    // debug sem expor secrets.
    return c.json({
      error: `Cloudinary rejeitou o upload (status ${resp.status}): ${errMsg}`,
      cloudinaryError: errMsg,
    }, 502);
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
