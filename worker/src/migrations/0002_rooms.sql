-- Migration 0002: Sala de Jogo em Tempo Real
-- Executar com: wrangler d1 migrations apply rpg-wiki-db --remote
--
-- Adiciona: fichas de personagem, presets de dados, snapshots de sala,
-- log de rolagens, e a coluna is_game_master em users.

-- Usuário que pode hospedar salas (não é o mesmo que role da wiki).
-- Qualquer user com is_game_master=1 pode criar sala; admin pode setar isso
-- no painel admin.
ALTER TABLE users ADD COLUMN is_game_master INTEGER NOT NULL DEFAULT 0;

-- Ficha de personagem (estado de combate, separado da página de lore da wiki).
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  page_id INTEGER REFERENCES pages(id),       -- opcional: link pra página de lore
  name TEXT NOT NULL,
  hp_current INTEGER NOT NULL DEFAULT 0,
  hp_max INTEGER NOT NULL DEFAULT 0,
  money INTEGER NOT NULL DEFAULT 0,
  bars_json TEXT NOT NULL DEFAULT '[]',
  inventory_json TEXT NOT NULL DEFAULT '[]',
  status_effects_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_user_id);

-- Presets de fórmulas de dados criados por jogadores.
CREATE TABLE IF NOT EXISTS dice_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  formula TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dice_presets_owner ON dice_presets(owner_user_id);

-- Snapshots periódicos do estado da sala (pra sobreviver a restart do DO).
CREATE TABLE IF NOT EXISTS room_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_room_snapshots_code_time ON room_snapshots(room_code, created_at DESC);

-- Histórico de rolagens (auditoria/consulta depois da sessão).
CREATE TABLE IF NOT EXISTS dice_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  roller_user_id INTEGER REFERENCES users(id),
  formula TEXT NOT NULL,
  label TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dice_log_room_time ON dice_log(room_code, created_at DESC);
