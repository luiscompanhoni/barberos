-- Campanhas existentes mantêm integralmente a apuração anterior de produtos.
ALTER TABLE "campanhas_equipe"
  ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'PRODUTOS',
  ADD COLUMN "servicoIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "campanhas_equipe" ADD CONSTRAINT "campanhas_equipe_tipo_valido"
  CHECK (("tipo" = 'PRODUTOS' AND cardinality("servicoIds") = 0)
      OR ("tipo" = 'SERVICOS' AND cardinality("servicoIds") > 0 AND "metaCentavos" = 0));
