-- AlterTable
ALTER TABLE "campanha_envios" ADD COLUMN     "aberturaConcluidaEm" TIMESTAMPTZ(3),
ADD COLUMN     "aberturaIniciadaEm" TIMESTAMPTZ(3),
ADD COLUMN     "continuacaoReservadaEm" TIMESTAMPTZ(3),
ADD COLUMN     "ofertaEnviadaEm" TIMESTAMPTZ(3),
ADD COLUMN     "ofertaTexto" TEXT,
ADD COLUMN     "respostaEm" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "jornadas_roleta" (
    "jogadaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "agendamentoId" TEXT,
    "girouEm" TIMESTAMPTZ(3) NOT NULL,
    "ganhouEm" TIMESTAMPTZ(3),
    "semContinuidadeEm" TIMESTAMPTZ(3),
    "nudgeTentadoEm" TIMESTAMPTZ(3),
    "nudgeEnviadoEm" TIMESTAMPTZ(3),
    "respondeuEm" TIMESTAMPTZ(3),
    "agendouEm" TIMESTAMPTZ(3),
    "lembreteEnviadoEm" TIMESTAMPTZ(3),
    "compareceuEm" TIMESTAMPTZ(3),
    "concluiuEm" TIMESTAMPTZ(3),
    "posEnviadoEm" TIMESTAMPTZ(3),
    "upsellTentadoEm" TIMESTAMPTZ(3),
    "upsellEnviadoEm" TIMESTAMPTZ(3),
    "upsellAceitoEm" TIMESTAMPTZ(3),

    CONSTRAINT "jornadas_roleta_pkey" PRIMARY KEY ("jogadaId")
);

-- CreateIndex
CREATE UNIQUE INDEX "jornadas_roleta_agendamentoId_key" ON "jornadas_roleta"("agendamentoId");

-- CreateIndex
CREATE INDEX "jornadas_roleta_girouEm_idx" ON "jornadas_roleta"("girouEm");

-- CreateIndex
CREATE INDEX "jornadas_roleta_clienteId_girouEm_idx" ON "jornadas_roleta"("clienteId", "girouEm");

-- CreateIndex
CREATE INDEX "jornadas_roleta_ganhouEm_nudgeTentadoEm_idx" ON "jornadas_roleta"("ganhouEm", "nudgeTentadoEm");

-- CreateIndex
CREATE INDEX "jornadas_roleta_concluiuEm_idx" ON "jornadas_roleta"("concluiuEm");

-- AddForeignKey
ALTER TABLE "jornadas_roleta" ADD CONSTRAINT "jornadas_roleta_jogadaId_fkey" FOREIGN KEY ("jogadaId") REFERENCES "jogadas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jornadas_roleta" ADD CONSTRAINT "jornadas_roleta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jornadas_roleta" ADD CONSTRAINT "jornadas_roleta_agendamentoId_fkey" FOREIGN KEY ("agendamentoId") REFERENCES "agendamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

