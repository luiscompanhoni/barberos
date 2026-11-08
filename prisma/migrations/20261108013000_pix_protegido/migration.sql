BEGIN;
ALTER TABLE checklist_pessoas ADD COLUMN "chavePixCifrada" TEXT,
  ADD COLUMN "chavePixMascarada" TEXT, ADD COLUMN "chavePixTipo" TEXT, ADD COLUMN "chavePixHash" TEXT;
ALTER TABLE checklist_pessoas ADD CONSTRAINT checklist_pessoas_pix_protegido CHECK (
  ("chavePixCifrada" IS NULL AND "chavePixMascarada" IS NULL AND "chavePixTipo" IS NULL AND "chavePixHash" IS NULL) OR
  ("chavePixCifrada" IS NOT NULL AND "chavePixMascarada" IS NOT NULL AND "chavePixTipo" IS NOT NULL AND "chavePixHash" IS NOT NULL AND "chavePix" IS NULL)
);
CREATE OR REPLACE FUNCTION revisao_pix_cadastro() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW."chavePix", NEW."chavePixCifrada", NEW."chavePixMascarada", NEW."chavePixTipo", NEW."chavePixHash")
    IS DISTINCT FROM ROW(OLD."chavePix", OLD."chavePixCifrada", OLD."chavePixMascarada", OLD."chavePixTipo", OLD."chavePixHash")
    OR NEW.nome IS DISTINCT FROM OLD.nome OR NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    NEW."revisaoPix" := OLD."revisaoPix" + 1;
  ELSE
    NEW."revisaoPix" := OLD."revisaoPix";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMIT;
