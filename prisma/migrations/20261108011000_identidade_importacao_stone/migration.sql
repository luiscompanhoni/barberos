ALTER TABLE "movimentos_externos" ADD COLUMN "identidadeCanonica" TEXT;
CREATE UNIQUE INDEX "movimentos_externos_fonte_identidadeCanonica_key"
  ON "movimentos_externos"("fonte", "identidadeCanonica");
