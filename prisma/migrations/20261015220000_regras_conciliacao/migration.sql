-- Regras de classificacao da conciliacao (por nome do destino/origem).
-- CreateTable
CREATE TABLE "regras_conciliacao" (
    "id" TEXT NOT NULL,
    "padrao" TEXT NOT NULL,
    "tipo" "TipoMovimentoExterno" NOT NULL,
    "categoria" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regras_conciliacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regras_conciliacao_padrao_key" ON "regras_conciliacao"("padrao");

