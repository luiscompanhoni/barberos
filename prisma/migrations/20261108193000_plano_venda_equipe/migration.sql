-- Expansao compatível: planos existentes preservam a regra atual; ativacao individual apos publicar todos os leitores.
ALTER TABLE "planos" ADD COLUMN "vendaSomenteEquipe" BOOLEAN NOT NULL DEFAULT false;
