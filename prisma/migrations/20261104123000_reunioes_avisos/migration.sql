CREATE TABLE "reunioes_avisos" (
  "id" TEXT NOT NULL,
  "tipo" TEXT NOT NULL DEFAULT 'AVISO',
  "texto" VARCHAR(500) NOT NULL,
  "concluido" BOOLEAN NOT NULL DEFAULT false,
  "criadoPorId" TEXT NOT NULL,
  "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,
  "versao" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "reunioes_avisos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reunioes_avisos_tipo_check" CHECK ("tipo" IN ('AVISO', 'OBJETIVO'))
);
CREATE INDEX "reunioes_avisos_concluido_criadoEm_idx" ON "reunioes_avisos"("concluido", "criadoEm");
