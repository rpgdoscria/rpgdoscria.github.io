-- Migration 0003: Sistema de personagem homebrew (status configuráveis)
--
-- Princípio: NADA de status fixo no schema. Vida, dinheiro, mana, etc. são
-- todos stat_templates definidos pelo mestre. Cada personagem escolhe quais
-- templates usar + pode criar status 100% customizados.

-- Status BASE do jogo — definidos pelo mestre pra campanha inteira
CREATE TABLE IF NOT EXISTS stat_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('bar','number','text','tag_list','checkbox','formula')),
  default_max REAL,
  color TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stat_templates_active ON stat_templates(active, name);

-- Valores reais de status POR personagem (template-based OU custom)
CREATE TABLE IF NOT EXISTS character_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  stat_template_id INTEGER REFERENCES stat_templates(id),
  is_custom INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('bar','number','text','tag_list','checkbox','formula')),
  value_current REAL,
  value_max REAL,
  value_text TEXT,
  value_bool INTEGER,
  color TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_character_stats_character ON character_stats(character_id, display_order);

-- characters: adicionar photo_url + coluna "is_active" (qual personagem
-- está ativo pra entrar na sala rapidamente). NOTA: as colunas antigas
-- hp_current, hp_max, money, bars_json continuam existindo por compat
-- retroativa (PersonDO lê delas se character_stats estiver vazio — defesa
-- em profundidade pra quem já tinha personagens antes desta migration),
-- mas TODO novo código usa character_stats.
ALTER TABLE characters ADD COLUMN photo_url TEXT;
ALTER TABLE characters ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0;

-- Marcador de "qual status é o HP principal" pra quick-actions na sala
-- (ex: botão "tomar dano" que aparece no card sem precisar saber o statId).
-- O mestre marca um stat_template como "primary_health" e ele ganha destaque.
ALTER TABLE stat_templates ADD COLUMN is_primary_health INTEGER NOT NULL DEFAULT 0;
