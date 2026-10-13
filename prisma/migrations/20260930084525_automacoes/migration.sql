-- CreateEnum
CREATE TYPE "TipoAutomacao" AS ENUM ('LEMBRETE_VESPERA', 'LEMBRETE_PROXIMO', 'POS_FALTA', 'POS_ATENDIMENTO', 'REATIVACAO');

-- AlterTable
ALTER TABLE "barbeiros" ADD COLUMN     "tokenCalendario" TEXT;

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "aceitaMensagens" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ultimaReativacaoEm" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "configuracao" ADD COLUMN     "avisoFalta" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "janelaFaltasDias" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "lembreteHorasAntes" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "lembreteMinutosAntes" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "limiteFaltas" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "linkAvaliacao" TEXT,
ADD COLUMN     "posAtendimento" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reativacaoDias" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "automacoes_enviadas" (
    "id" TEXT NOT NULL,
    "tipo" "TipoAutomacao" NOT NULL,
    "agendamentoId" TEXT,
    "clienteId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "erro" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automacoes_enviadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automacoes_enviadas_criadoEm_idx" ON "automacoes_enviadas"("criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "automacoes_enviadas_tipo_chave_key" ON "automacoes_enviadas"("tipo", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "barbeiros_tokenCalendario_key" ON "barbeiros"("tokenCalendario");

