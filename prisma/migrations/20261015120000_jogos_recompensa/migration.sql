-- Motor unico de jogos de recompensa (roleta, caixas, raspadinha). Migra a roleta antiga sem perder nada.

-- CreateEnum
CREATE TYPE "TipoJogo" AS ENUM ('ROLETA', 'CAIXA', 'RASPADINHA');

-- CreateEnum
CREATE TYPE "TipoPremio" AS ENUM ('CREDITO', 'BRINDE', 'SERVICO', 'DESCONTO', 'NADA');

-- CreateEnum
CREATE TYPE "Raridade" AS ENUM ('COMUM', 'RARO', 'EPICO', 'LENDARIO');

-- CreateEnum
CREATE TYPE "OrigemJogada" AS ENUM ('ATENDIMENTO', 'GRATIS', 'CAMPANHA', 'INDICACAO', 'ANIVERSARIO', 'ASSINATURA', 'MANUAL');

-- CreateEnum
CREATE TYPE "StatusPremioGanho" AS ENUM ('DISPONIVEL', 'RESERVADO', 'UTILIZADO', 'EXPIRADO', 'CANCELADO');

-- AlterTable
ALTER TABLE "campanha_envios" ADD COLUMN     "jogadaId" TEXT;

-- AlterTable
ALTER TABLE "campanhas" ADD COLUMN     "jogoId" TEXT;

