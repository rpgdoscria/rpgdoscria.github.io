-- Migration 0015: credenciais de contexto da IA vinculadas ao usuário.
-- A chave é armazenada somente como SHA-256; o valor puro aparece uma única
-- vez no arquivo Markdown baixado pelo mestre.

CREATE TABLE IF NOT EXISTS ai_context_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'guia-agente-rpg',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_context_tokens_user ON ai_context_tokens(user_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS ai_context_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER NOT NULL REFERENCES ai_context_tokens(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip TEXT,
  user_agent TEXT,
  pages_count INTEGER,
  chronicles_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ai_context_access_user ON ai_context_access_log(user_id, accessed_at DESC);
