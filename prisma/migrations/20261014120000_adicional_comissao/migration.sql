-- Comissao diferenciada com vigencia, motivo e quem autorizou (substitui o ajuste por barbeiro do pote).
CREATE TYPE "ModalidadeComissao" AS ENUM ('ASSINATURA', 'AVULSO');

CREATE TABLE "adicionais_comissao" (
    "id" TEXT NOT NULL,
    "barbeiroId" TEXT NOT NULL,
    "modalidade" "ModalidadeComissao" NOT NULL,
    "pontosBps" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE,
    "autorizadoPorId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adicionais_comissao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "adicionais_comissao_barbeiroId_modalidade_idx" ON "adicionais_comissao"("barbeiroId", "modalidade");

ALTER TABLE "adicionais_comissao" ADD CONSTRAINT "adicionais_comissao_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "barbeiros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ajustes que ja existiam viram adicionais de assinatura desde sempre, mantendo o % efetivo de hoje:
-- adicional (+N) continua +N; o % diferenciado vira a diferenca para o percentual base atual.
INSERT INTO "adicionais_comissao" ("id", "barbeiroId", "modalidade", "pontosBps", "motivo", "inicio")
SELECT 'migrado_' || pb."barbeiroId", pb."barbeiroId", 'ASSINATURA',
       COALESCE(pb."diferenciadaBps", b.base + pb."adicionalBps") - b.base,
       CASE WHEN pb."diferenciadaBps" IS NOT NULL
            THEN 'Percentual diferenciado de ' || replace(trim(trailing '.' from trim(trailing '0' from (pb."diferenciadaBps" / 100.0)::numeric(10,2)::TEXT)), '.', ',') || '% configurado antes do controle de vigência'
            ELSE 'Adicional configurado antes do controle de vigência' END,
       DATE '2000-01-01'
FROM "pote_barbeiros" pb
CROSS JOIN (SELECT COALESCE((SELECT "percentualBps" FROM "pote_config" WHERE "id" = 'pote'), 3500) AS base) b
WHERE COALESCE(pb."diferenciadaBps", b.base + pb."adicionalBps") <> b.base;

DROP TABLE "pote_barbeiros";
