ALTER TABLE "webhooks_pagamento_entrada" ADD COLUMN "chaveSequencia" TEXT NOT NULL DEFAULT '';
CREATE INDEX "webhooks_pagamento_entrada_chaveSequencia_estado_idx" ON "webhooks_pagamento_entrada"("chaveSequencia", "estado");
