-- Servico adicional na comanda: ligado ao atendimento principal e fora da regra de sobreposicao da agenda.
-- AlterTable
ALTER TABLE "agendamentos" ADD COLUMN     "adicionalDeId" TEXT;

-- CreateIndex
CREATE INDEX "agendamentos_adicionalDeId_idx" ON "agendamentos"("adicionalDeId");

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_adicionalDeId_fkey" FOREIGN KEY ("adicionalDeId") REFERENCES "agendamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- O adicional acontece junto do atendimento principal: nao disputa horario na agenda.
ALTER TABLE "agendamentos" DROP CONSTRAINT "agendamentos_sem_sobreposicao";
ALTER TABLE "agendamentos"
  ADD CONSTRAINT "agendamentos_sem_sobreposicao"
  EXCLUDE USING gist ("barbeiroId" WITH =, tstzrange("inicio", "fim", '[)') WITH &&)
  WHERE ("status" NOT IN ('CANCELADO', 'FALTOU') AND "adicionalDeId" IS NULL);
