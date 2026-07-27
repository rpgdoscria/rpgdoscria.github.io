-- Migration 0013: Permissões por stat + inventário com ícone desenhado
--
-- Duas mudanças pedidas pelo usuário (Odilon):
--
-- 1. PERMISSÕES POR STAT: por padrão, jogador NÃO pode editar seus status.
--    Só o mestre edita. O mestre pode liberar individualmente cada stat
--    para o jogador editar (útil pra status customizados menos críticos,
--    enquanto vida/mana/dinheiro ficam só com o mestre).
--    Implementação: nova coluna `player_editable` em character_stats.
--      0 (default) = só mestre edita
--      1 = jogador dono do personagem também pode editar
--
-- 2. INVENTÁRIO COM ÍCONE: itens podem ter um ícone PNG desenhado pelo
--    jogador (igual ao símbolo do personagem, mas com cor customizável
--    em vez de só branco). O ícone é armazenado como URL no Cloudinary.
--    Implementação: nova tabela `character_inventory_items` que substitui
--    o JSON `inventory_json` da tabela `characters` (mantido por compat).
--    Cada item tem: name, qty, description, equipped, icon_url, sort_order.

-- ===== 1. Permissões por stat =====
ALTER TABLE character_stats ADD COLUMN player_editable INTEGER NOT NULL DEFAULT 0;

-- Stats customizados (is_custom = 1) criados pelo próprio jogador já nascem
-- editáveis por ele — afinal, se ele criou, faz sentido ele poder editar.
-- Stats vindos de templates (regras da casa) continuam só-mestre por padrão.
UPDATE character_stats SET player_editable = 1 WHERE is_custom = 1;

-- ===== 2. Inventário com ícone =====
CREATE TABLE IF NOT EXISTS character_inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK(qty >= 0),
  description TEXT,
  equipped INTEGER NOT NULL DEFAULT 0,
  icon_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inv_items_character ON character_inventory_items(character_id, sort_order);
