-- Papel Gerente (administrador) e matriz de permissoes por acao.
ALTER TYPE "Papel" ADD VALUE 'GERENTE' BEFORE 'RECEPCAO';

CREATE TABLE "permissoes_papel" (
    "papel" "Papel" NOT NULL,
    "permissao" TEXT NOT NULL,
    "permitido" BOOLEAN NOT NULL,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "permissoes_papel_pkey" PRIMARY KEY ("papel","permissao")
);
