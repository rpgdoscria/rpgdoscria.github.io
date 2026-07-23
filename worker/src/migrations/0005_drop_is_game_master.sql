-- Migration 0005: remover coluna is_game_master (mestre = admin)
--
-- A flag is_game_master foi adicionada no Prompt 3 como uma permissão separada
-- do role, mas nunca teve UI/endpoint pra concedê-la. Resultado: admin criado
-- no bootstrap não conseguia testar salas/dados/inimigos. Correção: mestre e
-- admin passam a ser o mesmo cargo — toda checagem usa role = 'admin'.
--
-- SQLite 3.35+ (e portanto D1) suporta DROP COLUMN diretamente. Se o ambiente
-- for mais antigo, a alternativa é recriar a tabela (não necessário no D1).
ALTER TABLE users DROP COLUMN is_game_master;
