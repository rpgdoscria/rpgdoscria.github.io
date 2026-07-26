-- Migration 0007: Rework da sala — session_participants, trades, purchase_offers, level/xp

CREATE TABLE IF NOT EXISTS session_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  character_id INTEGER NOT NULL REFERENCES characters(id),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_code, user_id)
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  proposer_user_id INTEGER NOT NULL REFERENCES users(id),
  receiver_user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT CHECK(status IN ('pending','accepted','rejected','countered','cancelled')) DEFAULT 'pending',
  offer_json TEXT NOT NULL,
  request_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS purchase_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  target_user_id INTEGER NOT NULL REFERENCES users(id),
  item_name TEXT NOT NULL,
  item_description TEXT,
  price INTEGER NOT NULL,
  price_type TEXT,
  status TEXT CHECK(status IN ('pending','accepted','rejected','expired')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

ALTER TABLE characters ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE characters ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
