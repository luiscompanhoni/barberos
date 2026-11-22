CREATE TABLE "oferta_dezembro_adesoes" (
    "assinaturaId" TEXT NOT NULL,
    "chaveIdempotencia" TEXT NOT NULL,
    "termosVersao" TEXT NOT NULL,
    "precoCentavos" INTEGER NOT NULL,
    "limiteUsos" INTEGER NOT NULL,
    "aceitaEm" TIMESTAMPTZ(3) NOT NULL,
    "ip" TEXT,
    "agenteUsuario" TEXT,
    "cancelamentoSolicitadoEm" TIMESTAMPTZ(3),
    "multaSimuladaCentavos" INTEGER,

    CONSTRAINT "oferta_dezembro_adesoes_pkey" PRIMARY KEY ("assinaturaId"),
    CONSTRAINT "oferta_dezembro_adesoes_preco_positivo" CHECK ("precoCentavos" > 0),
    CONSTRAINT "oferta_dezembro_adesoes_limite_positivo" CHECK ("limiteUsos" > 0),
    CONSTRAINT "oferta_dezembro_adesoes_cancelamento_valido" CHECK (
        ("cancelamentoSolicitadoEm" IS NULL AND "multaSimuladaCentavos" IS NULL) OR
        ("cancelamentoSolicitadoEm" IS NOT NULL AND "multaSimuladaCentavos" IS NOT NULL
            AND "multaSimuladaCentavos" BETWEEN 0 AND "precoCentavos"
            AND "cancelamentoSolicitadoEm" >= "aceitaEm")
    )
);

CREATE UNIQUE INDEX "oferta_dezembro_adesoes_chaveIdempotencia_key" ON "oferta_dezembro_adesoes"("chaveIdempotencia");

ALTER TABLE "oferta_dezembro_adesoes" ADD CONSTRAINT "oferta_dezembro_adesoes_assinaturaId_fkey"
    FOREIGN KEY ("assinaturaId") REFERENCES "assinaturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
