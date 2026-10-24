-- CreateTable
CREATE TABLE "recrutamento_vagas" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "cidade" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "privacidade" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT false,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recrutamento_vagas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recrutamento_candidatos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "cidade" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recrutamento_candidatos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recrutamento_candidaturas" (
    "id" TEXT NOT NULL,
    "envioId" TEXT NOT NULL,
    "conteudoHash" TEXT NOT NULL,
    "vagaId" TEXT NOT NULL,
    "candidatoId" TEXT NOT NULL,
    "experienciaMeses" INTEGER NOT NULL,
    "servicos" TEXT[],
    "disponibilidade" TEXT NOT NULL,
    "portfolio" TEXT NOT NULL,
    "instagram" TEXT NOT NULL,
    "futurasOportunidades" BOOLEAN NOT NULL,
    "formularioVersao" TEXT NOT NULL,
    "avisoPrivacidade" TEXT NOT NULL,
    "origem" JSONB NOT NULL,
    "etapa" TEXT NOT NULL DEFAULT 'NOVO',
    "versao" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recrutamento_candidaturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recrutamento_historico" (
    "id" TEXT NOT NULL,
    "candidaturaId" TEXT NOT NULL,
    "etapa" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recrutamento_historico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recrutamento_candidaturas_envioId_key" ON "recrutamento_candidaturas"("envioId");

-- CreateIndex
CREATE INDEX "recrutamento_candidaturas_vagaId_etapa_criadoEm_idx" ON "recrutamento_candidaturas"("vagaId", "etapa", "criadoEm");

-- CreateIndex
CREATE INDEX "recrutamento_historico_candidaturaId_criadoEm_idx" ON "recrutamento_historico"("candidaturaId", "criadoEm");

-- AddForeignKey
ALTER TABLE "recrutamento_candidaturas" ADD CONSTRAINT "recrutamento_candidaturas_vagaId_fkey" FOREIGN KEY ("vagaId") REFERENCES "recrutamento_vagas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recrutamento_candidaturas" ADD CONSTRAINT "recrutamento_candidaturas_candidatoId_fkey" FOREIGN KEY ("candidatoId") REFERENCES "recrutamento_candidatos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recrutamento_historico" ADD CONSTRAINT "recrutamento_historico_candidaturaId_fkey" FOREIGN KEY ("candidaturaId") REFERENCES "recrutamento_candidaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
