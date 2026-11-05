-- Revoga sessões anteriores ao comprovar a posse de uma conta ainda não verificada.
ALTER TABLE "usuarios" ADD COLUMN "sessaoVersao" INTEGER NOT NULL DEFAULT 0;
