-- CreateTable
CREATE TABLE "cobrancas_simuladas" (
    "id" TEXT NOT NULL,
    "assinaturaGatewayId" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "vencimento" DATE NOT NULL,
    "status" "StatusCobranca" NOT NULL DEFAULT 'PENDENTE',
    "pagaEm" TIMESTAMPTZ(3),
    "criadaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cobrancas_simuladas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cobrancas_simuladas_assinaturaGatewayId_idx" ON "cobrancas_simuladas"("assinaturaGatewayId");
