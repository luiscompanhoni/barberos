-- Aditiva: preserva presets, snapshots e aprovações dos projetos existentes.
ALTER TABLE "estudio_projetos"
  ADD COLUMN "preset" VARCHAR(50) NOT NULL DEFAULT 'black-vertical-v1',
  ADD COLUMN "titulo" VARCHAR(70) NOT NULL DEFAULT '',
  ADD COLUMN "chamada" VARCHAR(70) NOT NULL DEFAULT '',
  ADD COLUMN "origemExecucaoId" TEXT,
  ADD COLUMN "roteiro" JSONB;
CREATE UNIQUE INDEX "estudio_projetos_usuarioId_origemExecucaoId_key" ON "estudio_projetos"("usuarioId", "origemExecucaoId");
ALTER TABLE "estudio_projetos" ADD CONSTRAINT "estudio_projetos_origemExecucaoId_fkey" FOREIGN KEY ("origemExecucaoId") REFERENCES "agente_execucoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
