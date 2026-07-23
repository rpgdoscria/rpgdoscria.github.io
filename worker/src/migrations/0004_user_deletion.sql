-- Migration 0004: suporte a exclusão/anonimização de contas no admin
--
-- Quando um usuário é "excluído" pelo admin:
--   - Se não tem conteúdo associado: DELETE real.
--   - Se tem conteúdo (páginas, personagens, rolagens, etc.): anonimiza
--     (username → usuario-removido-{id}, password_hash/salt invalidados,
--     active=0) sem apagar a linha, preservando integridade referencial.

ALTER TABLE users ADD COLUMN deleted_at TEXT;
