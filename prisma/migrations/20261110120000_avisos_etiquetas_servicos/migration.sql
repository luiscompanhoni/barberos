-- Expansão compatível: serviços sem etiqueta e esperas antigas continuam válidos.
ALTER TABLE "servicos"
  ADD COLUMN "etiquetas" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "etiquetasVersao" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "esperas_horario"
  ADD COLUMN "servicosAdicionais" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- A aplicação valida cada etiqueta; o banco também limita a forma básica e o volume.
ALTER TABLE "servicos"
  ADD CONSTRAINT "servicos_etiquetas_array" CHECK (
    jsonb_typeof("etiquetas") = 'array' AND jsonb_array_length("etiquetas") <= 6
  ),
  ADD CONSTRAINT "servicos_etiquetas_versao_nao_negativa" CHECK ("etiquetasVersao" >= 0);

ALTER TABLE "esperas_horario"
  ADD CONSTRAINT "esperas_horario_adicionais_limite" CHECK (
    cardinality("servicosAdicionais") <= 9
  );
