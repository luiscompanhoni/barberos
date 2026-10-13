-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('CARTAO', 'PIX', 'BOLETO');

-- CreateEnum
CREATE TYPE "StatusAssinatura" AS ENUM ('PENDENTE', 'ATIVA', 'ATRASADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusCobranca" AS ENUM ('PENDENTE', 'PAGA', 'ATRASADA', 'CANCELADA', 'ESTORNADA');

-- AlterTable
ALTER TABLE "agendamentos" ADD COLUMN     "assinaturaId" TEXT;

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "configuracao" ADD COLUMN     "toleranciaAtrasoDias" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "planos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "precoCentavos" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "vagas" INTEGER,
    "intervaloMinDias" INTEGER,
    "maxAgendamentosAbertos" INTEGER NOT NULL DEFAULT 1,
    "diasSemana" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "descontoExtrasPct" INTEGER NOT NULL DEFAULT 0,
    "formasPagamento" "FormaPagamento"[] DEFAULT ARRAY['CARTAO', 'PIX', 'BOLETO']::"FormaPagamento"[],
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plano_servicos" (
    "planoId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "usosPorCiclo" INTEGER,

    CONSTRAINT "plano_servicos_pkey" PRIMARY KEY ("planoId","servicoId")
);

-- CreateTable
CREATE TABLE "plano_barbeiros" (
    "planoId" TEXT NOT NULL,
    "barbeiroId" TEXT NOT NULL,

    CONSTRAINT "plano_barbeiros_pkey" PRIMARY KEY ("planoId","barbeiroId")
);

-- CreateTable
CREATE TABLE "assinaturas" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "planoId" TEXT NOT NULL,
    "status" "StatusAssinatura" NOT NULL DEFAULT 'PENDENTE',
    "formaPagamento" "FormaPagamento" NOT NULL,
    "precoCentavos" INTEGER NOT NULL,
    "gatewayId" TEXT,
    "gatewayClienteId" TEXT,
    "cicloInicio" TIMESTAMPTZ(3),
    "proximoVencimento" DATE,
    "criadaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativadaEm" TIMESTAMPTZ(3),
    "canceladaEm" TIMESTAMPTZ(3),
    "motivoCancelamento" TEXT,
    "origem" "OrigemAgendamento" NOT NULL,

    CONSTRAINT "assinaturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobrancas" (
    "id" TEXT NOT NULL,
    "assinaturaId" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "vencimento" DATE NOT NULL,
    "status" "StatusCobranca" NOT NULL DEFAULT 'PENDENTE',
    "pagaEm" TIMESTAMPTZ(3),
    "link" TEXT,
    "criadaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cobrancas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_pagamento" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cobrancaId" TEXT,
    "processadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lista_espera_planos" (
    "id" TEXT NOT NULL,
    "planoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "avisadoEm" TIMESTAMPTZ(3),

    CONSTRAINT "lista_espera_planos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assinaturas_gatewayId_key" ON "assinaturas"("gatewayId");

-- CreateIndex
CREATE INDEX "assinaturas_clienteId_status_idx" ON "assinaturas"("clienteId", "status");

-- CreateIndex
CREATE INDEX "assinaturas_planoId_status_idx" ON "assinaturas"("planoId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cobrancas_gatewayId_key" ON "cobrancas"("gatewayId");

-- CreateIndex
CREATE INDEX "cobrancas_assinaturaId_vencimento_idx" ON "cobrancas"("assinaturaId", "vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "lista_espera_planos_planoId_clienteId_key" ON "lista_espera_planos"("planoId", "clienteId");

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_assinaturaId_fkey" FOREIGN KEY ("assinaturaId") REFERENCES "assinaturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_servicos" ADD CONSTRAINT "plano_servicos_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "planos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_servicos" ADD CONSTRAINT "plano_servicos_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "servicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_barbeiros" ADD CONSTRAINT "plano_barbeiros_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "planos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_barbeiros" ADD CONSTRAINT "plano_barbeiros_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "barbeiros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "planos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobrancas" ADD CONSTRAINT "cobrancas_assinaturaId_fkey" FOREIGN KEY ("assinaturaId") REFERENCES "assinaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera_planos" ADD CONSTRAINT "lista_espera_planos_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "planos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera_planos" ADD CONSTRAINT "lista_espera_planos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
