-- CreateEnum
CREATE TYPE "EstadoEstudioVersao" AS ENUM ('FILA', 'PROCESSANDO', 'REVISAO', 'APROVADO', 'AJUSTES', 'FALHOU', 'CANCELADO');

-- CreateTable
CREATE TABLE "estudio_projetos" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "revisao" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "estudio_projetos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estudio_clipes" (
    "id" TEXT NOT NULL,
    "projetoId" TEXT NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "arquivo" TEXT,
    "uploadEm" TIMESTAMPTZ(3),
    "duracao" DOUBLE PRECISION NOT NULL,
    "inicio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fim" DOUBLE PRECISION NOT NULL,
    "texto" VARCHAR(100) NOT NULL DEFAULT '',
    "posicao" INTEGER NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estudio_clipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estudio_versoes" (
    "id" TEXT NOT NULL,
    "projetoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "revisao" INTEGER NOT NULL,
    "estado" "EstadoEstudioVersao" NOT NULL DEFAULT 'FILA',
    "snapshot" JSONB NOT NULL,
    "arquivo" TEXT,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT,
    "lease" TEXT,
    "leaseAte" TIMESTAMPTZ(3),
    "erro" TEXT,
    "comentario" VARCHAR(1000),
    "criadaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadaEm" TIMESTAMPTZ(3),
    "aprovadaEm" TIMESTAMPTZ(3),

    CONSTRAINT "estudio_versoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estudio_workers" (
    "id" TEXT NOT NULL,
    "vistoEm" TIMESTAMPTZ(3) NOT NULL,
    "versao" TEXT NOT NULL,

    CONSTRAINT "estudio_workers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "estudio_projetos_usuarioId_atualizadoEm_idx" ON "estudio_projetos"("usuarioId", "atualizadoEm");

-- CreateIndex
CREATE INDEX "estudio_clipes_projetoId_idx" ON "estudio_clipes"("projetoId");

-- CreateIndex
CREATE INDEX "estudio_versoes_estado_criadaEm_idx" ON "estudio_versoes"("estado", "criadaEm");

-- CreateIndex
CREATE UNIQUE INDEX "estudio_versoes_projetoId_numero_key" ON "estudio_versoes"("projetoId", "numero");

-- AddForeignKey
ALTER TABLE "estudio_projetos" ADD CONSTRAINT "estudio_projetos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estudio_clipes" ADD CONSTRAINT "estudio_clipes_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "estudio_projetos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estudio_versoes" ADD CONSTRAINT "estudio_versoes_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "estudio_projetos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
