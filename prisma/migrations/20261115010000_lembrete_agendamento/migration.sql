CREATE TABLE "lembretes_agendamento" (
  "clienteId" TEXT NOT NULL,
  "consentiuEm" TIMESTAMPTZ(3) NOT NULL,
  "ultimaAcaoEm" TIMESTAMPTZ(3) NOT NULL,
  "canceladoEm" TIMESTAMPTZ(3),
  "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "lembretes_agendamento_pkey" PRIMARY KEY ("clienteId")
);

CREATE INDEX "lembretes_agendamento_ultimaAcaoEm_idx" ON "lembretes_agendamento"("ultimaAcaoEm");

ALTER TABLE "lembretes_agendamento" ADD CONSTRAINT "lembretes_agendamento_clienteId_fkey"
  FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
