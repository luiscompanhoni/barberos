-- Campanhas por segmento, liberadas em lotes com limite diario de envio.
-- CreateEnum
CREATE TYPE "StatusCampanha" AS ENUM ('ATIVA', 'PAUSADA', 'ENCERRADA');

-- CreateEnum
CREATE TYPE "StatusEnvioCampanha" AS ENUM ('FILA', 'ENVIADO', 'FALHOU', 'PULADO');

-- CreateTable
CREATE TABLE "campanhas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "segmentos" TEXT[],
    "mensagem" TEXT NOT NULL,
    "limiteDiario" INTEGER NOT NULL,
    "taxaRespostaBps" INTEGER NOT NULL DEFAULT 2000,
    "status" "StatusCampanha" NOT NULL DEFAULT 'ATIVA',
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campanhas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanha_envios" (
    "id" TEXT NOT NULL,
    "campanhaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "lote" INTEGER NOT NULL,
    "status" "StatusEnvioCampanha" NOT NULL DEFAULT 'FILA',
    "liberadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" TIMESTAMPTZ(3),
    "erro" TEXT,

    CONSTRAINT "campanha_envios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campanha_envios_status_campanhaId_idx" ON "campanha_envios"("status", "campanhaId");

-- CreateIndex
CREATE UNIQUE INDEX "campanha_envios_campanhaId_clienteId_key" ON "campanha_envios"("campanhaId", "clienteId");

-- AddForeignKey
ALTER TABLE "campanha_envios" ADD CONSTRAINT "campanha_envios_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "campanhas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanha_envios" ADD CONSTRAINT "campanha_envios_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

