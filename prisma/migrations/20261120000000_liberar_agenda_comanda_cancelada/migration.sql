BEGIN;

-- A unicidade de agendamentoId identifica a comanda atual. A auditoria da comanda
-- conserva o par histórico por item quando uma tentativa sem cobrança é cancelada.
CREATE FUNCTION liberar_agenda_comanda_cancelada(comanda_id text, usuario_id text)
RETURNS void LANGUAGE sql AS $$
  WITH vinculados AS MATERIALIZED (
    SELECT i.id, i."agendamentoId"
    FROM itens_comanda i JOIN comandas c ON c.id = i."comandaId"
    WHERE c.id = comanda_id AND c.status = 'CANCELADA' AND c."fechadaEm" IS NULL
      AND i."agendamentoId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pagamentos_comanda p WHERE p."comandaId" = c.id)
      AND NOT EXISTS (SELECT 1 FROM pedidos_estorno e WHERE e."comandaId" = c.id)
      AND NOT EXISTS (SELECT 1 FROM links_pagamento l WHERE l."comandaId" = c.id
        AND (l.status IN ('PAGO', 'ESTORNADO') OR l."pagoEm" IS NOT NULL
          OR l."gatewayId" IS NOT NULL OR l."tentativaChave" IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM itens_comanda outro
        JOIN pagamentos_antecipados a ON a."agendamentoId" = outro."agendamentoId"
        WHERE outro."comandaId" = c.id AND (a.status <> 'CANCELADO' OR a."pagoEm" IS NOT NULL
          OR a."gatewayId" IS NOT NULL OR a."emissaoChave" IS NOT NULL))
  ), liberados AS (
    UPDATE itens_comanda i SET "agendamentoId" = NULL
    FROM vinculados v WHERE i.id = v.id AND i."agendamentoId" = v."agendamentoId"
    RETURNING v.id AS "itemId", v."agendamentoId"
  )
  INSERT INTO auditoria (id, "usuarioId", acao, entidade, "entidadeId", dados)
  SELECT gen_random_uuid()::text, usuario_id, 'liberar_agendamentos', 'comanda', comanda_id,
    jsonb_build_object('itens', jsonb_agg(to_jsonb(liberados) ORDER BY "itemId"))
  FROM liberados HAVING count(*) > 0;
$$;

SELECT liberar_agenda_comanda_cancelada(id, NULL)
FROM comandas WHERE status = 'CANCELADA' AND "fechadaEm" IS NULL;

COMMIT;
