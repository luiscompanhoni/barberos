-- CreateEnum
CREATE TYPE "TipoPremioRoleta" AS ENUM ('CREDITO', 'BRINDE', 'NADA');

-- CreateEnum
CREATE TYPE "StatusGiro" AS ENUM ('A_RETIRAR', 'CONCLUIDO', 'EXPIRADO');

-- CreateTable
CREATE TABLE "roleta_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "ativa" BOOLEAN NOT NULL DEFAULT false,
    "girosPorAtendimento" INTEGER NOT NULL DEFAULT 1,
    "giroGratisDias" INTEGER NOT NULL DEFAULT 0,
    "bonusAssinantePct" INTEGER NOT NULL DEFAULT 10,
    "validadeDias" INTEGER NOT NULL DEFAULT 30,
    "inicioEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roleta_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roleta_premios" (
    "id" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "tipo" "TipoPremioRoleta" NOT NULL,
    "valorCentavos" INTEGER NOT NULL DEFAULT 0,
    "peso" INTEGER NOT NULL,
    "cor" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "limiteMensal" INTEGER,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roleta_premios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roleta_giros" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "premioId" TEXT,
    "rotulo" TEXT NOT NULL,
    "tipo" "TipoPremioRoleta" NOT NULL,
    "valorCentavos" INTEGER NOT NULL DEFAULT 0,
    "multiplicador" INTEGER NOT NULL DEFAULT 100,
    "origem" TEXT NOT NULL,
    "status" "StatusGiro" NOT NULL,
    "beneficioId" TEXT,
    "expiraEm" TIMESTAMPTZ(3),
    "entregueEm" TIMESTAMPTZ(3),
    "entreguePorId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roleta_giros_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roleta_giros_clienteId_criadoEm_idx" ON "roleta_giros"("clienteId", "criadoEm");

-- CreateIndex
CREATE INDEX "roleta_giros_status_idx" ON "roleta_giros"("status");

-- AddForeignKey
ALTER TABLE "roleta_giros" ADD CONSTRAINT "roleta_giros_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roleta_giros" ADD CONSTRAINT "roleta_giros_premioId_fkey" FOREIGN KEY ("premioId") REFERENCES "roleta_premios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

