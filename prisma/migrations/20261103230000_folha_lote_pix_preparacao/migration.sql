-- Aditivo: apenas preparação local, sem transferência ou alteração de folha/despesa.
ALTER TABLE "checklist_pessoas" ADD COLUMN "revisaoPix" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION revisao_pix_cadastro() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."chavePix" IS DISTINCT FROM OLD."chavePix"
     OR NEW.nome IS DISTINCT FROM OLD.nome
     OR NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    NEW."revisaoPix" := OLD."revisaoPix" + 1;
  ELSE
    NEW."revisaoPix" := OLD."revisaoPix";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER checklist_revisao_pix BEFORE UPDATE ON "checklist_pessoas"
FOR EACH ROW EXECUTE FUNCTION revisao_pix_cadastro();

CREATE TABLE "folha_lotes_pix" (
  "id" TEXT NOT NULL,
  "competencia" TEXT NOT NULL,
  "revisao" TEXT NOT NULL,
  "totalCentavos" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "criadoPorId" TEXT NOT NULL,
  "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "conferidoPorId" TEXT,
  "conferidoEm" TIMESTAMPTZ(3),
  CONSTRAINT "folha_lotes_pix_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "folha_lotes_pix_total_positivo" CHECK ("totalCentavos" > 0),
  CONSTRAINT "folha_lotes_pix_conferencia_completa" CHECK (("conferidoPorId" IS NULL) = ("conferidoEm" IS NULL))
);
CREATE UNIQUE INDEX "folha_lotes_pix_competencia_revisao_key" ON "folha_lotes_pix"("competencia", "revisao");
