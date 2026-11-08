-- Expansão estrutural. Nenhuma folha/despesa é retificada automaticamente.
-- Após a primeira retificação, binários sem versões ativas são incompatíveis: não fazer rollback cego.
BEGIN;
ALTER TABLE folha_pagamentos ADD COLUMN ativa BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN versao INTEGER NOT NULL DEFAULT 1, ADD COLUMN "substituiId" TEXT;
ALTER TABLE folha_pagamentos ADD CONSTRAINT folha_versao_positiva CHECK (versao > 0),
  ADD CONSTRAINT folha_substituicao_formato CHECK ((versao = 1 AND "substituiId" IS NULL) OR (versao > 1 AND "substituiId" IS NOT NULL)),
  ADD CONSTRAINT "folha_pagamentos_substituiId_fkey" FOREIGN KEY ("substituiId") REFERENCES folha_pagamentos(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
DROP INDEX "folha_pagamentos_competencia_pessoaId_key";
DROP INDEX "folha_pagamentos_competencia_barbeiroIdCongelado_key";
CREATE UNIQUE INDEX "folha_pagamentos_competencia_pessoaId_versao_key" ON folha_pagamentos(competencia, "pessoaId", versao);
CREATE UNIQUE INDEX "folha_pagamentos_substituiId_key" ON folha_pagamentos("substituiId");
CREATE INDEX "folha_pagamentos_competencia_ativa_idx" ON folha_pagamentos(competencia, ativa);
CREATE UNIQUE INDEX folha_ativa_pessoa_unica ON folha_pagamentos(competencia, "pessoaId") WHERE ativa;
CREATE UNIQUE INDEX folha_ativa_cadeira_unica ON folha_pagamentos(competencia, "barbeiroIdCongelado") WHERE ativa AND "barbeiroIdCongelado" IS NOT NULL;

ALTER TYPE "StatusDespesa" ADD VALUE 'ANULADA_TESTE';
CREATE TYPE "EstadoLoteFolhaPix" AS ENUM ('PREPARADO', 'CONFERIDO', 'INVALIDADO', 'ENVIADO', 'PAGO', 'INCERTO');
ALTER TABLE folha_lotes_pix ADD COLUMN estado "EstadoLoteFolhaPix" NOT NULL DEFAULT 'PREPARADO',
  ADD COLUMN "enviadoEm" TIMESTAMPTZ(3), ADD COLUMN "referenciaBancaria" TEXT,
  ADD COLUMN "invalidadoEm" TIMESTAMPTZ(3), ADD COLUMN "motivoInvalidacao" TEXT;
UPDATE folha_lotes_pix SET estado = 'CONFERIDO' WHERE "conferidoEm" IS NOT NULL;
ALTER TABLE folha_lotes_pix ADD CONSTRAINT lote_invalidacao_completa
  CHECK (estado <> 'INVALIDADO' OR ("invalidadoEm" IS NOT NULL AND length(trim("motivoInvalidacao")) >= 10));

CREATE TABLE folha_retificacoes_teste (
  id TEXT NOT NULL PRIMARY KEY, idempotencia TEXT NOT NULL, "folhaOriginalId" TEXT NOT NULL,
  "despesaOriginalId" TEXT NOT NULL, "atorId" TEXT NOT NULL, "atorSessaoVersao" INTEGER NOT NULL,
  motivo TEXT NOT NULL, declaracao TEXT NOT NULL, "revisaoOrigem" TEXT NOT NULL, "hashPedido" TEXT NOT NULL,
  "salarioSubstitutivoCentavos" INTEGER NOT NULL, "snapshotFolha" JSONB NOT NULL, "snapshotDespesa" JSONB NOT NULL,
  "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "folha_retificacoes_teste_folhaOriginalId_fkey" FOREIGN KEY ("folhaOriginalId") REFERENCES folha_pagamentos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "folha_retificacoes_teste_despesaOriginalId_fkey" FOREIGN KEY ("despesaOriginalId") REFERENCES despesas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "folha_retificacoes_teste_atorId_fkey" FOREIGN KEY ("atorId") REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT folha_retificacao_declaracao CHECK (declaracao = 'CONFIRMO_QUE_NAO_HOUVE_TRANSFERENCIA_REAL'),
  CONSTRAINT folha_retificacao_campos CHECK (length(trim(motivo)) BETWEEN 15 AND 500 AND "salarioSubstitutivoCentavos" BETWEEN 0 AND 100000000
    AND "revisaoOrigem" ~ '^[a-f0-9]{64}$' AND "hashPedido" ~ '^[a-f0-9]{64}$' AND "atorSessaoVersao" >= 0)
);
CREATE UNIQUE INDEX "folha_retificacoes_teste_idempotencia_key" ON folha_retificacoes_teste(idempotencia);
CREATE UNIQUE INDEX "folha_retificacoes_teste_folhaOriginalId_key" ON folha_retificacoes_teste("folhaOriginalId");
CREATE UNIQUE INDEX "folha_retificacoes_teste_despesaOriginalId_key" ON folha_retificacoes_teste("despesaOriginalId");

CREATE FUNCTION validar_folha_retificacao_teste() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f folha_pagamentos; d despesas;
BEGIN
  SELECT * INTO f FROM folha_pagamentos WHERE id = NEW."folhaOriginalId";
  SELECT * INTO d FROM despesas WHERE id = NEW."despesaOriginalId";
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = NEW."atorId" AND ativo AND papel::text = 'DONO' AND "sessaoVersao" = NEW."atorSessaoVersao") THEN
    RAISE EXCEPTION 'Retificacao exige dono ativo com sessao vigente';
  END IF;
  IF NOT f.ativa OR f.status::text <> 'PAGA' OR f.versao <> 1 OR f."despesaId" IS DISTINCT FROM d.id
    OR f."pagoEm" IS NULL OR f."salarioCentavos" <> 100 OR f."comissaoCentavos" <> 0 OR f."adicionaisCentavos" <> 0 OR f."descontosCentavos" <> 0 OR f."liquidoCentavos" <> 100
    OR d.status::text <> 'PAGA' OR d.categoria <> 'FOLHA' OR d."valorCentavos" <> 100 OR d."formaPagamento" IS DISTINCT FROM 'PIX'
    OR d."pagoEm" IS NULL OR d."movimentoCaixaId" IS NOT NULL OR d.recorrente THEN
    RAISE EXCEPTION 'Retificacao limitada ao registro interno de teste de um real, sem caixa';
  END IF;
  IF EXISTS (SELECT 1 FROM vinculos_despesa_externa WHERE "despesaId" = d.id) THEN
    RAISE EXCEPTION 'Despesa com evidencia bancaria nao pode ser anulada como teste';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auditoria WHERE acao = 'rh_folha_paga' AND entidade = 'folha_pagamento' AND "entidadeId" = f.id
    AND dados->>'forma' = 'PIX' AND dados->>'despesaId' = d.id AND dados->>'liquido' = '100') THEN
    RAISE EXCEPTION 'Origem manual do teste nao comprovada';
  END IF;
  IF EXISTS (SELECT 1 FROM folha_lotes_pix WHERE competencia = f.competencia
    AND (estado::text IN ('ENVIADO', 'PAGO', 'INCERTO') OR "enviadoEm" IS NOT NULL OR "referenciaBancaria" IS NOT NULL)) THEN
    RAISE EXCEPTION 'Competencia possui lote com resultado bancario';
  END IF;
  IF jsonb_populate_record(NULL::folha_pagamentos, NEW."snapshotFolha") IS DISTINCT FROM f
    OR jsonb_populate_record(NULL::despesas, NEW."snapshotDespesa") IS DISTINCT FROM d THEN
    RAISE EXCEPTION 'Snapshots nao correspondem aos originais';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER folha_retificacao_validar BEFORE INSERT ON folha_retificacoes_teste FOR EACH ROW EXECUTE FUNCTION validar_folha_retificacao_teste();

