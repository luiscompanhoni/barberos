-- CreateEnum
CREATE TYPE "StatusCaixa" AS ENUM ('ABERTO', 'FECHADO');

-- CreateEnum
CREATE TYPE "TipoMovimentoCaixa" AS ENUM ('SANGRIA', 'SUPRIMENTO');

-- CreateEnum
CREATE TYPE "StatusConciliacao" AS ENUM ('CONFERIDO', 'DIVERGENTE');

-- CreateEnum
CREATE TYPE "FuncaoChecklist" AS ENUM ('DIARISTA', 'BARBEIRO', 'GERENTE');

-- CreateTable
CREATE TABLE "caixas" (
    "id" TEXT NOT NULL,
    "status" "StatusCaixa" NOT NULL DEFAULT 'ABERTO',
    "fundoCentavos" INTEGER NOT NULL,
    "abertoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "abertoPorId" TEXT,
    "fechadoEm" TIMESTAMPTZ(3),
    "fechadoPorId" TEXT,
    "contadoCentavos" INTEGER,
    "esperadoCentavos" INTEGER,
    "diferencaCentavos" INTEGER,
    "resumo" JSONB,
    "observacao" TEXT,

    CONSTRAINT "caixas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentos_caixa" (
    "id" TEXT NOT NULL,
    "caixaId" TEXT NOT NULL,
    "tipo" "TipoMovimentoCaixa" NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_caixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxas_recebimento" (
    "forma" TEXT NOT NULL,
    "taxaBps" INTEGER NOT NULL DEFAULT 0,
    "prazoDias" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "taxas_recebimento_pkey" PRIMARY KEY ("forma")
);

-- CreateTable
CREATE TABLE "conciliacoes" (
    "id" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "forma" TEXT NOT NULL,
    "brutoCentavos" INTEGER NOT NULL,
    "liquidoCentavos" INTEGER NOT NULL,
    "recebidoCentavos" INTEGER NOT NULL,
    "status" "StatusConciliacao" NOT NULL,
    "observacao" TEXT,
    "conferidoPorId" TEXT,
    "conferidoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conciliacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "horaEnvio" TEXT NOT NULL DEFAULT '08:00',
    "horaResumo" TEXT NOT NULL DEFAULT '19:00',

    CONSTRAINT "checklist_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_pessoas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "funcao" "FuncaoChecklist" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "token" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_pessoas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_tarefas" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "funcao" "FuncaoChecklist" NOT NULL,
    "diasSemana" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "horario" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_tarefas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_itens" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "tarefaId" TEXT,
    "data" DATE NOT NULL,
    "titulo" TEXT NOT NULL,
    "horario" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "feito" BOOLEAN NOT NULL DEFAULT false,
    "feitoEm" TIMESTAMPTZ(3),
    "feitoPor" TEXT,

    CONSTRAINT "checklist_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_envios" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "erro" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_envios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "caixas_status_idx" ON "caixas"("status");

-- CreateIndex
CREATE INDEX "caixas_abertoEm_idx" ON "caixas"("abertoEm");

-- CreateIndex
CREATE INDEX "movimentos_caixa_caixaId_idx" ON "movimentos_caixa"("caixaId");

-- CreateIndex
CREATE UNIQUE INDEX "conciliacoes_data_forma_key" ON "conciliacoes"("data", "forma");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_pessoas_token_key" ON "checklist_pessoas"("token");

-- CreateIndex
CREATE INDEX "checklist_itens_data_idx" ON "checklist_itens"("data");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_itens_pessoaId_tarefaId_data_key" ON "checklist_itens"("pessoaId", "tarefaId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_envios_chave_key" ON "checklist_envios"("chave");

-- AddForeignKey
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT "movimentos_caixa_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "caixas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_itens" ADD CONSTRAINT "checklist_itens_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "checklist_pessoas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_itens" ADD CONSTRAINT "checklist_itens_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "checklist_tarefas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

