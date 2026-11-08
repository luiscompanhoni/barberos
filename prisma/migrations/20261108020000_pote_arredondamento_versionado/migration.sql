-- A migração não ativa maiores restos nem reescreve folhas ou versões históricas.
CREATE TYPE "ArredondamentoPote" AS ENUM ('LEGADO', 'MAIORES_RESTOS_V1');
ALTER TABLE "pote_config" ADD COLUMN "arredondamento" "ArredondamentoPote" NOT NULL DEFAULT 'LEGADO';
