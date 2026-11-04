CREATE TABLE "cobranca_automatica_tentativas" (
  "id" TEXT NOT NULL,
  "cobrancaId" TEXT NOT NULL,
  "canal" TEXT NOT NULL DEFAULT 'WHATSAPP',
  "etapa" TEXT NOT NULL DEFAULT 'PRIMEIRO_AVISO',
  "estado" TEXT NOT NULL DEFAULT 'PREPARADA',
  "revisaoMotivo" TEXT,
  "mensagemId" TEXT,
  "versao" INTEGER NOT NULL DEFAULT 0,
  "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "cobranca_automatica_tentativas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cobranca_automatica_tentativas_estado_check" CHECK ("estado" IN ('PREPARADA', 'REVISAO', 'ENVIANDO', 'ACEITA', 'INCERTA', 'CANCELADA')),
  CONSTRAINT "cobranca_automatica_tentativas_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "cobrancas"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cobranca_automatica_tentativas_cobrancaId_canal_etapa_key" ON "cobranca_automatica_tentativas"("cobrancaId", "canal", "etapa");
