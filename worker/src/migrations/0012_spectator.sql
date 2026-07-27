-- Migration 0012: Suporte a espectadores na sala
--
-- Jogadores podem entrar como espectadores (sem personagem) apenas para assistir.
-- session_participants ganha coluna is_spectator.

ALTER TABLE session_participants ADD COLUMN is_spectator INTEGER NOT NULL DEFAULT 0;
