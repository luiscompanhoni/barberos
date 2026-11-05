-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "endereco" TEXT,
ADD COLUMN     "fotoDados" BYTEA,
ADD COLUMN     "fotoTipo" TEXT,
ADD COLUMN     "fotoVersao" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "perfilCompletoEm" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "assinaturas" ADD COLUMN     "operacaoInicial" TEXT;

-- CreateTable
CREATE TABLE "identidades_sociais" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "provedor" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identidades_sociais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fluxos_sociais" (
    "id" TEXT NOT NULL,
    "navegadorHash" TEXT NOT NULL,
    "provedor" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "verificador" TEXT,
    "usuarioId" TEXT,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "consumidoEm" TIMESTAMPTZ(3),

    CONSTRAINT "fluxos_sociais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos_agendamento" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "barbeiroId" TEXT,
    "servicoIds" JSONB NOT NULL,
    "dataPreferida" TEXT NOT NULL,
    "horaPreferida" TEXT NOT NULL,
    "observacao" TEXT,
    "chave" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "agendamentoIds" JSONB,
    "decididoPorId" TEXT,
    "decididoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pedidos_agendamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alteracoes_plano_assinatura" (
    "id" TEXT NOT NULL,
    "assinaturaId" TEXT NOT NULL,
    "planoAnteriorId" TEXT NOT NULL,
    "planoDestinoId" TEXT NOT NULL,
    "precoAnteriorCentavos" INTEGER NOT NULL,
    "precoNovoCentavos" INTEGER NOT NULL,
    "efetivaEm" DATE NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'SOLICITADA',
    "origem" "OrigemAgendamento" NOT NULL,
    "usuarioId" TEXT,
    "condicoes" JSONB NOT NULL,
    "criadaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMPTZ(3) NOT NULL,
    "aplicadaEm" TIMESTAMPTZ(3),
    "comprovante" TEXT,

    CONSTRAINT "alteracoes_plano_assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identidades_sociais_provedor_subject_key" ON "identidades_sociais"("provedor", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "identidades_sociais_usuarioId_provedor_key" ON "identidades_sociais"("usuarioId", "provedor");

-- CreateIndex
CREATE INDEX "fluxos_sociais_expiraEm_idx" ON "fluxos_sociais"("expiraEm");

-- CreateIndex
CREATE INDEX "pedidos_agendamento_status_criadoEm_idx" ON "pedidos_agendamento"("status", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_agendamento_clienteId_chave_key" ON "pedidos_agendamento"("clienteId", "chave");

-- CreateIndex
CREATE INDEX "alteracoes_plano_assinatura_assinaturaId_estado_idx" ON "alteracoes_plano_assinatura"("assinaturaId", "estado");

-- CreateIndex
CREATE INDEX "alteracoes_plano_assinatura_estado_efetivaEm_idx" ON "alteracoes_plano_assinatura"("estado", "efetivaEm");

-- AddForeignKey
ALTER TABLE "identidades_sociais" ADD CONSTRAINT "identidades_sociais_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_agendamento" ADD CONSTRAINT "pedidos_agendamento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_agendamento" ADD CONSTRAINT "pedidos_agendamento_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "barbeiros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alteracoes_plano_assinatura" ADD CONSTRAINT "alteracoes_plano_assinatura_assinaturaId_fkey" FOREIGN KEY ("assinaturaId") REFERENCES "assinaturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Uma solicitacao de troca em andamento por assinatura.
CREATE UNIQUE INDEX "alteracoes_plano_uma_pendente" ON "alteracoes_plano_assinatura" ("assinaturaId") WHERE "estado" IN ('SOLICITADA', 'AGENDADA', 'EM_CONFERENCIA');
