CREATE TABLE "solicitacoes_horario" (
  "id" TEXT PRIMARY KEY,
  "barbeiroId" TEXT NOT NULL REFERENCES "barbeiros"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "solicitadoPorId" TEXT NOT NULL REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "proposto" JSONB NOT NULL,
  "original" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDENTE' CHECK ("status" IN ('PENDENTE', 'APROVADA', 'RECUSADA')),
  "decididoPorId" TEXT REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "motivoDecisao" TEXT,
  "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decididoEm" TIMESTAMPTZ(3)
);
CREATE INDEX "solicitacoes_horario_barbeiroId_criadoEm_idx" ON "solicitacoes_horario" ("barbeiroId", "criadoEm");
CREATE UNIQUE INDEX "solicitacoes_horario_pendente_por_barbeiro" ON "solicitacoes_horario" ("barbeiroId") WHERE "status" = 'PENDENTE';
