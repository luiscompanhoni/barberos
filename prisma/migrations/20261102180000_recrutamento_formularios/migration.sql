-- AlterTable
ALTER TABLE "recrutamento_vagas" ADD COLUMN     "formularioId" TEXT;

-- AlterTable
ALTER TABLE "recrutamento_candidaturas" ADD COLUMN     "formularioSnapshot" JSONB,
ADD COLUMN     "respostas" JSONB;

-- CreateTable
CREATE TABLE "recrutamento_formularios" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "funcao" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "revisao" INTEGER NOT NULL DEFAULT 0,
    "origemId" TEXT,
    "definicao" JSONB NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "aprovadoPorId" TEXT,
    "aprovadoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recrutamento_formularios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recrutamento_avaliacoes" (
    "id" TEXT NOT NULL,
    "candidaturaId" TEXT NOT NULL,
    "etapa" TEXT NOT NULL,
    "criterios" JSONB NOT NULL,
    "nota" DOUBLE PRECISION,
    "cobertura" INTEGER NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recrutamento_avaliacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recrutamento_avaliacoes_candidaturaId_criadoEm_idx" ON "recrutamento_avaliacoes"("candidaturaId", "criadoEm");

-- AddForeignKey
ALTER TABLE "recrutamento_vagas" ADD CONSTRAINT "recrutamento_vagas_formularioId_fkey" FOREIGN KEY ("formularioId") REFERENCES "recrutamento_formularios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recrutamento_avaliacoes" ADD CONSTRAINT "recrutamento_avaliacoes_candidaturaId_fkey" FOREIGN KEY ("candidaturaId") REFERENCES "recrutamento_candidaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
