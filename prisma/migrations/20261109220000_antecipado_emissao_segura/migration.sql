-- Aditiva: preserva pagamentos e histórico existentes. Claim nulo nos registros legados.
ALTER TABLE "pagamentos_antecipados" ADD COLUMN "emissaoChave" TEXT;
CREATE UNIQUE INDEX "pagamentos_antecipados_emissaoChave_key" ON "pagamentos_antecipados"("emissaoChave");
