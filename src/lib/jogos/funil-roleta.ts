import { db } from "@/lib/db";

const selecao = {
  clienteId: true,
  ganhouEm: true,
  semContinuidadeEm: true,
  nudgeEnviadoEm: true,
  respondeuEm: true,
  agendouEm: true,
  lembreteEnviadoEm: true,
  compareceuEm: true,
  posEnviadoEm: true,
  upsellEnviadoEm: true,
  upsellAceitoEm: true,
} as const;

type Linha = Record<Exclude<keyof typeof selecao, "clienteId">, Date | null> & { clienteId: string };

function etapa(rotulo: string, anteriores: Linha[], passaram: Linha[]) {
  return {
    rotulo,
    quantidade: passaram.length,
    base: anteriores.length,
    perdas: anteriores.length - passaram.length,
    conversao: anteriores.length ? passaram.length / anteriores.length : null,
  };
}

function etapasDepoisDaAgenda(agenda: Linha[]) {
  const compareceram = agenda.filter(j => j.compareceuEm);
  return [
    etapa("Lembrete enviado", agenda, agenda.filter(j => j.lembreteEnviadoEm)),
    etapa("Compareceram", agenda, compareceram),
    etapa("Agradecimento enviado", compareceram, compareceram.filter(j => j.posEnviadoEm)),
  ];
}

/** Compara somente marcos da mesma jogada e não exige lembrete para contar comparecimento. */
export function montarFunilRoleta(giros: Linha[]) {
  const ganhos = giros.filter(j => j.ganhouEm);
  const pendentes = ganhos.filter(j => j.semContinuidadeEm);
  const nudges = pendentes.filter(j => j.nudgeEnviadoEm);
  const respostas = nudges.filter(j => j.respondeuEm);
  const agenda = ganhos.filter(j => j.agendouEm);
  const agendaComResposta = respostas.filter(j => j.agendouEm && j.respondeuEm! <= j.agendouEm);
  const agendaSemResposta = nudges.filter(j => j.agendouEm && j.nudgeEnviadoEm! <= j.agendouEm && (!j.respondeuEm || j.agendouEm < j.respondeuEm));
  const agendaSemNudge = ganhos.filter(j => j.agendouEm && (!j.nudgeEnviadoEm || j.agendouEm < j.nudgeEnviadoEm));
  const posCorte = agenda.filter(j => j.compareceuEm && j.posEnviadoEm);
  const ofertas = posCorte.filter(j => j.upsellEnviadoEm);
  return {
    giros: giros.length,
    clientes: new Set(giros.map(j => j.clienteId)).size,
    geral: [
      etapa("Ganharam prêmio", giros, ganhos),
      etapa("Agendaram", ganhos, agenda),
      ...etapasDepoisDaAgenda(agenda),
    ],
    direto: [etapa("Agendaram antes do nudge", ganhos, agendaSemNudge), ...etapasDepoisDaAgenda(agendaSemNudge)],
    assistido: [
      etapa("Prêmio sem continuidade", ganhos, pendentes),
      etapa("Nudge enviado", pendentes, nudges),
      etapa("Responderam ao nudge", nudges, respostas),
      etapa("Agendaram após responder", respostas, agendaComResposta),
      etapa("Agendaram após o nudge sem resposta prévia", nudges, agendaSemResposta),
      ...etapasDepoisDaAgenda([...agendaComResposta, ...agendaSemResposta]),
    ],
    upsell: [
      etapa("Oferta enviada", posCorte, ofertas),
      etapa("Aceitaram a oferta", ofertas, ofertas.filter(j => j.upsellAceitoEm)),
    ],
  };
}

export async function funilRoleta(de: Date, ate: Date) {
  const jornadas = await db.jornadaRoleta.findMany({ where: { girouEm: { gte: de, lt: ate } }, select: selecao });
  return montarFunilRoleta(jornadas);
}
