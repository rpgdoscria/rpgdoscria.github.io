-- Migration 0014: crônicas de personagens
--
-- Uma crônica é uma página Markdown vinculada a um personagem. O conteúdo
-- continua sendo texto puro; imagens podem ser referenciadas por Markdown
-- comum/avançado ou por uma imagem de capa hospedada no Cloudinary.

CREATE TABLE IF NOT EXISTS chronicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  excerpt TEXT,
  content_md TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chronicles_character ON chronicles(character_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chronicles_slug ON chronicles(slug);
