const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

type PlanoResumo = {
  servicos: { nome: string; usosPorCiclo: number | null }[];
  intervaloMinDias: number | null;
  diasSemana: number[];
  descontoExtrasPct: number;
};

/** Lista de beneficios do plano em texto (usada na vitrine e na area do cliente). */
export function itensDoPlano(p: PlanoResumo) {
  return [
    ...p.servicos.map((s) => s.nome + (s.usosPorCiclo ? ` (${s.usosPorCiclo}x por mês)` : " à vontade")),
    ...(p.intervaloMinDias ? [`1 visita a cada ${p.intervaloMinDias} dias`] : []),
    ...(p.diasSemana.length > 0 && p.diasSemana.length < 7 ? [`Vale: ${[...p.diasSemana].sort().map((x) => DIAS[x]).join(", ")}`] : []),
    ...(p.descontoExtrasPct > 0 ? [`${p.descontoExtrasPct}% de desconto nos outros serviços`] : []),
  ];
}

/** Com 3+ planos, o do meio ganha destaque (como no site da barbearia). */
export function planoEmDestaque<T extends { id: string }>(planos: T[]) {
  return planos.length >= 3 ? planos[Math.floor(planos.length / 2)].id : null;
}

export const porDia = (precoCentavos: number) => Math.round(precoCentavos / 30);
