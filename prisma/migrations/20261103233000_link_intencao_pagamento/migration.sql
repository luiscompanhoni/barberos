-- Aditivo: impede reenviar cobrança cujo resultado externo ainda é desconhecido.
ALTER TABLE "links_pagamento" ADD COLUMN "tentativaChave" TEXT;
CREATE UNIQUE INDEX "links_pagamento_tentativaChave_key" ON "links_pagamento"("tentativaChave");
