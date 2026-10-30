-- AlterEnum
ALTER TYPE "Papel" ADD VALUE 'LIDER';

-- AlterEnum
ALTER TYPE "TipoAutomacao" ADD VALUE 'AVALIACAO';

-- AlterEnum
ALTER TYPE "OrigemJogada" ADD VALUE 'AVALIACAO';

-- AlterTable
ALTER TABLE "barbeiros" ADD COLUMN     "cadeiraId" TEXT;

-- AlterTable
ALTER TABLE "servicos" ADD COLUMN     "custoCentavos" INTEGER,
ADD COLUMN     "intervaloRecompraDias" INTEGER,
ADD COLUMN     "minimoDuracaoMin" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "barbeiro_servicos" ADD COLUMN     "minimoDuracaoMin" INTEGER;

-- AlterTable
ALTER TABLE "agendamentos" ADD COLUMN     "cadeiraId" TEXT;

-- AlterTable
ALTER TABLE "checklist_pessoas" ADD COLUMN     "usuarioId" TEXT;

-- CreateTable
CREATE TABLE "permissoes_usuarios" (
    "usuarioId" TEXT NOT NULL,
    "permissao" TEXT NOT NULL,
    "permitido" BOOLEAN NOT NULL,

    CONSTRAINT "permissoes_usuarios_pkey" PRIMARY KEY ("usuarioId","permissao")
);

