CREATE TABLE "emissoes_pix_mensal" (
  "id" TEXT NOT NULL,
  "assinaturaId" TEXT NOT NULL,
  "vencimento" TIMESTAMPTZ(3) NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'EMITINDO',
  "cobrancaId" TEXT,
  "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "emissoes_pix_mensal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "emissoes_pix_mensal_estado_check" CHECK ("estado" IN ('EMITINDO','CONFIRMADA','INCERTA'))
);
CREATE UNIQUE INDEX "emissoes_pix_mensal_assinaturaId_vencimento_key" ON "emissoes_pix_mensal"("assinaturaId", "vencimento");
