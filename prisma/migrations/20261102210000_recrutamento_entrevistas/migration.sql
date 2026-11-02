-- CreateTable
CREATE TABLE "recrutamento_entrevistas" (
    "id" TEXT NOT NULL,
    "candidaturaId" TEXT NOT NULL,
    "donoId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "geracao" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'CONVIDADO',
    "local" TEXT NOT NULL,
    "duracaoMin" INTEGER NOT NULL DEFAULT 45,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "propostaInicio" TIMESTAMPTZ(3),
    "propostaExpiraEm" TIMESTAMPTZ(3),
    "inicio" TIMESTAMPTZ(3),
    "fim" TIMESTAMPTZ(3),
    "confirmadoEm" TIMESTAMPTZ(3),
    "canceladoEm" TIMESTAMPTZ(3),
    "conversaId" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recrutamento_entrevistas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recrutamento_entrevistas_chave_key" ON "recrutamento_entrevistas"("chave");

-- CreateIndex
CREATE UNIQUE INDEX "recrutamento_entrevistas_tokenHash_key" ON "recrutamento_entrevistas"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "recrutamento_entrevistas_conversaId_key" ON "recrutamento_entrevistas"("conversaId");

-- CreateIndex
CREATE INDEX "recrutamento_entrevistas_donoId_estado_inicio_idx" ON "recrutamento_entrevistas"("donoId", "estado", "inicio");

-- CreateIndex
CREATE INDEX "recrutamento_entrevistas_candidaturaId_criadoEm_idx" ON "recrutamento_entrevistas"("candidaturaId", "criadoEm");

-- AddForeignKey
ALTER TABLE "recrutamento_entrevistas" ADD CONSTRAINT "recrutamento_entrevistas_candidaturaId_fkey" FOREIGN KEY ("candidaturaId") REFERENCES "recrutamento_candidaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariantes adicionais; a transação por dono impede também sobreposição parcial.
ALTER TABLE "recrutamento_entrevistas" ADD CONSTRAINT "entrevista_duracao" CHECK ("duracaoMin" BETWEEN 1 AND 45);
ALTER TABLE "recrutamento_entrevistas" ADD CONSTRAINT "entrevista_estado" CHECK ("estado" IN ('CONVIDADO','AGUARDA_CONFIRMACAO','CONFIRMADA','CANCELADA'));
ALTER TABLE "recrutamento_entrevistas" ADD CONSTRAINT "entrevista_intervalo" CHECK (
  (inicio IS NULL AND fim IS NULL) OR
  (inicio IS NOT NULL AND fim IS NOT NULL AND fim = inicio + "duracaoMin" * interval '1 minute'
    AND extract(isodow FROM inicio AT TIME ZONE 'America/Sao_Paulo') = 1
    AND (inicio AT TIME ZONE 'America/Sao_Paulo')::time >= time '14:00'
    AND (fim AT TIME ZONE 'America/Sao_Paulo')::time <= time '16:00'
    AND (inicio AT TIME ZONE 'America/Sao_Paulo')::date = (fim AT TIME ZONE 'America/Sao_Paulo')::date)
);
ALTER TABLE "recrutamento_entrevistas" ADD CONSTRAINT "entrevista_confirmada" CHECK ("estado" <> 'CONFIRMADA' OR (inicio IS NOT NULL AND "confirmadoEm" IS NOT NULL));
CREATE UNIQUE INDEX "entrevista_dono_inicio_confirmado" ON "recrutamento_entrevistas"("donoId", inicio) WHERE "estado" = 'CONFIRMADA';
