-- AlterTable
ALTER TABLE "assinaturas" ADD COLUMN     "tokenPublico" TEXT;

-- AlterTable
ALTER TABLE "cobrancas" ADD COLUMN     "boletoLinha" TEXT,
ADD COLUMN     "boletoUrl" TEXT,
ADD COLUMN     "expiraEm" TIMESTAMPTZ(3),
ADD COLUMN     "forma" "FormaPagamento",
ADD COLUMN     "pixCopiaECola" TEXT,
ADD COLUMN     "pixQrUrl" TEXT,
ADD COLUMN     "tokenPublico" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "assinaturas_tokenPublico_key" ON "assinaturas"("tokenPublico");

-- CreateIndex
CREATE UNIQUE INDEX "cobrancas_tokenPublico_key" ON "cobrancas"("tokenPublico");

