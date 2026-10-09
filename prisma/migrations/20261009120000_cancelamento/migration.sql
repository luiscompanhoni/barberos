-- CreateEnum
CREATE TYPE "MotivoSaida" AS ENUM ('PRECO', 'NAO_USA', 'VIAGEM', 'MUDANCA', 'HORARIOS', 'INSATISFEITO', 'OUTRO');

-- CreateEnum
CREATE TYPE "DesfechoRetencao" AS ENUM ('CANCELOU', 'DESCONTO', 'PAUSA', 'GERENTE');

-- AlterTable
ALTER TABLE "assinaturas" ADD COLUMN     "descontoRetencaoAte" DATE,
ADD COLUMN     "descontoRetencaoPct" INTEGER,
ADD COLUMN     "encerraEm" DATE,
ADD COLUMN     "pausadaAte" DATE,
ADD COLUMN     "pausadaEm" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "retencao_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "descontoAtivo" BOOLEAN NOT NULL DEFAULT true,
    "descontoPct" INTEGER NOT NULL DEFAULT 20,
    "descontoMeses" INTEGER NOT NULL DEFAULT 2,
    "pausaAtiva" BOOLEAN NOT NULL DEFAULT true,
    "pausaMaxDias" INTEGER NOT NULL DEFAULT 60,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "retencao_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retencoes_assinatura" (
    "id" TEXT NOT NULL,
    "assinaturaId" TEXT NOT NULL,
    "motivo" "MotivoSaida" NOT NULL,
    "detalhe" TEXT,
    "desfecho" "DesfechoRetencao" NOT NULL,
    "origem" "OrigemAgendamento" NOT NULL,
    "dados" JSONB,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retencoes_assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "retencoes_assinatura_criadoEm_idx" ON "retencoes_assinatura"("criadoEm");

-- CreateIndex
CREATE INDEX "retencoes_assinatura_assinaturaId_desfecho_idx" ON "retencoes_assinatura"("assinaturaId", "desfecho");

-- AddForeignKey
ALTER TABLE "retencoes_assinatura" ADD CONSTRAINT "retencoes_assinatura_assinaturaId_fkey" FOREIGN KEY ("assinaturaId") REFERENCES "assinaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