-- CreateTable
CREATE TABLE "jogos" (
    "id" TEXT NOT NULL,
    "tipo" "TipoJogo" NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "premiosPorJogada" INTEGER NOT NULL DEFAULT 1,
    "raridade" "Raridade" NOT NULL DEFAULT 'COMUM',
    "validadeDias" INTEGER NOT NULL DEFAULT 30,
    "bonusAssinantePct" INTEGER NOT NULL DEFAULT 10,
    "inicioEm" TIMESTAMPTZ(3),
    "fimEm" TIMESTAMPTZ(3),
    "limitePorPessoaMes" INTEGER,
    "jogadasPorAtendimento" INTEGER NOT NULL DEFAULT 0,
    "valorMinimoAtendimentoCentavos" INTEGER NOT NULL DEFAULT 0,
    "soAssinante" BOOLEAN NOT NULL DEFAULT false,
    "jogadasPorIndicacao" INTEGER NOT NULL DEFAULT 0,
    "jogadasAniversario" INTEGER NOT NULL DEFAULT 0,
    "jogadasRenovacaoPlano" INTEGER NOT NULL DEFAULT 0,
    "gratisACadaDias" INTEGER NOT NULL DEFAULT 0,
    "contarDesde" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "jogos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jogo_premios" (
    "id" TEXT NOT NULL,
    "jogoId" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "tipo" "TipoPremio" NOT NULL,
    "valorCentavos" INTEGER NOT NULL DEFAULT 0,
    "percentual" INTEGER NOT NULL DEFAULT 0,
    "servicoId" TEXT,
    "chanceBps" INTEGER NOT NULL,
    "raridade" "Raridade" NOT NULL DEFAULT 'COMUM',
    "cor" TEXT NOT NULL,
    "icone" TEXT NOT NULL DEFAULT 'presente',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "limiteMensal" INTEGER,
    "estoque" INTEGER,
    "custoCentavos" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jogo_premios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jogo_fichas" (
    "id" TEXT NOT NULL,
    "jogoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "origem" "OrigemJogada" NOT NULL,
    "referencia" TEXT NOT NULL,
    "expiraEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jogadaId" TEXT,

    CONSTRAINT "jogo_fichas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jogadas" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "jogoId" TEXT NOT NULL,
    "tipo" "TipoJogo" NOT NULL,
    "clienteId" TEXT NOT NULL,
    "origem" "OrigemJogada" NOT NULL,
    "multiplicador" INTEGER NOT NULL DEFAULT 100,
    "vitoria" BOOLEAN NOT NULL,
    "resultado" JSONB NOT NULL,
    "ip" TEXT,
    "dispositivo" TEXT,
    "reveladaEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jogadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premios_ganhos" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "jogadaId" TEXT NOT NULL,
    "jogoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "premioId" TEXT,
    "rotulo" TEXT NOT NULL,
    "tipo" "TipoPremio" NOT NULL,
    "raridade" "Raridade" NOT NULL,
    "icone" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL DEFAULT 0,
    "percentual" INTEGER NOT NULL DEFAULT 0,
    "servicoId" TEXT,
    "multiplicador" INTEGER NOT NULL DEFAULT 100,
    "custoCentavos" INTEGER NOT NULL DEFAULT 0,
    "status" "StatusPremioGanho" NOT NULL,
    "beneficioId" TEXT,
    "agendamentoId" TEXT,
    "reservadoEm" TIMESTAMPTZ(3),
    "comandaId" TEXT,
    "descontoAplicadoCentavos" INTEGER NOT NULL DEFAULT 0,
    "utilizadoEm" TIMESTAMPTZ(3),
    "validadoPorId" TEXT,
    "expiraEm" TIMESTAMPTZ(3),
    "canceladoEm" TIMESTAMPTZ(3),
    "canceladoPorId" TEXT,
    "motivoCancelamento" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "premios_ganhos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jogo_premios_jogoId_idx" ON "jogo_premios"("jogoId");

-- CreateIndex
CREATE UNIQUE INDEX "jogo_fichas_jogadaId_key" ON "jogo_fichas"("jogadaId");

-- CreateIndex
CREATE INDEX "jogo_fichas_clienteId_jogoId_jogadaId_idx" ON "jogo_fichas"("clienteId", "jogoId", "jogadaId");

-- CreateIndex
CREATE UNIQUE INDEX "jogo_fichas_jogoId_clienteId_origem_referencia_key" ON "jogo_fichas"("jogoId", "clienteId", "origem", "referencia");

-- CreateIndex
CREATE UNIQUE INDEX "jogadas_chave_key" ON "jogadas"("chave");

-- CreateIndex
CREATE INDEX "jogadas_clienteId_criadoEm_idx" ON "jogadas"("clienteId", "criadoEm");

-- CreateIndex
CREATE INDEX "jogadas_jogoId_criadoEm_idx" ON "jogadas"("jogoId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "premios_ganhos_codigo_key" ON "premios_ganhos"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "premios_ganhos_beneficioId_key" ON "premios_ganhos"("beneficioId");

-- CreateIndex
CREATE INDEX "premios_ganhos_clienteId_status_idx" ON "premios_ganhos"("clienteId", "status");

-- CreateIndex
CREATE INDEX "premios_ganhos_status_expiraEm_idx" ON "premios_ganhos"("status", "expiraEm");

-- CreateIndex
CREATE INDEX "premios_ganhos_agendamentoId_idx" ON "premios_ganhos"("agendamentoId");

-- CreateIndex
CREATE INDEX "premios_ganhos_comandaId_idx" ON "premios_ganhos"("comandaId");

-- CreateIndex
CREATE UNIQUE INDEX "campanha_envios_jogadaId_key" ON "campanha_envios"("jogadaId");

-- AddForeignKey
ALTER TABLE "jogo_premios" ADD CONSTRAINT "jogo_premios_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "jogos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jogo_premios" ADD CONSTRAINT "jogo_premios_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "servicos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jogo_fichas" ADD CONSTRAINT "jogo_fichas_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "jogos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jogo_fichas" ADD CONSTRAINT "jogo_fichas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jogo_fichas" ADD CONSTRAINT "jogo_fichas_jogadaId_fkey" FOREIGN KEY ("jogadaId") REFERENCES "jogadas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jogadas" ADD CONSTRAINT "jogadas_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "jogos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jogadas" ADD CONSTRAINT "jogadas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premios_ganhos" ADD CONSTRAINT "premios_ganhos_jogadaId_fkey" FOREIGN KEY ("jogadaId") REFERENCES "jogadas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premios_ganhos" ADD CONSTRAINT "premios_ganhos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premios_ganhos" ADD CONSTRAINT "premios_ganhos_premioId_fkey" FOREIGN KEY ("premioId") REFERENCES "jogo_premios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premios_ganhos" ADD CONSTRAINT "premios_ganhos_agendamentoId_fkey" FOREIGN KEY ("agendamentoId") REFERENCES "agendamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "jogos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanha_envios" ADD CONSTRAINT "campanha_envios_jogadaId_fkey" FOREIGN KEY ("jogadaId") REFERENCES "jogadas"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===================== Dados: roleta antiga -> motor novo

-- Jogo "roleta" com a configuracao atual (ou desligado, se nunca foi configurada).
INSERT INTO "jogos" ("id", "tipo", "nome", "descricao", "ativo", "ordem", "jogadasPorAtendimento", "atualizadoEm")
VALUES ('roleta', 'ROLETA', 'Roleta Black', 'Gire e ganhe prêmios na Black.', false, 0, 1, CURRENT_TIMESTAMP);
UPDATE "jogos" j SET "ativo" = c."ativa", "jogadasPorAtendimento" = c."girosPorAtendimento", "gratisACadaDias" = c."giroGratisDias",
  "bonusAssinantePct" = c."bonusAssinantePct", "validadeDias" = c."validadeDias", "contarDesde" = c."inicioEm"
FROM "roleta_config" c WHERE c."id" = 1 AND j."id" = 'roleta';

-- Premios: o peso vira chance em centesimos de % (soma dos ativos = 10000; a sobra do arredondamento vai para o maior).
WITH a AS (
  SELECT p.*, (p."ativo" AND p."peso" > 0) AS vivo FROM "roleta_premios" p
), t AS (
  SELECT COALESCE(SUM("peso"), 0)::bigint AS s FROM a WHERE vivo
), b AS (
  SELECT a.*, CASE WHEN a.vivo AND t.s > 0 THEN (a."peso"::bigint * 10000 / t.s)::int ELSE 0 END AS bps,
         row_number() OVER (ORDER BY a.vivo DESC, a."peso" DESC, a."id") AS rn
  FROM a, t
), sobra AS (
  SELECT 10000 - COALESCE(SUM(bps), 0)::int AS r, BOOL_OR(vivo) AS algum FROM b
)
INSERT INTO "jogo_premios" ("id", "jogoId", "rotulo", "tipo", "valorCentavos", "chanceBps", "raridade", "cor", "icone", "ordem", "ativo", "limiteMensal", "custoCentavos", "criadoEm")
SELECT b."id", 'roleta', b."rotulo", b."tipo"::text::"TipoPremio", b."valorCentavos",
       b.bps + CASE WHEN b.rn = 1 AND sobra.algum THEN sobra.r ELSE 0 END,
       (CASE WHEN b."tipo" = 'NADA' OR NOT b.vivo THEN 'COMUM' WHEN b.bps < 200 THEN 'LENDARIO' WHEN b.bps < 600 THEN 'EPICO' WHEN b.bps < 1500 THEN 'RARO' ELSE 'COMUM' END)::"Raridade",
       b."cor", CASE b."tipo" WHEN 'CREDITO' THEN 'dinheiro' WHEN 'BRINDE' THEN 'presente' ELSE 'nada' END,
       b."ordem", b."ativo", b."limiteMensal", b."custoCentavos", b."criadoEm"
FROM b, sobra;

-- Identidade da Black: fatias em preto, grafite, ouro, champanhe e bronze (alternando) e icone pelo nome do premio.
UPDATE "jogo_premios" SET
  "cor" = (ARRAY['#141416', '#C9A24A', '#2A2A2E', '#E6D3A3', '#8A6A3B'])[("ordem" % 5) + 1],
  "icone" = CASE
    WHEN "tipo" = 'CREDITO' THEN 'dinheiro'
    WHEN "tipo" = 'NADA' THEN 'nada'
    WHEN "rotulo" ILIKE '%bebida%' OR "rotulo" ILIKE '%cerveja%' OR "rotulo" ILIKE '%drink%' THEN 'bebida'
    WHEN "rotulo" ILIKE '%corte%' THEN 'tesoura'
    WHEN "rotulo" ILIKE '%barba%' THEN 'barba'
    WHEN "rotulo" ILIKE '%pomada%' THEN 'pomada'
    ELSE 'presente' END
WHERE "jogoId" = 'roleta';

-- Cada giro vira uma jogada (mesmo id: o link da campanha continua apontando para ela).
INSERT INTO "jogadas" ("id", "chave", "jogoId", "tipo", "clienteId", "origem", "multiplicador", "vitoria", "resultado", "reveladaEm", "criadoEm")
SELECT g."id", 'legado:' || g."id", 'roleta', 'ROLETA', g."clienteId",
       (CASE g."origem" WHEN 'GRATIS' THEN 'GRATIS' WHEN 'CAMPANHA' THEN 'CAMPANHA' ELSE 'ATENDIMENTO' END)::"OrigemJogada",
       g."multiplicador", g."tipo" <> 'NADA',
       jsonb_build_object('legado', true, 'premioId', g."premioId", 'rotulo', g."rotulo"), g."criadoEm", g."criadoEm"
FROM "roleta_giros" g;

-- Premio de cada giro vencedor: credito ja esta no saldo (utilizado); brinde a retirar fica disponivel.
INSERT INTO "premios_ganhos" ("id", "codigo", "jogadaId", "jogoId", "clienteId", "premioId", "rotulo", "tipo", "raridade", "icone", "valorCentavos",
  "multiplicador", "custoCentavos", "status", "beneficioId", "utilizadoEm", "validadoPorId", "expiraEm", "criadoEm")
SELECT g."id", 'BB-' || upper(substr(md5(g."id" || ':premio'), 1, 6)), g."id", 'roleta', g."clienteId", g."premioId", g."rotulo",
       g."tipo"::text::"TipoPremio", COALESCE(p."raridade", 'COMUM'), CASE g."tipo" WHEN 'CREDITO' THEN 'dinheiro' ELSE 'presente' END,
       g."valorCentavos", g."multiplicador", g."custoCentavos",
       (CASE WHEN g."tipo" = 'CREDITO' THEN 'UTILIZADO' WHEN g."status" = 'A_RETIRAR' THEN 'DISPONIVEL' WHEN g."status" = 'EXPIRADO' THEN 'EXPIRADO' ELSE 'UTILIZADO' END)::"StatusPremioGanho",
       g."beneficioId",
       CASE WHEN g."tipo" = 'CREDITO' THEN g."criadoEm" WHEN g."status" = 'CONCLUIDO' THEN COALESCE(g."entregueEm", g."criadoEm") END,
       CASE WHEN g."tipo" = 'BRINDE' AND g."status" = 'CONCLUIDO' THEN g."entreguePorId" END,
       g."expiraEm", g."criadoEm"
FROM "roleta_giros" g LEFT JOIN "jogo_premios" p ON p."id" = g."premioId"
WHERE g."tipo" <> 'NADA';

-- Fichas por atendimento: as mesmas que a regra antiga contava (atendimento concluido desde que a roleta ligou).
INSERT INTO "jogo_fichas" ("id", "jogoId", "clienteId", "origem", "referencia", "criadoEm")
SELECT 'fj' || replace(gen_random_uuid()::text, '-', ''), 'roleta', a."clienteId", 'ATENDIMENTO', a."id" || ':' || k, a."fim"
FROM "agendamentos" a
JOIN "jogos" j ON j."id" = 'roleta'
CROSS JOIN LATERAL generate_series(1, j."jogadasPorAtendimento") AS k
WHERE a."status" = 'CONCLUIDO' AND a."inicio" >= j."contarDesde";

-- Giros por atendimento ja feitos gastam as fichas mais antigas do cliente.
WITH f AS (
  SELECT "id", "clienteId", row_number() OVER (PARTITION BY "clienteId" ORDER BY "criadoEm", "referencia") AS r
  FROM "jogo_fichas" WHERE "jogoId" = 'roleta' AND "origem" = 'ATENDIMENTO'
), g AS (
  SELECT "id", "clienteId", row_number() OVER (PARTITION BY "clienteId" ORDER BY "criadoEm", "id") AS r
  FROM "roleta_giros" WHERE "origem" NOT IN ('GRATIS', 'CAMPANHA')
)
UPDATE "jogo_fichas" jf SET "jogadaId" = g."id"
FROM f JOIN g ON g."clienteId" = f."clienteId" AND g.r = f.r
WHERE jf."id" = f."id";

-- Giros sem ficha correspondente (gratis, campanha ou atendimento que mudou depois): ficha propria, ja usada.
INSERT INTO "jogo_fichas" ("id", "jogoId", "clienteId", "origem", "referencia", "criadoEm", "jogadaId")
SELECT 'fj' || replace(gen_random_uuid()::text, '-', ''), 'roleta', g."clienteId",
       (CASE g."origem" WHEN 'GRATIS' THEN 'GRATIS' WHEN 'CAMPANHA' THEN 'CAMPANHA' ELSE 'ATENDIMENTO' END)::"OrigemJogada",
       COALESCE((SELECT 'envio:' || e."id" FROM "campanha_envios" e WHERE e."giroId" = g."id"), 'legado:' || g."id"), g."criadoEm", g."id"
FROM "roleta_giros" g
WHERE NOT EXISTS (SELECT 1 FROM "jogo_fichas" f WHERE f."jogadaId" = g."id");

-- Campanhas da roleta passam a apontar para o jogo; o envio aponta para a jogada (mesmo id do giro).
UPDATE "campanhas" SET "jogoId" = 'roleta' WHERE "roleta";
UPDATE "campanha_envios" SET "jogadaId" = "giroId" WHERE "giroId" IS NOT NULL;

-- ===================== Remove a roleta antiga

-- DropForeignKey
ALTER TABLE "roleta_giros" DROP CONSTRAINT "roleta_giros_clienteId_fkey";

-- DropForeignKey
ALTER TABLE "roleta_giros" DROP CONSTRAINT "roleta_giros_premioId_fkey";

-- DropForeignKey
ALTER TABLE "campanha_envios" DROP CONSTRAINT "campanha_envios_giroId_fkey";

-- DropIndex
DROP INDEX "campanha_envios_giroId_key";

-- AlterTable
ALTER TABLE "campanhas" DROP COLUMN "roleta";

-- AlterTable
ALTER TABLE "campanha_envios" DROP COLUMN "giroId";

-- DropTable
DROP TABLE "roleta_config";

-- DropTable
DROP TABLE "roleta_premios";

-- DropTable
DROP TABLE "roleta_giros";

-- DropEnum
DROP TYPE "TipoPremioRoleta";

-- DropEnum
DROP TYPE "StatusGiro";

