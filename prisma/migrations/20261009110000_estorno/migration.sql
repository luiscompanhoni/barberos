-- CreateEnum
CREATE TYPE "TipoEstorno" AS ENUM ('COMANDA', 'ANTECIPADO', 'LINK', 'MENSALIDADE');

-- CreateEnum
CREATE TYPE "StatusEstorno" AS ENUM ('PENDENTE', 'APROVADO', 'RECUSADO', 'EXECUTADO', 'FALHOU', 'MANUAL');

-- AlterEnum
ALTER TYPE "StatusAntecipado" ADD VALUE 'ESTORNADO';

-- AlterEnum
ALTER TYPE "StatusLinkPagamento" ADD VALUE 'ESTORNADO';

-- AlterTable
ALTER TABLE "pagamentos_comanda" ADD COLUMN     "estornadoCentavos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "estornadoEm" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "pedidos_estorno" (
    "id" TEXT NOT NULL,
    "tipo" "TipoEstorno" NOT NULL,
    "referenciaId" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "valorOriginalCentavos" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "status" "StatusEstorno" NOT NULL DEFAULT 'PENDENTE',
    "meio" TEXT NOT NULL,
    "forma" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "comandaId" TEXT,
    "clienteNome" TEXT,
    "pedidoPorId" TEXT,
    "decididoPorId" TEXT,
    "motivoDecisao" TEXT,
    "gatewayEstornoId" TEXT,
    "instrucao" TEXT,
    "erro" TEXT,
    "movimentoCaixaId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decididoEm" TIMESTAMPTZ(3),
    "executadoEm" TIMESTAMPTZ(3),
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pedidos_estorno_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_estorno_movimentoCaixaId_key" ON "pedidos_estorno"("movimentoCaixaId");

-- CreateIndex
CREATE INDEX "pedidos_estorno_status_criadoEm_idx" ON "pedidos_estorno"("status", "criadoEm");

-- CreateIndex
CREATE INDEX "pedidos_estorno_tipo_referenciaId_idx" ON "pedidos_estorno"("tipo", "referenciaId");

-- CreateIndex
CREATE INDEX "pedidos_estorno_executadoEm_idx" ON "pedidos_estorno"("executadoEm");

-- CreateIndex
CREATE INDEX "pedidos_estorno_comandaId_idx" ON "pedidos_estorno"("comandaId");

