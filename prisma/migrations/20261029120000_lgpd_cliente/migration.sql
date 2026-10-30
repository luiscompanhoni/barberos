-- LGPD: aceite dos termos/politica (versao e data) e exclusao da conta pelo proprio cliente.
ALTER TABLE "clientes" ADD COLUMN "termosVersao" TEXT,
ADD COLUMN "termosAceitosEm" TIMESTAMPTZ(3),
ADD COLUMN "excluidoEm" TIMESTAMPTZ(3);