-- CreateTable
CREATE TABLE "cadeiras" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cadeiras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reunioes" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "inicio" TEXT NOT NULL,
    "fim" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "conteudo" TEXT NOT NULL DEFAULT '',
    "acoes" JSONB NOT NULL DEFAULT '[]',
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "reunioes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avaliacao_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "ativaDesde" TIMESTAMPTZ(3),
    "jogoId" TEXT,
    "validadeDias" INTEGER NOT NULL DEFAULT 14,
    "recompensaValidadeDias" INTEGER NOT NULL DEFAULT 30,
    "whatsapp" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "avaliacao_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "convites_avaliacao" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "agendamentoId" TEXT NOT NULL,
    "barbeiroId" TEXT NOT NULL,
    "jogoId" TEXT,
    "recompensaValidadeDias" INTEGER NOT NULL DEFAULT 30,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "respondidaEm" TIMESTAMPTZ(3),

    CONSTRAINT "convites_avaliacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avaliacoes_clientes" (
    "id" TEXT NOT NULL,
    "conviteId" TEXT NOT NULL,
    "nota" INTEGER NOT NULL,
    "corte" INTEGER,
    "atendimento" INTEGER,
    "ambiente" INTEGER,
    "pontualidade" INTEGER,
    "comentario" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "avaliacoes_clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avaliacoes_resumos" (
    "barbeiroId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "soma" INTEGER NOT NULL DEFAULT 0,
    "categorias" JSONB NOT NULL DEFAULT '{}',
    "periodos" JSONB NOT NULL DEFAULT '{}',
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "avaliacoes_resumos_pkey" PRIMARY KEY ("barbeiroId")
);

-- CreateTable
CREATE TABLE "recompra_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "intervaloContatoDias" INTEGER NOT NULL DEFAULT 7,
    "descontoAtivo" BOOLEAN NOT NULL DEFAULT false,
    "descontoPct" INTEGER NOT NULL DEFAULT 0,
    "descontoMaxCentavos" INTEGER NOT NULL DEFAULT 0,
    "descontoValidadeDias" INTEGER NOT NULL DEFAULT 7,
    "reativacaoDias" INTEGER NOT NULL DEFAULT 30,
    "margemMinimaPct" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recompra_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ofertas_recompra" (
    "id" TEXT NOT NULL,
    "agendamentoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "ultimaEm" TIMESTAMPTZ(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'OFERECIDO',
    "lembrarEm" TIMESTAMPTZ(3),
    "novoAgendamentoId" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ofertas_recompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recompra_avisos" (
    "mensagemId" TEXT,
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "servicos" JSONB NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" TIMESTAMPTZ(3),
    "proximaTentativaEm" TIMESTAMPTZ(3),

    CONSTRAINT "recompra_avisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desempenho_regras" (
    "id" TEXT NOT NULL,
    "competenciaInicio" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desempenho_regras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desempenho_adesoes" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "inicio" TEXT NOT NULL,
    "diasSemana" INTEGER[],
    "inicioMin" INTEGER NOT NULL,
    "fimMin" INTEGER NOT NULL,
    "aceitaEm" TIMESTAMPTZ(3),
    "encerradaEm" TIMESTAMPTZ(3),
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desempenho_adesoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presenca_marcacoes" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "instante" TIMESTAMPTZ(3) NOT NULL,
    "chave" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,

    CONSTRAINT "presenca_marcacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presenca_ajustes" (
    "id" TEXT NOT NULL,
    "marcacaoId" TEXT NOT NULL,
    "instante" TIMESTAMPTZ(3) NOT NULL,
    "motivo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "solicitadoPorId" TEXT NOT NULL,
    "revisadoPorId" TEXT,
    "revisadoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presenca_ajustes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presenca_justificativas" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "porId" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presenca_justificativas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desempenho_avaliacoes" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "notas" JSONB NOT NULL,
    "comentario" TEXT NOT NULL,
    "porId" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "desempenho_avaliacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desempenho_bonus" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "regraId" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "folhaLancamentoId" TEXT,
    "checklistPontoId" TEXT,
    "porId" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desempenho_bonus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cadeiras_nome_key" ON "cadeiras"("nome");

-- CreateIndex
CREATE INDEX "reunioes_criadoEm_idx" ON "reunioes"("criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "convites_avaliacao_clienteId_key" ON "convites_avaliacao"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "convites_avaliacao_agendamentoId_key" ON "convites_avaliacao"("agendamentoId");

-- CreateIndex
CREATE INDEX "convites_avaliacao_barbeiroId_criadoEm_idx" ON "convites_avaliacao"("barbeiroId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "avaliacoes_clientes_conviteId_key" ON "avaliacoes_clientes"("conviteId");

-- CreateIndex
CREATE INDEX "avaliacoes_clientes_publicada_criadoEm_idx" ON "avaliacoes_clientes"("publicada", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "ofertas_recompra_novoAgendamentoId_key" ON "ofertas_recompra"("novoAgendamentoId");

-- CreateIndex
CREATE INDEX "ofertas_recompra_clienteId_servicoId_ultimaEm_idx" ON "ofertas_recompra"("clienteId", "servicoId", "ultimaEm");

-- CreateIndex
CREATE UNIQUE INDEX "ofertas_recompra_agendamentoId_servicoId_key" ON "ofertas_recompra"("agendamentoId", "servicoId");

-- CreateIndex
CREATE UNIQUE INDEX "recompra_avisos_chave_key" ON "recompra_avisos"("chave");

-- CreateIndex
CREATE INDEX "recompra_avisos_estado_proximaTentativaEm_idx" ON "recompra_avisos"("estado", "proximaTentativaEm");

-- CreateIndex
CREATE UNIQUE INDEX "desempenho_regras_competenciaInicio_key" ON "desempenho_regras"("competenciaInicio");

-- CreateIndex
CREATE INDEX "desempenho_adesoes_pessoaId_inicio_idx" ON "desempenho_adesoes"("pessoaId", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "presenca_marcacoes_chave_key" ON "presenca_marcacoes"("chave");

-- CreateIndex
CREATE INDEX "presenca_marcacoes_pessoaId_instante_idx" ON "presenca_marcacoes"("pessoaId", "instante");

-- CreateIndex
CREATE INDEX "presenca_ajustes_status_criadoEm_idx" ON "presenca_ajustes"("status", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "presenca_justificativas_pessoaId_data_key" ON "presenca_justificativas"("pessoaId", "data");

-- CreateIndex
CREATE INDEX "desempenho_avaliacoes_data_tipo_idx" ON "desempenho_avaliacoes"("data", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "desempenho_avaliacoes_pessoaId_data_tipo_key" ON "desempenho_avaliacoes"("pessoaId", "data", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "desempenho_bonus_folhaLancamentoId_key" ON "desempenho_bonus"("folhaLancamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "desempenho_bonus_checklistPontoId_key" ON "desempenho_bonus"("checklistPontoId");

-- CreateIndex
CREATE UNIQUE INDEX "desempenho_bonus_pessoaId_competencia_key" ON "desempenho_bonus"("pessoaId", "competencia");

-- CreateIndex
CREATE INDEX "agendamentos_cadeiraId_inicio_idx" ON "agendamentos"("cadeiraId", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_pessoas_usuarioId_key" ON "checklist_pessoas"("usuarioId");

-- AddForeignKey
ALTER TABLE "barbeiros" ADD CONSTRAINT "barbeiros_cadeiraId_fkey" FOREIGN KEY ("cadeiraId") REFERENCES "cadeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_cadeiraId_fkey" FOREIGN KEY ("cadeiraId") REFERENCES "cadeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_pessoas" ADD CONSTRAINT "checklist_pessoas_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissoes_usuarios" ADD CONSTRAINT "permissoes_usuarios_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacao_config" ADD CONSTRAINT "avaliacao_config_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "jogos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites_avaliacao" ADD CONSTRAINT "convites_avaliacao_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites_avaliacao" ADD CONSTRAINT "convites_avaliacao_agendamentoId_fkey" FOREIGN KEY ("agendamentoId") REFERENCES "agendamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites_avaliacao" ADD CONSTRAINT "convites_avaliacao_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "barbeiros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites_avaliacao" ADD CONSTRAINT "convites_avaliacao_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "jogos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacoes_clientes" ADD CONSTRAINT "avaliacoes_clientes_conviteId_fkey" FOREIGN KEY ("conviteId") REFERENCES "convites_avaliacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacoes_resumos" ADD CONSTRAINT "avaliacoes_resumos_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "barbeiros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas_recompra" ADD CONSTRAINT "ofertas_recompra_agendamentoId_fkey" FOREIGN KEY ("agendamentoId") REFERENCES "agendamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas_recompra" ADD CONSTRAINT "ofertas_recompra_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas_recompra" ADD CONSTRAINT "ofertas_recompra_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "servicos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas_recompra" ADD CONSTRAINT "ofertas_recompra_novoAgendamentoId_fkey" FOREIGN KEY ("novoAgendamentoId") REFERENCES "agendamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recompra_avisos" ADD CONSTRAINT "recompra_avisos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desempenho_adesoes" ADD CONSTRAINT "desempenho_adesoes_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "checklist_pessoas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presenca_marcacoes" ADD CONSTRAINT "presenca_marcacoes_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "checklist_pessoas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presenca_ajustes" ADD CONSTRAINT "presenca_ajustes_marcacaoId_fkey" FOREIGN KEY ("marcacaoId") REFERENCES "presenca_marcacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presenca_justificativas" ADD CONSTRAINT "presenca_justificativas_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "checklist_pessoas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desempenho_avaliacoes" ADD CONSTRAINT "desempenho_avaliacoes_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "checklist_pessoas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desempenho_bonus" ADD CONSTRAINT "desempenho_bonus_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "checklist_pessoas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desempenho_bonus" ADD CONSTRAINT "desempenho_bonus_regraId_fkey" FOREIGN KEY ("regraId") REFERENCES "desempenho_regras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desempenho_bonus" ADD CONSTRAINT "desempenho_bonus_folhaLancamentoId_fkey" FOREIGN KEY ("folhaLancamentoId") REFERENCES "folha_lancamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desempenho_bonus" ADD CONSTRAINT "desempenho_bonus_checklistPontoId_fkey" FOREIGN KEY ("checklistPontoId") REFERENCES "checklist_pontos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Uma cadeira fisica nao pode atender duas reservas simultaneas.
-- Historico sem cadeira e adicionais mantem o comportamento anterior.
ALTER TABLE "agendamentos"
  ADD CONSTRAINT "agendamentos_cadeira_sem_sobreposicao"
  EXCLUDE USING gist ("cadeiraId" WITH =, tstzrange("inicio", "fim", '[)') WITH &&)
  WHERE ("status" NOT IN ('CANCELADO', 'FALTOU') AND "adicionalDeId" IS NULL AND "cadeiraId" IS NOT NULL);

-- Vínculos demonstráveis preservam a identidade existente; demais fichas serão vinculadas pelo dono.
UPDATE "checklist_pessoas" AS p SET "usuarioId" = b."usuarioId"
FROM "barbeiros" AS b WHERE p."barbeiroId" = b.id;
UPDATE "servicos" SET "minimoDuracaoMin" = LEAST("duracaoMin", 5);
ALTER TABLE "servicos" ADD CONSTRAINT "servicos_custo_nao_negativo" CHECK ("custoCentavos" IS NULL OR "custoCentavos" >= 0);
ALTER TABLE "servicos" ADD CONSTRAINT "servicos_recompra_positiva" CHECK ("intervaloRecompraDias" IS NULL OR "intervaloRecompraDias" > 0);
ALTER TABLE "avaliacoes_clientes" ADD CONSTRAINT "avaliacoes_notas_validas" CHECK (
  "nota" BETWEEN 1 AND 5 AND ("corte" IS NULL OR "corte" BETWEEN 1 AND 5)
  AND ("atendimento" IS NULL OR "atendimento" BETWEEN 1 AND 5)
  AND ("ambiente" IS NULL OR "ambiente" BETWEEN 1 AND 5)
  AND ("pontualidade" IS NULL OR "pontualidade" BETWEEN 1 AND 5)
);
ALTER TABLE "desempenho_bonus" ADD CONSTRAINT "bonus_valor_nao_negativo" CHECK ("valorCentavos" >= 0);
