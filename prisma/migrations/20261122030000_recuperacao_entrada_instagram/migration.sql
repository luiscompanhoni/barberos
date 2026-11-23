BEGIN;

ALTER TABLE "mensagens" ADD COLUMN "instagramPendenteEm" TIMESTAMPTZ(3);

CREATE INDEX "mensagens_instagram_pendente_idx"
ON "mensagens"("instagramPendenteEm")
WHERE "instagramPendenteEm" IS NOT NULL;

COMMIT;
