BEGIN;
CREATE INDEX "movimentos_externos_fonte_transacaoId_idx" ON "movimentos_externos"("fonte", "transacaoId");
CREATE TABLE "vinculos_cobrancas_externas" (
    "id" TEXT NOT NULL,
    "fonte" "FonteExterna" NOT NULL,
    "transacaoId" TEXT NOT NULL,
    "contratoId" TEXT,
    "cobrancaId" TEXT NOT NULL,
    "recebimentoId" TEXT NOT NULL,
    "estornoMovimentoId" TEXT,
    "pedidoEstornoId" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "referenciaBackup" TEXT NOT NULL,
    "evidencia" JSONB NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "vinculos_cobrancas_externas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vinculos_cobrancas_externas_fonte_transacaoId_key" ON "vinculos_cobrancas_externas"("fonte", "transacaoId");
CREATE UNIQUE INDEX "vinculos_cobrancas_externas_fonte_cobrancaId_key" ON "vinculos_cobrancas_externas"("fonte", "cobrancaId");
CREATE UNIQUE INDEX "vinculos_cobrancas_externas_recebimentoId_key" ON "vinculos_cobrancas_externas"("recebimentoId");
CREATE UNIQUE INDEX "vinculos_cobrancas_externas_estornoMovimentoId_key" ON "vinculos_cobrancas_externas"("estornoMovimentoId");
CREATE UNIQUE INDEX "vinculos_cobrancas_externas_pedidoEstornoId_key" ON "vinculos_cobrancas_externas"("pedidoEstornoId");
ALTER TABLE "vinculos_cobrancas_externas" ADD CONSTRAINT "vinculos_cobrancas_externas_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "cobrancas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vinculos_cobrancas_externas" ADD CONSTRAINT "vinculos_cobrancas_externas_recebimentoId_fkey" FOREIGN KEY ("recebimentoId") REFERENCES "movimentos_externos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vinculos_cobrancas_externas" ADD CONSTRAINT "vinculos_cobrancas_externas_estornoMovimentoId_fkey" FOREIGN KEY ("estornoMovimentoId") REFERENCES "movimentos_externos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vinculos_cobrancas_externas" ADD CONSTRAINT "vinculos_cobrancas_externas_pedidoEstornoId_fkey" FOREIGN KEY ("pedidoEstornoId") REFERENCES "pedidos_estorno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
