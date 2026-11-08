BEGIN;
-- Filhos SITE e adicionais antigos continuam cobertos pelo comportamento histórico.
ALTER TABLE "agendamentos" ADD COLUMN "ocupaAgenda" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "agendamentos" DROP CONSTRAINT "agendamentos_sem_sobreposicao";
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_sem_sobreposicao"
  EXCLUDE USING gist ("barbeiroId" WITH =, tstzrange("inicio", "fim", '[)') WITH &&)
  WHERE ("status" NOT IN ('CANCELADO', 'FALTOU') AND ("adicionalDeId" IS NULL OR "ocupaAgenda" = true));
ALTER TABLE "agendamentos" DROP CONSTRAINT "agendamentos_cadeira_sem_sobreposicao";
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_cadeira_sem_sobreposicao"
  EXCLUDE USING gist ("cadeiraId" WITH =, tstzrange("inicio", "fim", '[)') WITH &&)
  WHERE ("status" NOT IN ('CANCELADO', 'FALTOU') AND ("adicionalDeId" IS NULL OR "ocupaAgenda" = true) AND "cadeiraId" IS NOT NULL);
COMMIT;
