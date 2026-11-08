BEGIN;
ALTER TABLE folha_pagamentos ADD COLUMN "barbeiroIdCongelado" TEXT;
-- Somente identidade explicitamente congelada é migrada. Nome/telefone atuais não são prova histórica.
UPDATE folha_pagamentos SET "barbeiroIdCongelado" = detalhe->>'barbeiroId'
WHERE jsonb_typeof(detalhe->'barbeiroId') = 'string' AND length(detalhe->>'barbeiroId') > 0;
CREATE UNIQUE INDEX "folha_pagamentos_competencia_barbeiroIdCongelado_key" ON folha_pagamentos(competencia, "barbeiroIdCongelado");
COMMIT;
