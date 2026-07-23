-- Migration 0006: Sets de Regras + Chat da sala + campo equipped no inventário
--
-- Esta migration adiciona:
--   1. rule_sets / rule_set_stats / character_rule_sets — sistema de Sets de Regras
--      que agrupa stat_templates pra aplicação automática ao criar personagem.
--   2. added_via_rule_set_id em character_stats — rastreia qual set aplicou
--      cada status (NULL se foi adicionado manualmente pelo jogador).
--   3. chat_log — histórico de mensagens do chat da sala.
--
-- Sobre "equipped" no inventário: o inventário é guardado como JSON em
-- characters.inventory_json (campo TEXT). Não precisa de migration pra isso —
-- o frontend simplesmente passa {name, qty, description, equipped} no JSON.
-- Itens antigos sem o campo equipped são tratados como equipped=false.

CREATE TABLE IF NOT EXISTS rule_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rule_set_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_set_id INTEGER NOT NULL REFERENCES rule_sets(id) ON DELETE CASCADE,
  stat_template_id INTEGER NOT NULL REFERENCES stat_templates(id),
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(rule_set_id, stat_template_id)
);

CREATE INDEX IF NOT EXISTS idx_rule_set_stats_set ON rule_set_stats(rule_set_id, display_order);

CREATE TABLE IF NOT EXISTS character_rule_sets (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  rule_set_id INTEGER NOT NULL REFERENCES rule_sets(id),
  PRIMARY KEY (character_id, rule_set_id)
);

-- Rastreia de onde veio cada status aplicado a um personagem
ALTER TABLE character_stats ADD COLUMN added_via_rule_set_id INTEGER REFERENCES rule_sets(id);

-- Chat da sala
CREATE TABLE IF NOT EXISTS chat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  sender_user_id INTEGER REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_log_room_time ON chat_log(room_code, created_at DESC);
