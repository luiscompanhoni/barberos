/**
 * Planos de exemplo (desenvolvimento). Rodar: npm run db:planos
 * Inclui um plano de "dias fracos" (ter-qui) para ocupar horarios vazios.
 */
import { PrismaClient } from "@prisma/client";

export async function criarPlanosExemplo(db: PrismaClient) {
  if (await db.plano.count()) return 0;
  const servico = async (nome: string) => (await db.servico.findFirstOrThrow({ where: { nome } })).id;
  const corte = await servico("Corte");
  const barba = await servico("Barba");
  const combo = await servico("Corte + barba");
  const semana = [1, 2, 3, 4, 5, 6];

  await db.plano.create({
    data: {
      nome: "Plano Corte", ordem: 0, precoCentavos: 9900, intervaloMinDias: 7, maxAgendamentosAbertos: 1,
      diasSemana: semana, descontoExtrasPct: 10, descricao: "Corte à vontade (1 a cada 7 dias) e 10% nos extras e no bar.",
      servicos: { create: [{ servicoId: corte, usosPorCiclo: null }] },
    },
  });
  await db.plano.create({
    data: {
      nome: "Plano Corte + Barba", ordem: 1, precoCentavos: 14900, vagas: 45, intervaloMinDias: 7, maxAgendamentosAbertos: 1,
      diasSemana: semana, descontoExtrasPct: 10, descricao: "Corte e barba à vontade (1 visita a cada 7 dias).",
      servicos: { create: [{ servicoId: corte, usosPorCiclo: null }, { servicoId: barba, usosPorCiclo: null }, { servicoId: combo, usosPorCiclo: null }] },
    },
  });
  await db.plano.create({
    data: {
      nome: "Plano Dias de Semana", ordem: 2, precoCentavos: 7900, intervaloMinDias: 7, maxAgendamentosAbertos: 1,
      diasSemana: [2, 3, 4], descontoExtrasPct: 5, descricao: "Corte de terça a quinta, os dias mais tranquilos, com preço menor.",
      servicos: { create: [{ servicoId: corte, usosPorCiclo: null }] },
    },
  });
  return 3;
}

if (process.argv[1]?.includes("planos-exemplo")) {
  const db = new PrismaClient();
  criarPlanosExemplo(db)
    .then((n) => console.log(n ? `${n} planos de exemplo criados.` : "Ja existem planos; nada feito."))
    .finally(() => db.$disconnect());
}
