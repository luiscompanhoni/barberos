-- Reverte apenas objetos criados para o Leonel. Exporte os eventos novos antes de usar.
BEGIN;
DROP TABLE "jornadas_roleta";
ALTER TABLE "campanha_envios"
    DROP COLUMN "aberturaConcluidaEm",
    DROP COLUMN "aberturaIniciadaEm",
    DROP COLUMN "continuacaoReservadaEm",
    DROP COLUMN "ofertaEnviadaEm",
    DROP COLUMN "ofertaTexto",
    DROP COLUMN "respostaEm";
COMMIT;
