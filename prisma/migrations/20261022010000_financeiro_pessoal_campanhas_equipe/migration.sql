CREATE TABLE "lancamentos_pessoais" (
  "id" TEXT NOT NULL, "usuarioId" TEXT NOT NULL, "tipo" TEXT NOT NULL,
  "descricao" TEXT NOT NULL, "categoria" TEXT NOT NULL, "valorCentavos" INTEGER NOT NULL,
  "data" DATE NOT NULL, "realizado" BOOLEAN NOT NULL DEFAULT true, "anulado" BOOLEAN NOT NULL DEFAULT false,
  "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lancamentos_pessoais_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lancamentos_pessoais_usuarioId_data_idx" ON "lancamentos_pessoais"("usuarioId", "data");
CREATE TABLE "campanhas_equipe" (
  "id" TEXT NOT NULL, "nome" TEXT NOT NULL, "inicio" TIMESTAMPTZ(3) NOT NULL, "fim" TIMESTAMPTZ(3) NOT NULL,
  "metaQuantidade" INTEGER NOT NULL, "metaCentavos" INTEGER NOT NULL, "premios" JSONB NOT NULL,
  "criadoPorId" TEXT NOT NULL, "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campanhas_equipe_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "bonus_equipe" (
  "id" TEXT NOT NULL, "campanhaId" TEXT NOT NULL, "barbeiroId" TEXT NOT NULL, "ciclo" INTEGER NOT NULL,
  "valorCentavos" INTEGER NOT NULL, "pagoEm" TIMESTAMPTZ(3), "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bonus_equipe_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bonus_equipe_campanhaId_barbeiroId_ciclo_key" ON "bonus_equipe"("campanhaId", "barbeiroId", "ciclo");
ALTER TABLE "bonus_equipe" ADD CONSTRAINT "bonus_equipe_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "campanhas_equipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
