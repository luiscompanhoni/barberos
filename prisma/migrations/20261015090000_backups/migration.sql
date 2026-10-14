-- Registro dos backups (gravado pelo container de backup) para o painel mostrar o ultimo e se foi restaurado.
-- CreateTable
CREATE TABLE "backups" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "arquivo" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "restaurado" BOOLEAN NOT NULL,
    "conferencia" TEXT,
    "foraDoServidor" BOOLEAN NOT NULL,
    "erro" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backups_criadoEm_idx" ON "backups"("criadoEm");

