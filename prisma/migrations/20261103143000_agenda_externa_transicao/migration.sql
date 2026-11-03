-- Opt-in: preserva o comportamento atual até o dono ativar o modo de transição.
ALTER TABLE "configuracao" ADD COLUMN "agendaExternaAtiva" BOOLEAN NOT NULL DEFAULT false;
