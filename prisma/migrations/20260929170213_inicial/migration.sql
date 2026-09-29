-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('DONO', 'BARBEIRO', 'CLIENTE');

-- CreateEnum
CREATE TYPE "TipoExcecao" AS ENUM ('FOLGA', 'HORARIO_ESPECIAL');

-- CreateEnum
CREATE TYPE "StatusAgendamento" AS ENUM ('MARCADO', 'CONFIRMADO', 'CHEGOU', 'EM_ATENDIMENTO', 'CONCLUIDO', 'FALTOU', 'CANCELADO');

-- CreateEnum
CREATE TYPE "OrigemAgendamento" AS ENUM ('BOT', 'SITE', 'RECEPCAO', 'BARBEIRO', 'PAINEL');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "papel" "Papel" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codigos_login" (
    "id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "usadoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigos_login_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracao" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nomeBarbearia" TEXT NOT NULL DEFAULT 'Barbearia',
    "fuso" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "granularidadeMin" INTEGER NOT NULL DEFAULT 15,
    "antecedenciaMinimaMin" INTEGER NOT NULL DEFAULT 60,
    "janelaAgendamentoDias" INTEGER NOT NULL DEFAULT 30,
    "intervaloEntreClientes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "configuracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barbeiros" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT NOT NULL DEFAULT '#378ADD',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "barbeiros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "duracaoMin" INTEGER NOT NULL,
    "precoCentavos" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "servicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barbeiro_servicos" (
    "barbeiroId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "duracaoMin" INTEGER,
    "precoCentavos" INTEGER,

    CONSTRAINT "barbeiro_servicos_pkey" PRIMARY KEY ("barbeiroId","servicoId")
);

-- CreateTable
CREATE TABLE "expediente_padrao" (
    "id" TEXT NOT NULL,
    "barbeiroId" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "inicioMin" INTEGER NOT NULL,
    "fimMin" INTEGER NOT NULL,

    CONSTRAINT "expediente_padrao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "excecoes_agenda" (
    "id" TEXT NOT NULL,
    "barbeiroId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "tipo" "TipoExcecao" NOT NULL,
    "intervalos" JSONB,
    "motivo" TEXT,

    CONSTRAINT "excecoes_agenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bloqueios" (
    "id" TEXT NOT NULL,
    "barbeiroId" TEXT NOT NULL,
    "inicio" TIMESTAMPTZ(3) NOT NULL,
    "fim" TIMESTAMPTZ(3) NOT NULL,
    "motivo" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "observacoes" TEXT,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agendamentos" (
    "id" TEXT NOT NULL,
    "barbeiroId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "inicio" TIMESTAMPTZ(3) NOT NULL,
    "fim" TIMESTAMPTZ(3) NOT NULL,
    "status" "StatusAgendamento" NOT NULL DEFAULT 'MARCADO',
    "origem" "OrigemAgendamento" NOT NULL,
    "precoCentavos" INTEGER NOT NULL,
    "observacao" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agendamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "dados" JSONB,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_telefone_key" ON "usuarios"("telefone");

-- CreateIndex
CREATE INDEX "codigos_login_telefone_criadoEm_idx" ON "codigos_login"("telefone", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "barbeiros_usuarioId_key" ON "barbeiros"("usuarioId");

-- CreateIndex
CREATE INDEX "expediente_padrao_barbeiroId_diaSemana_idx" ON "expediente_padrao"("barbeiroId", "diaSemana");

-- CreateIndex
CREATE UNIQUE INDEX "excecoes_agenda_barbeiroId_data_key" ON "excecoes_agenda"("barbeiroId", "data");

-- CreateIndex
CREATE INDEX "bloqueios_barbeiroId_inicio_idx" ON "bloqueios"("barbeiroId", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_telefone_key" ON "clientes"("telefone");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_usuarioId_key" ON "clientes"("usuarioId");

-- CreateIndex
CREATE INDEX "agendamentos_barbeiroId_inicio_idx" ON "agendamentos"("barbeiroId", "inicio");

-- CreateIndex
CREATE INDEX "agendamentos_clienteId_idx" ON "agendamentos"("clienteId");

-- CreateIndex
CREATE INDEX "auditoria_entidade_entidadeId_idx" ON "auditoria"("entidade", "entidadeId");

-- AddForeignKey
ALTER TABLE "barbeiros" ADD CONSTRAINT "barbeiros_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbeiro_servicos" ADD CONSTRAINT "barbeiro_servicos_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "barbeiros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbeiro_servicos" ADD CONSTRAINT "barbeiro_servicos_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "servicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_padrao" ADD CONSTRAINT "expediente_padrao_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "barbeiros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excecoes_agenda" ADD CONSTRAINT "excecoes_agenda_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "barbeiros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueios" ADD CONSTRAINT "bloqueios_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "barbeiros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "barbeiros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "servicos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras que o Prisma nao expressa: garantem a agenda no nivel do banco.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Dois atendimentos ativos do mesmo barbeiro nunca se sobrepoem, mesmo com
-- bot, site e recepcao marcando ao mesmo tempo.
ALTER TABLE "agendamentos"
  ADD CONSTRAINT "agendamentos_sem_sobreposicao"
  EXCLUDE USING gist ("barbeiroId" WITH =, tstzrange("inicio", "fim", '[)') WITH &&)
  WHERE ("status" NOT IN ('CANCELADO', 'FALTOU'));

ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_fim_depois_inicio" CHECK ("fim" > "inicio");
ALTER TABLE "bloqueios" ADD CONSTRAINT "bloqueios_fim_depois_inicio" CHECK ("fim" > "inicio");
ALTER TABLE "expediente_padrao" ADD CONSTRAINT "expediente_intervalo_valido"
  CHECK ("diaSemana" BETWEEN 0 AND 6 AND "inicioMin" >= 0 AND "fimMin" <= 1440 AND "fimMin" > "inicioMin");
ALTER TABLE "configuracao" ADD CONSTRAINT "configuracao_linha_unica" CHECK ("id" = 1);
