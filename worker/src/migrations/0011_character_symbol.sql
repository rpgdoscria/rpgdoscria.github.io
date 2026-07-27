-- Migration 0011: Símbolo do personagem (transparente, branco)
--
-- Tarefa 7 (final): o símbolo desenhado pelo jogador é uma imagem PNG com
-- fundo transparente e traços brancos — separada da foto principal.
-- Usada futuramente para overlays, marcações de mapa, etc.

ALTER TABLE characters ADD COLUMN symbol_url TEXT;
