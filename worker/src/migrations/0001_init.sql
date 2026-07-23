-- Migration 0001: schema inicial da Wiki RPG
-- Executar com: wrangler d1 migrations apply rpg-wiki-db --remote

-- Habilita foreign keys. NOTA: o SQLite (e portanto o D1) NÃO habilita
-- PRAGMA foreign_keys por padrão; sem isso, ON DELETE CASCADE é ignorado.
-- Mesmo assim, o código também remove revisões explicitamente no DELETE
-- de página (defesa em profundidade — nem todo cliente D1 honra este PRAGMA).
PRAGMA foreign_keys = ON;

-- usuários
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')) DEFAULT 'viewer',
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);

-- páginas da wiki
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Lore/História',
  content_md TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pages_category ON pages(category);
CREATE INDEX IF NOT EXISTS idx_pages_updated_at ON pages(updated_at DESC);

-- histórico de revisões
CREATE TABLE IF NOT EXISTS revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  content_md TEXT NOT NULL,
  editor_id INTEGER NOT NULL REFERENCES users(id),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_revisions_page_id ON revisions(page_id, created_at DESC);

-- log de auditoria
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at DESC);

-- controle de tentativas de login
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE,
  ip TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_username_time ON login_attempts(username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip, created_at DESC);

-- índice de busca full-text (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  title,
  content_md,
  content='pages',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 1'
);

-- triggers para manter pages_fts sincronizada com pages
CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(rowid, title, content_md) VALUES (new.id, new.title, new.content_md);
END;

CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, content_md) VALUES('delete', old.id, old.title, old.content_md);
END;

CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, content_md) VALUES('delete', old.id, old.title, old.content_md);
  INSERT INTO pages_fts(rowid, title, content_md) VALUES (new.id, new.title, new.content_md);
END;
