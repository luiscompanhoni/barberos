BEGIN;
ALTER TABLE cobrancas ADD COLUMN "valorRecebidoConfirmadoCentavos" INTEGER,
  ADD COLUMN "recebidoConfirmadoEm" TIMESTAMPTZ(3), ADD COLUMN "provaRecebimento" JSONB;
ALTER TABLE cobrancas ADD CONSTRAINT cobrancas_recebimento_comprovado CHECK (
  ("valorRecebidoConfirmadoCentavos" IS NULL AND "recebidoConfirmadoEm" IS NULL AND "provaRecebimento" IS NULL) OR
  ("valorRecebidoConfirmadoCentavos" IS NOT NULL AND "valorRecebidoConfirmadoCentavos" >= 0 AND "recebidoConfirmadoEm" IS NOT NULL AND "provaRecebimento" IS NOT NULL)
);
CREATE INDEX cobrancas_recebido_confirmado_em_idx ON cobrancas ("recebidoConfirmadoEm");
-- Não inventar prova para cobranças históricas pela etiqueta PAGA ou pelo valor nominal.
COMMIT;
