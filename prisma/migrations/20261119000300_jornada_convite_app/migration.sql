CREATE TABLE "jornadas_convite_app" (
  "conversaId" TEXT PRIMARY KEY REFERENCES conversas(id) ON DELETE CASCADE,
  "clienteId" TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  "inicioEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "aberturaId" TEXT REFERENCES mensagens(id) ON DELETE SET NULL,
  "respostaEm" TIMESTAMPTZ(3), "linkId" TEXT REFERENCES mensagens(id) ON DELETE SET NULL,
  "clicouEm" TIMESTAMPTZ(3), "loginEm" TIMESTAMPTZ(3), "entrouEm" TIMESTAMPTZ(3),
  "agendaEm" TIMESTAMPTZ(3), "instalouEm" TIMESTAMPTZ(3), "parouEm" TIMESTAMPTZ(3),
  "lembreteMensagemId" TEXT, "lembreteAgendamentoId" TEXT, "lembreteInicio" TIMESTAMPTZ(3),
  "ultimaRetomadaEm" TIMESTAMPTZ(3), "proximaEm" TIMESTAMPTZ(3), retomadas INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX "jornadas_convite_app_proximaEm_idx" ON jornadas_convite_app ("proximaEm");
CREATE INDEX "jornadas_convite_app_clienteId_idx" ON jornadas_convite_app ("clienteId");

CREATE FUNCTION interromper_jornada_convite_app() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = 'HUMANO' OR NEW."recusaAutomaticas" OR NEW."clienteId" IS DISTINCT FROM OLD."clienteId" OR NEW.telefone IS DISTINCT FROM OLD.telefone THEN
    UPDATE jornadas_convite_app SET "parouEm" = CURRENT_TIMESTAMP, "proximaEm" = NULL
    WHERE "conversaId" = NEW.id AND "parouEm" IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversa_interrompe_jornada AFTER UPDATE OF estado, "recusaAutomaticas", "clienteId", telefone ON conversas
FOR EACH ROW EXECUTE FUNCTION interromper_jornada_convite_app();

CREATE VIEW rotas_convites_app AS
SELECT j."conversaId", c.nome, j."inicioEm", a."criadoEm" AS "aberturaEm", a."entregueEm", a."lidaEm",
       j."respostaEm", l."criadoEm" AS "linkEm", l."lidaEm" AS "linkLidoEm",
       j."clicouEm", j."loginEm", j."entrouEm", j."agendaEm", j."instalouEm",
       j."parouEm", j.retomadas, j."proximaEm",
       EXISTS (SELECT FROM pedidos_agendamento p WHERE p."clienteId"=j."clienteId"
         AND p."criadoEm" >= l."criadoEm") AS pediu,
       COALESCE(r.marcou,false) AS marcou, COALESCE(r.confirmou,false) AS confirmou, COALESCE(r.compareceu,false) AS compareceu
FROM jornadas_convite_app j JOIN conversas v ON v.id=j."conversaId" AND v."clienteId"=j."clienteId"
JOIN clientes c ON c.id=j."clienteId" AND c."excluidoEm" IS NULL
LEFT JOIN mensagens a ON a.id=j."aberturaId" LEFT JOIN mensagens l ON l.id=j."linkId"
LEFT JOIN LATERAL (
  SELECT bool_or(true) AS marcou,
    bool_or(g.status IN ('CONFIRMADO','CHEGOU','EM_ATENDIMENTO','CONCLUIDO')) AS confirmou,
    bool_or(g.status IN ('CHEGOU','EM_ATENDIMENTO','CONCLUIDO')) AS compareceu
  FROM agendamentos g WHERE g."clienteId"=j."clienteId" AND g."adicionalDeId" IS NULL
    AND g."criadoEm" >= l."criadoEm" AND g."criadoEm" <= l."criadoEm" + INTERVAL '30 days'
) r ON true;
