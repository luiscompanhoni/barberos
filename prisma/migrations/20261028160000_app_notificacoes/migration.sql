-- CreateTable
CREATE TABLE "notificacao_preferencias" (
    "usuarioId" TEXT NOT NULL,
    "agenda" BOOLEAN NOT NULL DEFAULT true,
    "avaliacoes" BOOLEAN NOT NULL DEFAULT true,
    "recompra" BOOLEAN NOT NULL DEFAULT false,
    "equipe" BOOLEAN NOT NULL DEFAULT true,
    "ultimoProcessamentoEm" TIMESTAMPTZ(3),
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notificacao_preferencias_pkey" PRIMARY KEY ("usuarioId")
);

-- CreateTable
CREATE TABLE "notificacoes" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "lidaEm" TIMESTAMPTZ(3),

    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_inscricoes" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "endpointHash" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "vapidHash" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "nome" TEXT NOT NULL DEFAULT 'Navegador',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,
    "ultimoEnvioEm" TIMESTAMPTZ(3),
    "codigoErro" TEXT,

    CONSTRAINT "push_inscricoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_entregas" (
    "id" TEXT NOT NULL,
    "notificacaoId" TEXT NOT NULL,
    "inscricaoId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,
    "tentadoEm" TIMESTAMPTZ(3),
    "enviadoEm" TIMESTAMPTZ(3),
    "proximaTentativaEm" TIMESTAMPTZ(3),
    "codigoErro" TEXT,

    CONSTRAINT "push_entregas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notificacoes_usuarioId_criadoEm_idx" ON "notificacoes"("usuarioId", "criadoEm");

-- CreateIndex
CREATE INDEX "notificacoes_expiraEm_idx" ON "notificacoes"("expiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "notificacoes_usuarioId_chave_key" ON "notificacoes"("usuarioId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "push_inscricoes_endpointHash_key" ON "push_inscricoes"("endpointHash");

-- CreateIndex
CREATE UNIQUE INDEX "push_inscricoes_tokenHash_key" ON "push_inscricoes"("tokenHash");

-- CreateIndex
CREATE INDEX "push_inscricoes_usuarioId_ativo_idx" ON "push_inscricoes"("usuarioId", "ativo");

-- CreateIndex
CREATE INDEX "push_entregas_estado_proximaTentativaEm_idx" ON "push_entregas"("estado", "proximaTentativaEm");

-- CreateIndex
CREATE UNIQUE INDEX "push_entregas_notificacaoId_inscricaoId_key" ON "push_entregas"("notificacaoId", "inscricaoId");

-- AddForeignKey
ALTER TABLE "notificacao_preferencias" ADD CONSTRAINT "notificacao_preferencias_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_inscricoes" ADD CONSTRAINT "push_inscricoes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_entregas" ADD CONSTRAINT "push_entregas_notificacaoId_fkey" FOREIGN KEY ("notificacaoId") REFERENCES "notificacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_entregas" ADD CONSTRAINT "push_entregas_inscricaoId_fkey" FOREIGN KEY ("inscricaoId") REFERENCES "push_inscricoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_categoria_valida"
  CHECK ("categoria" IN ('AGENDA', 'AVALIACAO', 'RECOMPRA', 'EQUIPE', 'TESTE'));
ALTER TABLE "push_entregas" ADD CONSTRAINT "push_entregas_estado_valido"
  CHECK ("estado" IN ('PENDENTE', 'ENVIANDO', 'ENVIADO', 'SIMULADO', 'INCERTO', 'FALHOU', 'CANCELADO'));
