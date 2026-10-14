-- Anonimiza a copia da producao que vai para a HOMOLOGACAO (scripts/homolog-copiar-producao.sh).
-- Clientes viram "Cliente 123" com telefone ficticio (5500...) e sem CPF/e-mail/nascimento; textos livres que podem ter
-- nome somem; conversas do WhatsApp, codigos de login e auditoria sao apagados. A equipe continua entrando com o
-- proprio acesso. A sessao do WhatsApp (schema evolution_api) nem vem na copia.
\set ON_ERROR_STOP on
BEGIN;

-- Clientes
WITH n AS (SELECT id, row_number() OVER (ORDER BY "criadoEm", id) AS i FROM clientes)
UPDATE clientes c
SET nome = 'Cliente ' || n.i, telefone = '5500' || lpad(n.i::text, 9, '0'), cpf = NULL, email = NULL, observacoes = NULL,
    "dataNascimento" = NULL, "origemDetalhe" = NULL
FROM n WHERE n.id = c.id;

-- Acesso dos clientes ao app: mesmo telefone ficticio, sem usuario nem senha (na homologacao o codigo aparece na tela).
UPDATE usuarios u SET telefone = c.telefone, nome = c.nome, login = NULL, "senhaHash" = NULL, "trocarSenha" = false
FROM clientes c WHERE c."usuarioId" = u.id AND u.papel = 'CLIENTE';
WITH n AS (
  SELECT u.id, row_number() OVER (ORDER BY u."criadoEm", u.id) AS i FROM usuarios u
  WHERE u.papel = 'CLIENTE' AND NOT EXISTS (SELECT 1 FROM clientes c WHERE c."usuarioId" = u.id)
)
UPDATE usuarios u SET telefone = '5501' || lpad(n.i::text, 9, '0'), nome = 'Cliente sem cadastro ' || n.i, login = NULL, "senhaHash" = NULL
FROM n WHERE n.id = u.id;

-- Textos livres que podem ter nome ou dado pessoal
UPDATE agendamentos SET observacao = NULL WHERE observacao IS NOT NULL;
UPDATE comandas SET "nomeAvulso" = 'Cliente avulso' WHERE "nomeAvulso" IS NOT NULL;
UPDATE comandas SET observacao = NULL WHERE observacao IS NOT NULL;
UPDATE links_pagamento SET nome = 'Cliente', telefone = '5500000000000', cpf = NULL, email = NULL;
UPDATE pedidos_estorno SET "clienteNome" = CASE WHEN "clienteNome" IS NULL THEN NULL ELSE 'Cliente' END, motivo = 'Motivo do pedido';
UPDATE retencoes_assinatura SET detalhe = NULL WHERE detalhe IS NOT NULL;
UPDATE beneficios SET descricao = 'Boas-vindas (indicação)' WHERE motivo = 'INDICADO';
UPDATE beneficios SET descricao = 'Indicou um amigo' WHERE motivo = 'INDICOU';
UPDATE checklist_pessoas SET "chavePix" = NULL WHERE "chavePix" IS NOT NULL;

-- Conversas do WhatsApp, codigos de login e o registro dos backups da producao
DELETE FROM mensagens;
DELETE FROM conversas;
DELETE FROM codigos_login;
DELETE FROM backups;

-- Auditoria (tem nomes, IP e aparelho). O bloqueio contra apagar vale na producao; aqui e uma copia.
ALTER TABLE auditoria DISABLE TRIGGER USER;
TRUNCATE auditoria;
ALTER TABLE auditoria ENABLE TRIGGER USER;

COMMIT;

-- Conferencia: nenhum cliente com telefone de verdade.
SELECT count(*) AS clientes, count(*) FILTER (WHERE telefone NOT LIKE '5500%') AS telefones_reais FROM clientes;
