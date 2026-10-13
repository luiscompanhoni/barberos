-- CreateEnum
CREATE TYPE "StatusAntecipado" AS ENUM ('PENDENTE', 'PAGO', 'CANCELADO', 'CREDITADO');

-- AlterTable
ALTER TABLE "pagamentos_comanda" ADD COLUMN     "antecipadoId" TEXT;

-- CreateTable
CREATE TABLE "pagamentos_antecipados" (
    "id" TEXT NOT NULL,
    "agendamentoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "status" "StatusAntecipado" NOT NULL DEFAULT 'PENDENTE',
    "gatewayId" TEXT,
    "link" TEXT,
    "pixCopiaECola" TEXT,
    "pixQrUrl" TEXT,
    "pagoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pagamentos_antecipados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_antecipados_agendamentoId_key" ON "pagamentos_antecipados"("agendamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_antecipados_gatewayId_key" ON "pagamentos_antecipados"("gatewayId");

-- CreateIndex
CREATE INDEX "pagamentos_antecipados_status_idx" ON "pagamentos_antecipados"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_comanda_antecipadoId_key" ON "pagamentos_comanda"("antecipadoId");

-- AddForeignKey
ALTER TABLE "pagamentos_comanda" ADD CONSTRAINT "pagamentos_comanda_antecipadoId_fkey" FOREIGN KEY ("antecipadoId") REFERENCES "pagamentos_antecipados"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos_antecipados" ADD CONSTRAINT "pagamentos_antecipados_agendamentoId_fkey" FOREIGN KEY ("agendamentoId") REFERENCES "agendamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos_antecipados" ADD CONSTRAINT "pagamentos_antecipados_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

