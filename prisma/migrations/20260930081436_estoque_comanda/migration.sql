-- CreateEnum
CREATE TYPE "CategoriaProduto" AS ENUM ('BAR', 'LOJA', 'USO_INTERNO');

-- CreateEnum
CREATE TYPE "TipoMovimento" AS ENUM ('ENTRADA', 'VENDA', 'CONSUMO', 'AJUSTE', 'PERDA', 'ESTORNO');

-- CreateEnum
CREATE TYPE "StatusComanda" AS ENUM ('ABERTA', 'FECHADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "FormaRecebimento" AS ENUM ('DINHEIRO', 'PIX', 'CREDITO', 'DEBITO');

-- CreateEnum
CREATE TYPE "StatusPagamentoComanda" AS ENUM ('AGUARDANDO', 'PAGO', 'CANCELADO');

-- CreateTable
CREATE TABLE "produtos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" "CategoriaProduto" NOT NULL,
    "precoCentavos" INTEGER NOT NULL DEFAULT 0,
    "custoCentavos" INTEGER NOT NULL DEFAULT 0,
    "estoque" INTEGER NOT NULL DEFAULT 0,
    "estoqueMinimo" INTEGER NOT NULL DEFAULT 0,
    "unidade" TEXT NOT NULL DEFAULT 'un',
    "codigoBarras" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentos_estoque" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "tipo" "TipoMovimento" NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "saldoApos" INTEGER NOT NULL,
    "custoUnitarioCentavos" INTEGER,
    "comandaId" TEXT,
    "usuarioId" TEXT,
    "motivo" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comandas" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "clienteId" TEXT,
    "nomeAvulso" TEXT,
    "status" "StatusComanda" NOT NULL DEFAULT 'ABERTA',
    "descontoCentavos" INTEGER NOT NULL DEFAULT 0,
    "observacao" TEXT,
    "abertaPorId" TEXT,
    "abertaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechadaEm" TIMESTAMPTZ(3),

    CONSTRAINT "comandas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_comanda" (
    "id" TEXT NOT NULL,
    "comandaId" TEXT NOT NULL,
    "produtoId" TEXT,
    "agendamentoId" TEXT,
    "descricao" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "precoUnitCentavos" INTEGER NOT NULL,
    "barbeiroId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itens_comanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamentos_comanda" (
    "id" TEXT NOT NULL,
    "comandaId" TEXT NOT NULL,
    "forma" "FormaRecebimento" NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "status" "StatusPagamentoComanda" NOT NULL,
    "gatewayPedidoId" TEXT,
    "nsu" TEXT,
    "bandeira" TEXT,
    "registradoPorId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pagoEm" TIMESTAMPTZ(3),

    CONSTRAINT "pagamentos_comanda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "produtos_codigoBarras_key" ON "produtos"("codigoBarras");

-- CreateIndex
CREATE INDEX "movimentos_estoque_produtoId_criadoEm_idx" ON "movimentos_estoque"("produtoId", "criadoEm");

-- CreateIndex
CREATE INDEX "movimentos_estoque_comandaId_idx" ON "movimentos_estoque"("comandaId");

-- CreateIndex
CREATE UNIQUE INDEX "comandas_numero_key" ON "comandas"("numero");

-- CreateIndex
CREATE INDEX "comandas_status_abertaEm_idx" ON "comandas"("status", "abertaEm");

-- CreateIndex
CREATE UNIQUE INDEX "itens_comanda_agendamentoId_key" ON "itens_comanda"("agendamentoId");

-- CreateIndex
CREATE INDEX "itens_comanda_comandaId_idx" ON "itens_comanda"("comandaId");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_comanda_gatewayPedidoId_key" ON "pagamentos_comanda"("gatewayPedidoId");

-- CreateIndex
CREATE INDEX "pagamentos_comanda_comandaId_idx" ON "pagamentos_comanda"("comandaId");

-- AddForeignKey
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_comanda" ADD CONSTRAINT "itens_comanda_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "comandas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_comanda" ADD CONSTRAINT "itens_comanda_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_comanda" ADD CONSTRAINT "itens_comanda_agendamentoId_fkey" FOREIGN KEY ("agendamentoId") REFERENCES "agendamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos_comanda" ADD CONSTRAINT "pagamentos_comanda_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "comandas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

