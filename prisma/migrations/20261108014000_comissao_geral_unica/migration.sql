BEGIN;
-- Não escolhe nem apaga regras antigas divergentes: o índice falha atomicamente se houver duplicatas.
CREATE UNIQUE INDEX comissoes_servico_regra_geral_unica ON comissoes_servico ("servicoId") WHERE "barbeiroId" IS NULL;
COMMIT;
