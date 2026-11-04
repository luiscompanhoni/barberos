-- Registro restrito de elegibilidade: sem resposta, nota, profissional ou informação para correlacionar respostas.
CREATE TABLE "avaliacao_mensal_elegibilidade" (
  "id" TEXT NOT NULL,
  "clienteId" TEXT NOT NULL,
  "cobrancaId" TEXT NOT NULL,
  "competencia" VARCHAR(7) NOT NULL,
  "pulouEm" TIMESTAMPTZ(3),
  "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "avaliacao_mensal_elegibilidade_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "avaliacao_mensal_competencia_valida" CHECK ("competencia" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "avaliacao_mensal_elegibilidade_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "avaliacao_mensal_elegibilidade_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "cobrancas"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "avaliacao_mensal_elegibilidade_cobrancaId_key" ON "avaliacao_mensal_elegibilidade"("cobrancaId");
CREATE UNIQUE INDEX "avaliacao_mensal_elegibilidade_clienteId_competencia_key" ON "avaliacao_mensal_elegibilidade"("clienteId", "competencia");
