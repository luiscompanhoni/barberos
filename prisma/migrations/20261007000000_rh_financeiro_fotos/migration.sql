-- CreateEnum
CREATE TYPE "AvaliacaoTarefa" AS ENUM ('VALIDADO', 'RE');

-- CreateEnum
CREATE TYPE "TipoComissao" AS ENUM ('PERCENTUAL', 'FIXO');

-- CreateEnum
CREATE TYPE "TipoLancamentoFolha" AS ENUM ('ADICIONAL', 'BONUS', 'VALE', 'DESCONTO');

-- CreateEnum
CREATE TYPE "StatusFolha" AS ENUM ('FECHADA', 'PAGA');

-- CreateEnum
CREATE TYPE "StatusDespesa" AS ENUM ('PENDENTE', 'PAGA');

-- AlterTable
ALTER TABLE "barbeiros" ADD COLUMN     "fotoDados" BYTEA,
ADD COLUMN     "fotoTipo" TEXT,
ADD COLUMN     "fotoVersao" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "checklist_config" ADD COLUMN     "nivelLegend" INTEGER NOT NULL DEFAULT 1500,
ADD COLUMN     "nivelPlatina" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "pontosRe" INTEGER NOT NULL DEFAULT 20;

-- AlterTable
ALTER TABLE "checklist_itens" ADD COLUMN     "avaliacao" "AvaliacaoTarefa",
ADD COLUMN     "avaliadoEm" TIMESTAMPTZ(3),
ADD COLUMN     "avaliadoPor" TEXT,
ADD COLUMN     "motivoRe" TEXT,
ADD COLUMN     "pontos" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "checklist_pessoas" ADD COLUMN     "admissao" DATE,
ADD COLUMN     "barbeiroId" TEXT,
ADD COLUMN     "cargo" TEXT,
ADD COLUMN     "chavePix" TEXT,
ADD COLUMN     "salarioCentavos" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "checklist_tarefas" ADD COLUMN     "pontos" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "checklist_pontos" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "itemId" TEXT,
    "pontos" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "porNome" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_pontos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comissoes_servico" (
    "id" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "barbeiroId" TEXT,
    "avulsoTipo" "TipoComissao" NOT NULL DEFAULT 'PERCENTUAL',
    "avulsoValor" INTEGER NOT NULL DEFAULT 0,
    "planoTipo" "TipoComissao" NOT NULL DEFAULT 'FIXO',
    "planoValor" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "comissoes_servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folha_lancamentos" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "tipo" "TipoLancamentoFolha" NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "movimentoCaixaId" TEXT,
    "porId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folha_lancamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folha_pagamentos" (
    "id" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "salarioCentavos" INTEGER NOT NULL,
    "comissaoCentavos" INTEGER NOT NULL,
    "adicionaisCentavos" INTEGER NOT NULL,
    "descontosCentavos" INTEGER NOT NULL,
    "liquidoCentavos" INTEGER NOT NULL,
    "detalhe" JSONB,
    "status" "StatusFolha" NOT NULL DEFAULT 'FECHADA',
    "pagoEm" TIMESTAMPTZ(3),
    "despesaId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folha_pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "despesas" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "vencimento" DATE NOT NULL,
    "status" "StatusDespesa" NOT NULL DEFAULT 'PENDENTE',
    "pagoEm" TIMESTAMPTZ(3),
    "formaPagamento" TEXT,
    "fornecedor" TEXT,
    "observacao" TEXT,
    "recorrente" BOOLEAN NOT NULL DEFAULT false,
    "movimentoCaixaId" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "despesas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checklist_pontos_itemId_key" ON "checklist_pontos"("itemId");

-- CreateIndex
CREATE INDEX "checklist_pontos_pessoaId_criadoEm_idx" ON "checklist_pontos"("pessoaId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "comissoes_servico_servicoId_barbeiroId_key" ON "comissoes_servico"("servicoId", "barbeiroId");

-- CreateIndex
CREATE UNIQUE INDEX "folha_lancamentos_movimentoCaixaId_key" ON "folha_lancamentos"("movimentoCaixaId");

-- CreateIndex
CREATE INDEX "folha_lancamentos_competencia_pessoaId_idx" ON "folha_lancamentos"("competencia", "pessoaId");

-- CreateIndex
CREATE UNIQUE INDEX "folha_pagamentos_despesaId_key" ON "folha_pagamentos"("despesaId");

-- CreateIndex
CREATE UNIQUE INDEX "folha_pagamentos_competencia_pessoaId_key" ON "folha_pagamentos"("competencia", "pessoaId");

-- CreateIndex
CREATE UNIQUE INDEX "despesas_movimentoCaixaId_key" ON "despesas"("movimentoCaixaId");

-- CreateIndex
CREATE INDEX "despesas_status_vencimento_idx" ON "despesas"("status", "vencimento");

-- CreateIndex
CREATE INDEX "despesas_pagoEm_idx" ON "despesas"("pagoEm");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_pessoas_barbeiroId_key" ON "checklist_pessoas"("barbeiroId");

-- AddForeignKey
ALTER TABLE "checklist_pessoas" ADD CONSTRAINT "checklist_pessoas_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "barbeiros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_pontos" ADD CONSTRAINT "checklist_pontos_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "checklist_pessoas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_pontos" ADD CONSTRAINT "checklist_pontos_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "checklist_itens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comissoes_servico" ADD CONSTRAINT "comissoes_servico_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "servicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folha_lancamentos" ADD CONSTRAINT "folha_lancamentos_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "checklist_pessoas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folha_pagamentos" ADD CONSTRAINT "folha_pagamentos_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "checklist_pessoas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

