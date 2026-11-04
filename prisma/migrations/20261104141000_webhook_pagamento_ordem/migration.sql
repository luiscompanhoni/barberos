ALTER TABLE "webhooks_pagamento_entrada" ADD COLUMN "sequencia" BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX "webhooks_pagamento_entrada_sequencia_key" ON "webhooks_pagamento_entrada"("sequencia");
