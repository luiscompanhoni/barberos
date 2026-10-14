-- Custo interno de cada premio da roleta (e copia no giro) para o relatorio custo x faturamento.
ALTER TABLE "roleta_premios" ADD COLUMN "custoCentavos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "roleta_giros" ADD COLUMN "custoCentavos" INTEGER NOT NULL DEFAULT 0;
