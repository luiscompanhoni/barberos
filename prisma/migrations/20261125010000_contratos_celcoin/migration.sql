-- Tabela nova e vazia: posição dos contratos da Celcoin que o BarberOS não emitiu. Só exibição.
CREATE TABLE "contratos_celcoin" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT,
    "vinculo" TEXT NOT NULL,
    "transacaoId" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "statusCelcoin" TEXT NOT NULL,
    "situacao" "StatusCobranca" NOT NULL,
    "vencimento" DATE NOT NULL,
    "pagoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contratos_celcoin_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contratos_celcoin_clienteId_idx" ON "contratos_celcoin"("clienteId");
