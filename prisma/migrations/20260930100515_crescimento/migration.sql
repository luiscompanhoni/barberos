-- CreateEnum
CREATE TYPE "StatusEspera" AS ENUM ('ATIVA', 'AVISADA', 'ATENDIDA', 'EXPIRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "PeriodoDia" AS ENUM ('QUALQUER', 'MANHA', 'TARDE', 'NOITE');

-- CreateEnum
CREATE TYPE "StatusBeneficio" AS ENUM ('DISPONIVEL', 'USADO', 'CANCELADO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoAutomacao" ADD VALUE 'RETORNO';
ALTER TYPE "TipoAutomacao" ADD VALUE 'ESPERA_HORARIO';
ALTER TYPE "TipoAutomacao" ADD VALUE 'INDICACAO';

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "codigoIndicacao" TEXT;

-- AlterTable
ALTER TABLE "configuracao" ADD COLUMN     "indicacaoAtiva" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "premioIndicadoCentavos" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "premioIndicadorCentavos" INTEGER NOT NULL DEFAULT 2000,
ADD COLUMN     "retornoAtivo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "esperas_horario" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "servicoId" TEXT NOT NULL,
    "barbeiroId" TEXT,
    "periodo" "PeriodoDia" NOT NULL DEFAULT 'QUALQUER',
    "status" "StatusEspera" NOT NULL DEFAULT 'ATIVA',
    "origem" "OrigemAgendamento" NOT NULL,
    "avisadaEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esperas_horario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicacoes" (
    "id" TEXT NOT NULL,
    "indicadorId" TEXT NOT NULL,
    "indicadoId" TEXT NOT NULL,
    "origem" "OrigemAgendamento" NOT NULL,
    "convertidaEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficios" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "status" "StatusBeneficio" NOT NULL DEFAULT 'DISPONIVEL',
    "motivo" TEXT NOT NULL,
    "indicacaoId" TEXT,
    "comandaId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usadoEm" TIMESTAMPTZ(3),

    CONSTRAINT "beneficios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "esperas_horario_status_data_idx" ON "esperas_horario"("status", "data");

-- CreateIndex
CREATE INDEX "esperas_horario_clienteId_status_idx" ON "esperas_horario"("clienteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "indicacoes_indicadoId_key" ON "indicacoes"("indicadoId");

-- CreateIndex
CREATE INDEX "indicacoes_indicadorId_idx" ON "indicacoes"("indicadorId");

-- CreateIndex
CREATE INDEX "beneficios_clienteId_status_idx" ON "beneficios"("clienteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "beneficios_indicacaoId_motivo_key" ON "beneficios"("indicacaoId", "motivo");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_codigoIndicacao_key" ON "clientes"("codigoIndicacao");

-- AddForeignKey
ALTER TABLE "esperas_horario" ADD CONSTRAINT "esperas_horario_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicacoes" ADD CONSTRAINT "indicacoes_indicadorId_fkey" FOREIGN KEY ("indicadorId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicacoes" ADD CONSTRAINT "indicacoes_indicadoId_fkey" FOREIGN KEY ("indicadoId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficios" ADD CONSTRAINT "beneficios_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficios" ADD CONSTRAINT "beneficios_indicacaoId_fkey" FOREIGN KEY ("indicacaoId") REFERENCES "indicacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

