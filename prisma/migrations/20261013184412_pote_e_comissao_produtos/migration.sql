-- CreateTable
CREATE TABLE "pote_config" (
    "id" TEXT NOT NULL DEFAULT 'pote',
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "percentualBps" INTEGER NOT NULL DEFAULT 3500,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pote_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pote_fichas" (
    "servicoId" TEXT NOT NULL,
    "fichas" INTEGER NOT NULL,

    CONSTRAINT "pote_fichas_pkey" PRIMARY KEY ("servicoId")
);

-- CreateTable
CREATE TABLE "pote_barbeiros" (
    "barbeiroId" TEXT NOT NULL,
    "adicionalBps" INTEGER NOT NULL DEFAULT 0,
    "diferenciadaBps" INTEGER,

    CONSTRAINT "pote_barbeiros_pkey" PRIMARY KEY ("barbeiroId")
);

-- CreateTable
CREATE TABLE "comissao_produto_faixas" (
    "id" TEXT NOT NULL,
    "categoria" "CategoriaProduto" NOT NULL,
    "minimoCentavos" INTEGER NOT NULL,
    "percentualBps" INTEGER NOT NULL,

    CONSTRAINT "comissao_produto_faixas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comissao_produto_faixas_categoria_minimoCentavos_key" ON "comissao_produto_faixas"("categoria", "minimoCentavos");

-- AddForeignKey
ALTER TABLE "pote_fichas" ADD CONSTRAINT "pote_fichas_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "servicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pote_barbeiros" ADD CONSTRAINT "pote_barbeiros_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "barbeiros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

