-- Migration 0009: Salas permanentes com nome
--
-- Antes: salas eram inferidas apenas do room_snapshots mais recente (sem tabela
-- própria). Isso causava: (1) bug de múltiplas salas criadas em cliques duplos,
-- (2) salas expiravam automaticamente após 6h de inatividade sem possibilidade
-- de reabrir, (3) não havia nome amigável pra listar.
--
-- Agora: tabela `rooms` persiste metadados da sala. O RoomDO continua sendo a
-- fonte de verdade do estado em tempo real, mas a sala sobrevive entre sessões.
-- `is_active = 0` significa encerrada (mas não deletada). Apenas o mestre
-- criador pode excluir definitivamente.

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT 'Sala sem nome',
  master_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_activity TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rooms_master ON rooms(master_user_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);

-- NOTA: A tabela room_snapshots continua existindo (0002) — agora referenciada
-- por rooms.code. O endpoint GET /api/rooms passa a ler desta tabela em vez de
-- inferir dos snapshots.
