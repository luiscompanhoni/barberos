import { db } from "@/lib/db";

export type RotaConvite = {
  conversaId: string; nome: string; inicioEm: Date; aberturaEm: Date | null; entregueEm: Date | null; lidaEm: Date | null;
  respostaEm: Date | null; linkEm: Date | null; linkLidoEm: Date | null; clicouEm: Date | null; loginEm: Date | null;
  entrouEm: Date | null; agendaEm: Date | null; instalouEm: Date | null; parouEm: Date | null; retomadas: number;
  proximaEm: Date | null; pediu: boolean; marcou: boolean; confirmou: boolean; compareceu: boolean;
};

export async function relatorioConvites(pagina: number) {
  const [linhas, [totais]] = await Promise.all([
    db.$queryRaw<RotaConvite[]>`SELECT * FROM rotas_convites_app ORDER BY "inicioEm" DESC, "conversaId" LIMIT 50 OFFSET ${(pagina - 1) * 50}`,
    db.$queryRaw<Record<string, number>[]>`SELECT count(*)::int AS total, count("aberturaEm")::int AS aberturas,
      count("entregueEm")::int AS entregues, count("lidaEm")::int AS lidos, count("respostaEm")::int AS respostas,
      count("linkEm")::int AS links, count("linkLidoEm")::int AS "linksLidos", count("clicouEm")::int AS cliques,
      count("loginEm")::int AS login, count("entrouEm")::int AS acessos, count("instalouEm")::int AS instalacoes, count("agendaEm")::int AS agenda,
      count(*) FILTER(WHERE pediu)::int AS pedidos, count(*) FILTER(WHERE marcou)::int AS reservas,
      count(*) FILTER(WHERE confirmou)::int AS confirmacoes, count(*) FILTER(WHERE compareceu)::int AS presencas FROM rotas_convites_app`,
  ]);
  return { linhas, totais };
}
