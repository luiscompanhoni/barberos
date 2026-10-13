-- CreateEnum
CREATE TYPE "StatusLinkPagamento" AS ENUM ('PENDENTE', 'PAGO', 'CANCELADO', 'EXPIRADO');

-- AlterTable
ALTER TABLE "pagamentos_antecipados" ADD COLUMN     "pixExpiraEm" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "pagamentos_comanda" ADD COLUMN     "linkPagamentoId" TEXT;

-- CreateTable
CREATE TABLE "links_pagamento" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "clienteId" TEXT,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "cpf" TEXT,
    "email" TEXT,
    "comandaId" TEXT,
    "status" "StatusLinkPagamento" NOT NULL DEFAULT 'PENDENTE',
    "forma" "FormaPagamento",
    "parcelasMax" INTEGER NOT NULL DEFAULT 1,
    "parcelas" INTEGER,
    "gatewayId" TEXT,
    "pixCopiaECola" TEXT,
    "pixQrUrl" TEXT,
    "pixExpiraEm" TIMESTAMPTZ(3),
    "pagoEm" TIMESTAMPTZ(3),
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "links_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "links_pagamento_token_key" ON "links_pagamento"("token");

-- CreateIndex
CREATE UNIQUE INDEX "links_pagamento_gatewayId_key" ON "links_pagamento"("gatewayId");

-- CreateIndex
CREATE INDEX "links_pagamento_status_expiraEm_idx" ON "links_pagamento"("status", "expiraEm");

-- CreateIndex
CREATE INDEX "links_pagamento_comandaId_idx" ON "links_pagamento"("comandaId");

-- CreateIndex
CREATE INDEX "links_pagamento_pagoEm_idx" ON "links_pagamento"("pagoEm");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_comanda_linkPagamentoId_key" ON "pagamentos_comanda"("linkPagamentoId");

-- AddForeignKey
ALTER TABLE "pagamentos_comanda" ADD CONSTRAINT "pagamentos_comanda_linkPagamentoId_fkey" FOREIGN KEY ("linkPagamentoId") REFERENCES "links_pagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "links_pagamento" ADD CONSTRAINT "links_pagamento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "links_pagamento" ADD CONSTRAINT "links_pagamento_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "comandas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

