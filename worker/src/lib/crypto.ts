// lib/crypto.ts — criptografia pura via Web Crypto API
// Tudo aqui roda nativamente no Cloudflare Workers (sem libs nativas).
//
// - Hash de senha: PBKDF2-SHA256 com salt aleatório de 16 bytes, 100.000 iterações.
// - Saída: string "pbkdf2$<iterations>$<saltBase64>$<hashBase64>" — fácil de armazenar em TEXT.
// - JWT: HS256 via crypto.subtle.sign/verify, exp claim obrigatório.

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32; // 256 bits
const JWT_ALG = "HS256";

// ---------- helpers base64 ----------
function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(input: string | Uint8Array): string {
  const b64 = typeof input === "string"
    ? btoa(unescape(encodeURIComponent(input)))
    : bufToBase64(input);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return decodeURIComponent(escape(atob(padded + pad)));
}

// ---------- PBKDF2 hash ----------
export interface HashedPassword {
  hash: string; // "pbkdf2$<iters>$<saltB64>$<hashB64>"
  salt: string; // salt base64 puro, para a coluna `salt`
}

export async function hashPassword(password: string): Promise<HashedPassword> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS, HASH_BYTES);
  const saltB64 = bufToBase64(salt);
  const hashB64 = bufToBase64(hash);
  return {
    hash: `pbkdf2$${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`,
    salt: saltB64,
  };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iters = Number(parts[1]);
  const salt = base64ToBuf(parts[2]);
  const expected = parts[3];
  if (!Number.isInteger(iters) || iters < 1000) return false;
  const hash = await pbkdf2(password, salt, iters, HASH_BYTES);
  const got = bufToBase64(hash);
  // constant-time-ish compare
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
  bytes: number
): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    bytes * 8
  );
}

// ---------- JWT (HS256) ----------
export interface JwtPayload {
  sub: number;      // user id
  username: string;
  role: "admin" | "editor" | "viewer";
  iat: number;      // issued at (segundos)
  exp: number;      // expiração (segundos)
}

export async function signJwt(payload: Omit<JwtPayload, "iat" | "exp">, secret: string, ttlDays = 7): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.floor(ttlDays * 86400);
  const fullPayload: JwtPayload = { ...payload, iat: now, exp };

  const headerB64 = base64UrlEncode(JSON.stringify({ alg: JWT_ALG, typ: "JWT" }));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  const sigB64 = base64UrlEncode(new Uint8Array(sig));

  return { token: `${signingInput}.${sigB64}`, expiresAt: exp };
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg: string; typ: string };
  let payload: JwtPayload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64));
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return null;
  }
  if (header.alg !== JWT_ALG) return null;
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof payload.sub !== "number" || !payload.username || !payload.role) return null;

  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importHmacKey(secret);
  const expectedSig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput))
  );
  const gotSig = base64ToBuf(
    sigB64.replace(/-/g, "+").replace(/_/g, "/")
  );

  if (expectedSig.length !== gotSig.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) diff |= expectedSig[i] ^ gotSig[i];
  return diff === 0 ? payload : null;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

// ---------- utilidades ----------
export function randomToken(bytes = 32): string {
  return bufToBase64(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function slugify(input: string): string {
  // Mantém acentos removidos + lowercase + hífens. Slugs curtos e estáveis.
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u00C0-\u017F\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
