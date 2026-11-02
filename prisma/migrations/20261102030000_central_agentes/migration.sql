-- CreateEnum
CREATE TYPE "EstadoAgenteExecucao" AS ENUM ('PENDENTE', 'EXECUTANDO', 'AGUARDA_APROVACAO', 'CONCLUIDO', 'BLOQUEADO', 'FALHOU', 'CANCELADO');

-- CreateTable
CREATE TABLE "agente_configuracao" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "pausada" BOOLEAN NOT NULL DEFAULT false,
    "limiteDiario" INTEGER NOT NULL DEFAULT 20,
    "revisao" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agente_configuracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agente_execucoes" (
    "id" TEXT NOT NULL,
    "agenteId" TEXT NOT NULL,
    "tarefa" VARCHAR(6000) NOT NULL,
    "chave" VARCHAR(200) NOT NULL,
    "entradaHash" TEXT NOT NULL,
    "estado" "EstadoAgenteExecucao" NOT NULL DEFAULT 'PENDENTE',
    "revisao" INTEGER NOT NULL DEFAULT 0,
    "solicitanteId" TEXT NOT NULL,
    "aprovadoPorId" TEXT,
    "aprovadoEm" TIMESTAMPTZ(3),
    "origemId" TEXT,
    "profundidade" INTEGER NOT NULL DEFAULT 0,
    "rotinaId" TEXT,
    "contexto" JSONB,
    "resultado" JSONB,
    "resultadoHash" TEXT,
    "erro" TEXT,
    "lease" TEXT,
    "leaseAte" TIMESTAMPTZ(3),
    "iniciadoEm" TIMESTAMPTZ(3),
    "finalizadoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelo" TEXT,
    "tokensEntrada" INTEGER NOT NULL DEFAULT 0,
    "tokensSaida" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agente_execucoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agente_rotinas" (
    "id" TEXT NOT NULL,
    "chave" VARCHAR(200) NOT NULL,
    "entradaHash" TEXT NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "agenteId" TEXT NOT NULL,
    "tarefa" VARCHAR(6000) NOT NULL,
    "cadaMinutos" INTEGER NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT false,
    "revisao" INTEGER NOT NULL DEFAULT 0,
    "proximaEm" TIMESTAMPTZ(3) NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,

    CONSTRAINT "agente_rotinas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agente_execucoes_chave_key" ON "agente_execucoes"("chave");

-- CreateIndex
CREATE INDEX "agente_execucoes_estado_criadoEm_idx" ON "agente_execucoes"("estado", "criadoEm");

-- CreateIndex
CREATE INDEX "agente_execucoes_solicitanteId_criadoEm_idx" ON "agente_execucoes"("solicitanteId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "agente_rotinas_chave_key" ON "agente_rotinas"("chave");

-- CreateIndex
CREATE INDEX "agente_rotinas_ativa_proximaEm_idx" ON "agente_rotinas"("ativa", "proximaEm");

-- AddForeignKey
ALTER TABLE "agente_execucoes" ADD CONSTRAINT "agente_execucoes_solicitanteId_fkey" FOREIGN KEY ("solicitanteId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agente_execucoes" ADD CONSTRAINT "agente_execucoes_aprovadoPorId_fkey" FOREIGN KEY ("aprovadoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agente_execucoes" ADD CONSTRAINT "agente_execucoes_origemId_fkey" FOREIGN KEY ("origemId") REFERENCES "agente_execucoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agente_execucoes" ADD CONSTRAINT "agente_execucoes_rotinaId_fkey" FOREIGN KEY ("rotinaId") REFERENCES "agente_rotinas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agente_rotinas" ADD CONSTRAINT "agente_rotinas_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


INSERT INTO "agente_configuracao" ("id", "pausada", "limiteDiario", "revisao") VALUES (1, false, 20, 0);

ALTER TABLE "agente_configuracao" ADD CONSTRAINT "agentes_config_limites" CHECK ("id" = 1 AND "limiteDiario" BETWEEN 1 AND 200 AND "revisao" >= 0);
ALTER TABLE "agente_rotinas" ADD CONSTRAINT "agentes_rotina_intervalo" CHECK ("cadaMinutos" BETWEEN 60 AND 43200 AND "revisao" >= 0);
ALTER TABLE "agente_execucoes" ADD CONSTRAINT "agentes_execucao_limites" CHECK ("profundidade" BETWEEN 0 AND 4 AND "tokensEntrada" >= 0 AND "tokensSaida" >= 0 AND "revisao" >= 0);