CREATE FUNCTION impedir_mudanca_retificacao_teste() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Retificacao interna e imutavel: preserve o registro original'; END $$;
CREATE TRIGGER folha_retificacao_imutavel BEFORE UPDATE OR DELETE ON folha_retificacoes_teste FOR EACH ROW EXECUTE FUNCTION impedir_mudanca_retificacao_teste();
CREATE TRIGGER folha_retificacao_sem_truncate BEFORE TRUNCATE ON folha_retificacoes_teste FOR EACH STATEMENT EXECUTE FUNCTION impedir_mudanca_retificacao_teste();

CREATE FUNCTION proteger_versao_folha() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE anterior folha_pagamentos;
BEGIN
  IF TG_OP <> 'INSERT' AND NOT OLD.ativa THEN RAISE EXCEPTION 'Folha retificada e historica: nao alterar ou apagar'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND NOT NEW.ativa THEN
    IF (to_jsonb(NEW) - 'ativa') IS DISTINCT FROM (to_jsonb(OLD) - 'ativa')
      OR NOT EXISTS (SELECT 1 FROM folha_retificacoes_teste WHERE "folhaOriginalId" = OLD.id) THEN
      RAISE EXCEPTION 'Somente a retificacao imutavel pode desativar o original, sem alterar seu retrato';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.versao <> OLD.versao OR NEW."substituiId" IS DISTINCT FROM OLD."substituiId") THEN
    RAISE EXCEPTION 'Identidade da versao da folha e imutavel';
  END IF;
  IF TG_OP = 'INSERT' AND NOT NEW.ativa THEN RAISE EXCEPTION 'Versao nova deve nascer ativa'; END IF;
  IF TG_OP = 'INSERT' AND NEW."substituiId" IS NOT NULL THEN
    SELECT * INTO anterior FROM folha_pagamentos WHERE id = NEW."substituiId";
    IF anterior.ativa OR anterior.competencia IS DISTINCT FROM NEW.competencia OR anterior."pessoaId" IS DISTINCT FROM NEW."pessoaId"
      OR anterior.versao + 1 <> NEW.versao OR NOT EXISTS (SELECT 1 FROM folha_retificacoes_teste WHERE "folhaOriginalId" = anterior.id) THEN
      RAISE EXCEPTION 'Substituicao exige mesma pessoa e competencia, versao anterior retificada e sequencia';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER folha_versao_proteger BEFORE INSERT OR UPDATE OR DELETE ON folha_pagamentos FOR EACH ROW EXECUTE FUNCTION proteger_versao_folha();

