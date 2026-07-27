-- Migration 0010: Cores de jogadores + Planejamento do mestre
--
-- 1. session_participants ganha coluna `color` (hex) pra persistir a cor
--    escolhida pelo jogador ao entrar na sala. Restaurada ao reconectar.
--
-- 2. Nova tabela `master_planning` guarda anotações privadas do mestre:
--    - notes: texto livre (markdown)
--    - enemies: JSON com inimigos pré-prontos
--    - scenarios: JSON com cenários/NPCs/locais
--    Cada seção é uma linha separada (upsert por room + user + section).

-- session_participants veio da migration 0007; adiciona coluna color.
-- IF NOT EXISTS não é suportado em ALTER TABLE ADD COLUMN no SQLite antigo,
-- então verificamos via pragma. Em D1 moderno, o ALTER falha silenciosamente
-- se a coluna já existe? Não — falha com erro. Por isso o bloco try/catch
-- no código aplicador. Aqui usamos a sintaxe simples; se a coluna já existir
-- (execuções repetidas), a migration falha — mas o wrangler rastreia migrations
-- já aplicadas por nome de arquivo, então 0010 só roda uma vez.
ALTER TABLE session_participants ADD COLUMN color TEXT;

-- Planejamento privado do mestre (anotações, inimigos pré-prontos, cenários).
CREATE TABLE IF NOT EXISTS master_planning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  section TEXT NOT NULL CHECK(section IN ('notes', 'enemies', 'scenarios')),
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_code, user_id, section)
);

CREATE INDEX IF NOT EXISTS idx_master_planning_room_user ON master_planning(room_code, user_id);
