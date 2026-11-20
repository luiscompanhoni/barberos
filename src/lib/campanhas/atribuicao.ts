import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const DIAS_RESULTADO = 14;

// No legado, enviadoEm foi gravado na reserva da fila. A mensagem só é
// persistida após o retorno do canal. Sem esse registro não há hora comprovada.
const envios = Prisma.sql`
  SELECT e.id, e."campanhaId", e."clienteId", GREATEST(m."criadoEm", e."enviadoEm") AS instante
  FROM campanha_envios e JOIN mensagens m ON m.id = e."mensagemId"
  WHERE e.status = 'ENVIADO' AND m.erro IS NULL`;
const janela = Prisma.sql`a."criadoEm" > e.instante AND a."criadoEm" <= e.instante + ${DIAS_RESULTADO * 24} * interval '1 hour'`;

export function resumoDosEnvios(inicioHoje: Date, fimHoje: Date) {
  return db.$queryRaw<{ campanhaId: string; enviados: number; hoje: number; recusam: number }[]>`
    SELECT e."campanhaId", COUNT(*)::int AS enviados,
      (COUNT(*) FILTER (WHERE e.instante >= ${inicioHoje} AND e.instante < ${fimHoje}))::int AS hoje,
      (COUNT(*) FILTER (WHERE NOT c."aceitaMensagens"))::int AS recusam
    FROM (${envios}) e JOIN clientes c ON c.id = e."clienteId" GROUP BY 1`;
}

export function contagemDeClientesAtribuidos() {
  return db.$queryRaw<{ campanhaId: string; n: number }[]>`
    WITH reservas AS (
      SELECT DISTINCT ON (a.id) e."campanhaId", e."clienteId"
      FROM (${envios}) e JOIN agendamentos a ON a."clienteId" = e."clienteId" AND ${janela}
      ORDER BY a.id, e.instante DESC, e.id DESC
    )
    SELECT "campanhaId", COUNT(DISTINCT "clienteId")::int AS n FROM reservas GROUP BY 1`;
}

export function resultadosAtribuidos(campanhaId: string) {
  return db.$queryRaw<{ clienteId: string; status: string; comandaId: string | null }[]>`
    WITH candidatas AS (
      SELECT a.id, i."comandaId"
      FROM (${envios} AND e."campanhaId" = ${campanhaId}) e
      JOIN agendamentos a ON a."clienteId" = e."clienteId" AND ${janela}
      LEFT JOIN itens_comanda i ON i."agendamentoId" = a.id
    ), pertinentes AS (
      SELECT id FROM candidatas
      UNION
      SELECT i."agendamentoId" FROM candidatas c JOIN itens_comanda i USING ("comandaId")
      WHERE i."agendamentoId" IS NOT NULL
    ), reservas AS (
      SELECT a.id, a."clienteId", a.status, vencedor."campanhaId", vencedor.instante, vencedor.id AS "envioId"
      FROM pertinentes p JOIN agendamentos a ON a.id = p.id
      JOIN LATERAL (
        SELECT e.* FROM (${envios} AND e."clienteId" = a."clienteId") e
        WHERE ${janela} ORDER BY e.instante DESC, e.id DESC LIMIT 1
      ) vencedor ON true
    ), comandas AS (
      SELECT DISTINCT ON (i."comandaId") i."comandaId", r.id
      FROM reservas r JOIN itens_comanda i ON i."agendamentoId" = r.id
      ORDER BY i."comandaId", r.instante DESC, r."envioId" DESC, r.id DESC
    )
    SELECT r."clienteId", r.status::text, c."comandaId"
    FROM reservas r LEFT JOIN comandas c ON c.id = r.id WHERE r."campanhaId" = ${campanhaId}`;
}
