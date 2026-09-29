-- CreateEnum
CREATE TYPE "EstadoConversa" AS ENUM ('BOT', 'HUMANO');

-- CreateEnum
CREATE TYPE "AutorMensagem" AS ENUM ('CLIENTE', 'BOT', 'EQUIPE', 'SISTEMA');

-- AlterTable
ALTER TABLE "configuracao" ADD COLUMN     "botAtivo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "endereco" TEXT,
ADD COLUMN     "maxAgendamentosCliente" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "prazoCancelamentoMin" INTEGER NOT NULL DEFAULT 120;

-- CreateTable
CREATE TABLE "conversas" (
    "id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "nomePerfil" TEXT,
    "clienteId" TEXT,
    "estado" "EstadoConversa" NOT NULL DEFAULT 'BOT',
    "ultimaEntradaEm" TIMESTAMPTZ(3),
    "naoLidas" INTEGER NOT NULL DEFAULT 0,
    "sessaoInicioEm" TIMESTAMPTZ(3),
    "sessao" JSONB,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "autor" "AutorMensagem" NOT NULL,
    "texto" TEXT NOT NULL,
    "wamid" TEXT,
    "erro" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversas_telefone_key" ON "conversas"("telefone");

-- CreateIndex
CREATE UNIQUE INDEX "conversas_clienteId_key" ON "conversas"("clienteId");

-- CreateIndex
CREATE INDEX "conversas_atualizadoEm_idx" ON "conversas"("atualizadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "mensagens_wamid_key" ON "mensagens"("wamid");

-- CreateIndex
CREATE INDEX "mensagens_conversaId_criadoEm_idx" ON "mensagens"("conversaId", "criadoEm");

-- AddForeignKey
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
