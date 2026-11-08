BEGIN;
CREATE TABLE remuneracao_versoes (
  id TEXT PRIMARY KEY, escopo TEXT NOT NULL, competencia TEXT NOT NULL,
  versao INTEGER NOT NULL CHECK (versao > 0), "conteudoJson" JSONB NOT NULL,
  "criadoPorId" TEXT, "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT remuneracao_versoes_competencia CHECK (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
CREATE UNIQUE INDEX "remuneracao_versoes_escopo_competencia_versao_key" ON remuneracao_versoes (escopo, competencia, versao);
CREATE FUNCTION preservar_remuneracao_versoes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Versões de remuneração são imutáveis; registre uma nova versão.' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER remuneracao_versoes_imutavel BEFORE UPDATE OR DELETE ON remuneracao_versoes FOR EACH ROW EXECUTE FUNCTION preservar_remuneracao_versoes();
CREATE TRIGGER remuneracao_versoes_sem_truncate BEFORE TRUNCATE ON remuneracao_versoes FOR EACH STATEMENT EXECUTE FUNCTION preservar_remuneracao_versoes();
COMMIT;
