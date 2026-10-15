-- Conciliacao: extrato das fontes externas (Celcash, depois Stone e CashBarber).
-- CreateEnum
CREATE TYPE "FonteExterna" AS ENUM ('CELCASH', 'STONE', 'CASHBARBER');

-- CreateEnum
CREATE TYPE "TipoMovimentoExterno" AS ENUM ('RECEBIMENTO', 'TAXA', 'ANTECIPACAO', 'ESTORNO', 'TRANSFERENCIA', 'PAGAMENTO', 'TARIFA', 'OUTRO');

-- AlterTable
ALTER TABLE "configuracao" ADD COLUMN     "contasProprias" TEXT[] DEFAULT ARRAY['BLACK BARBER', 'BLACK BARBEARIA']::TEXT[];

-- CreateTable
CREATE TABLE "movimentos_externos" (
    "id" TEXT NOT NULL,
    "fonte" "FonteExterna" NOT NULL,
    "idExterno" TEXT NOT NULL,
    "data" TIMESTAMPTZ(3) NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "tipo" "TipoMovimentoExterno" NOT NULL,
    "forma" TEXT,
    "descricao" TEXT NOT NULL,
    "transacaoId" TEXT,
    "categoria" TEXT,
    "classificadoPorId" TEXT,
    "observacao" TEXT,
    "bruto" JSONB,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_externos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimentos_externos_fonte_data_idx" ON "movimentos_externos"("fonte", "data");

-- CreateIndex
CREATE INDEX "movimentos_externos_tipo_data_idx" ON "movimentos_externos"("tipo", "data");

-- CreateIndex
CREATE UNIQUE INDEX "movimentos_externos_fonte_idExterno_key" ON "movimentos_externos"("fonte", "idExterno");

