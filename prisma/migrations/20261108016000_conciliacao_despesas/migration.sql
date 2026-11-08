BEGIN;
CREATE TABLE vinculos_despesa_externa (
  id TEXT PRIMARY KEY, "movimentoId" TEXT NOT NULL REFERENCES movimentos_externos(id) ON DELETE RESTRICT,
  "despesaId" TEXT NOT NULL REFERENCES despesas(id) ON DELETE RESTRICT,
  "criadoPorId" TEXT NOT NULL, "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "anuladoEm" TIMESTAMPTZ(3), "anuladoPorId" TEXT, "motivoAnulacao" TEXT,
  CONSTRAINT vinculo_anulacao_completa CHECK (
    ("anuladoEm" IS NULL AND "anuladoPorId" IS NULL AND "motivoAnulacao" IS NULL) OR
    ("anuladoEm" IS NOT NULL AND "anuladoPorId" IS NOT NULL AND "motivoAnulacao" IS NOT NULL AND length(trim("motivoAnulacao")) >= 5))
);
CREATE INDEX "vinculos_despesa_externa_movimentoId_idx" ON vinculos_despesa_externa("movimentoId");
CREATE INDEX "vinculos_despesa_externa_despesaId_idx" ON vinculos_despesa_externa("despesaId");
CREATE UNIQUE INDEX vinculos_despesa_movimento_ativo ON vinculos_despesa_externa("movimentoId") WHERE "anuladoEm" IS NULL;
CREATE UNIQUE INDEX vinculos_despesa_despesa_ativa ON vinculos_despesa_externa("despesaId") WHERE "anuladoEm" IS NULL;
CREATE TABLE conferencias_extrato (
  id TEXT PRIMARY KEY, fonte "FonteExterna" NOT NULL, competencia TEXT NOT NULL,
  "hashDados" TEXT NOT NULL, snapshot JSONB NOT NULL, "criadoPorId" TEXT NOT NULL,
  "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT conferencia_competencia CHECK (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
CREATE INDEX "conferencias_extrato_fonte_competencia_criadoEm_idx" ON conferencias_extrato(fonte, competencia, "criadoEm");
CREATE FUNCTION preservar_conciliacao_despesas() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'vinculos_despesa_externa' THEN
    IF OLD."anuladoEm" IS NULL AND NEW."anuladoEm" IS NOT NULL AND
      (to_jsonb(OLD) - ARRAY['anuladoEm','anuladoPorId','motivoAnulacao']) = (to_jsonb(NEW) - ARRAY['anuladoEm','anuladoPorId','motivoAnulacao']) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Conciliação imutável: somente anulação justificada de vínculo ativo é permitida.' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER vinculos_despesa_preservar BEFORE UPDATE OR DELETE ON vinculos_despesa_externa FOR EACH ROW EXECUTE FUNCTION preservar_conciliacao_despesas();
CREATE TRIGGER vinculos_despesa_sem_truncate BEFORE TRUNCATE ON vinculos_despesa_externa FOR EACH STATEMENT EXECUTE FUNCTION preservar_conciliacao_despesas();
CREATE TRIGGER conferencias_extrato_preservar BEFORE UPDATE OR DELETE ON conferencias_extrato FOR EACH ROW EXECUTE FUNCTION preservar_conciliacao_despesas();
CREATE TRIGGER conferencias_extrato_sem_truncate BEFORE TRUNCATE ON conferencias_extrato FOR EACH STATEMENT EXECUTE FUNCTION preservar_conciliacao_despesas();
COMMIT;
