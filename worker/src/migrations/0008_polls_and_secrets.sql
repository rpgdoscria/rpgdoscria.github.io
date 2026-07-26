-- Migration 0008: Polls + Documentos Secretos
--
-- Polls (enquetes) para decisões de grupo na sala.
-- Documentos secretos na wiki (flag secret + revealed em pages).

-- Enquetes
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  option_index INTEGER NOT NULL,
  voted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (poll_id, user_id)
);

CREATE TABLE IF NOT EXISTS poll_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_polls_room ON polls(room_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_poll_chat_poll ON poll_chat_messages(poll_id, created_at ASC);

-- Documentos secretos na wiki
ALTER TABLE pages ADD COLUMN secret INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pages ADD COLUMN revealed INTEGER NOT NULL DEFAULT 0;