CREATE FUNCTION proteger_despesa_teste_anulada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text = 'ANULADA_TESTE' THEN RAISE EXCEPTION 'Despesa anulada exige original preservado e retificacao'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status::text = 'ANULADA_TESTE' THEN RAISE EXCEPTION 'Despesa anulada de teste e imutavel'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.status::text = 'ANULADA_TESTE' AND ((to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status')
    OR NOT EXISTS (SELECT 1 FROM folha_retificacoes_teste WHERE "despesaOriginalId" = OLD.id)) THEN
    RAISE EXCEPTION 'Anulacao de teste exige retificacao imutavel e preservacao de valores e datas';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER despesa_teste_proteger BEFORE INSERT OR UPDATE OR DELETE ON despesas FOR EACH ROW EXECUTE FUNCTION proteger_despesa_teste_anulada();

CREATE FUNCTION conferir_retificacao_atomica() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM folha_pagamentos WHERE id = NEW."folhaOriginalId" AND NOT ativa AND status::text = 'PAGA')
    OR NOT EXISTS (SELECT 1 FROM despesas WHERE id = NEW."despesaOriginalId" AND status::text = 'ANULADA_TESTE')
    OR NOT EXISTS (SELECT 1 FROM auditoria WHERE acao = 'rh_folha_retificar_teste' AND "entidadeId" = NEW.id AND "usuarioId" = NEW."atorId") THEN
    RAISE EXCEPTION 'Retificacao deve preservar original, anular despesa e auditar na mesma transacao';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER folha_retificacao_atomica AFTER INSERT ON folha_retificacoes_teste DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION conferir_retificacao_atomica();

CREATE FUNCTION proteger_auditoria_retificacao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.acao = 'rh_folha_retificar_teste' THEN RAISE EXCEPTION 'Auditoria da retificacao e imutavel'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER auditoria_retificacao_proteger BEFORE UPDATE OR DELETE ON auditoria FOR EACH ROW EXECUTE FUNCTION proteger_auditoria_retificacao();

CREATE FUNCTION proteger_lote_pix_enviado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado::text IN ('ENVIADO', 'PAGO', 'INCERTO') OR OLD."enviadoEm" IS NOT NULL OR OLD."referenciaBancaria" IS NOT NULL THEN
    IF TG_OP = 'DELETE' OR NEW.estado::text IN ('PREPARADO', 'CONFERIDO', 'INVALIDADO') THEN RAISE EXCEPTION 'Lote com resultado bancario deve ser preservado'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF OLD.estado::text = 'INVALIDADO' THEN RAISE EXCEPTION 'Lote invalidado e historico'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lote_pix_resultado_proteger BEFORE UPDATE OR DELETE ON folha_lotes_pix FOR EACH ROW EXECUTE FUNCTION proteger_lote_pix_enviado();
COMMIT;
