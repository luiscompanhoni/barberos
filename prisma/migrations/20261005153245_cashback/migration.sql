-- AlterTable
ALTER TABLE "beneficios" ADD COLUMN     "comandaOrigemId" TEXT,
ADD COLUMN     "expiraEm" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "configuracao" ADD COLUMN     "cashbackAtivo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cashbackPct" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "cashbackValidadeDias" INTEGER NOT NULL DEFAULT 90;

-- CreateIndex
CREATE UNIQUE INDEX "beneficios_comandaOrigemId_motivo_key" ON "beneficios"("comandaOrigemId", "motivo");

-- AlterTable
ALTER TABLE "beneficios" ADD COLUMN     "origemBeneficioId" TEXT;

