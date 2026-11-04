CREATE TABLE "webhooks_pagamento_entrada" (
  "id" TEXT NOT NULL,
  "fonte" TEXT NOT NULL,
  "carga" JSONB NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'PENDENTE',
  "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "webhooks_pagamento_entrada_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "webhooks_pagamento_entrada_estado_check" CHECK ("estado" IN ('PENDENTE','PROCESSANDO','CONCLUIDO','REVISAO'))
);
CREATE INDEX "webhooks_pagamento_entrada_estado_criadoEm_idx" ON "webhooks_pagamento_entrada"("estado", "criadoEm");
