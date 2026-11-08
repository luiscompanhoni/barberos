-- Expansão apenas: preserva regras e créditos anteriores. Habilitar V2 depois de atualizar todos os processos.
ALTER TABLE "indicacoes" ADD COLUMN "regra" TEXT NOT NULL DEFAULT 'ATENDIMENTO_V1',
 ADD COLUMN "premioIndicadorCentavos" INTEGER,
 ADD COLUMN "premioIndicadoCentavos" INTEGER,
 ADD COLUMN "cobrancaConversaoId" TEXT,
 ADD COLUMN "estornadaEm" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "indicacoes_cobrancaConversaoId_key" ON "indicacoes"("cobrancaConversaoId");
CREATE TABLE "migracoes_assinaturas" (
 "id" TEXT NOT NULL PRIMARY KEY, "assinaturaId" TEXT NOT NULL,
 "estado" TEXT NOT NULL DEFAULT 'A_CONFERIR', "versao" INTEGER NOT NULL DEFAULT 0,
 "fonteGatewayId" TEXT, "destinoGatewayId" TEXT, "responsavelId" TEXT,
 "evidencias" JSONB NOT NULL DEFAULT '{}', "adiadoAte" DATE,
 "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "migracoes_assinaturas_assinaturaId_fkey" FOREIGN KEY ("assinaturaId") REFERENCES "assinaturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "migracoes_assinaturas_assinaturaId_key" ON "migracoes_assinaturas"("assinaturaId");
CREATE INDEX "migracoes_assinaturas_estado_atualizadoEm_idx" ON "migracoes_assinaturas"("estado", "atualizadoEm");
CREATE INDEX "migracoes_assinaturas_responsavelId_idx" ON "migracoes_assinaturas"("responsavelId");
CREATE TABLE "reservas_credito_assinatura" (
 "id" TEXT NOT NULL PRIMARY KEY, "assinaturaId" TEXT NOT NULL, "vencimento" DATE NOT NULL,
 "valorCentavos" INTEGER NOT NULL CHECK ("valorCentavos" > 0),
 "valorMensalidadeCentavos" INTEGER NOT NULL CHECK ("valorMensalidadeCentavos" >= "valorCentavos"),
 "estado" TEXT NOT NULL DEFAULT 'RESERVADA', "gatewayDescontoId" TEXT, "cobrancaId" TEXT,
 "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "reservas_credito_assinatura_assinaturaId_fkey" FOREIGN KEY ("assinaturaId") REFERENCES "assinaturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "reservas_credito_assinatura_assinaturaId_vencimento_key" ON "reservas_credito_assinatura"("assinaturaId", "vencimento");
CREATE UNIQUE INDEX "reservas_credito_assinatura_gatewayDescontoId_key" ON "reservas_credito_assinatura"("gatewayDescontoId");
CREATE UNIQUE INDEX "reservas_credito_assinatura_cobrancaId_key" ON "reservas_credito_assinatura"("cobrancaId");
CREATE INDEX "reservas_credito_assinatura_estado_atualizadoEm_idx" ON "reservas_credito_assinatura"("estado", "atualizadoEm");
ALTER TABLE "beneficios" ADD COLUMN "reservaCreditoId" TEXT;
ALTER TABLE "beneficios" ADD CONSTRAINT "beneficios_reservaCreditoId_fkey" FOREIGN KEY ("reservaCreditoId") REFERENCES "reservas_credito_assinatura"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
