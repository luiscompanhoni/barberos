/**
 * Rodada de crescimento (chamada pelas automacoes a cada 5 min):
 * - lista de espera: avisa quando abre vaga no dia que o cliente queria;
 * - retorno: lembra cada cliente no ritmo dele, com horarios sugeridos;
 * - indicacao: premia quem indicou quando o amigo faz o 1o atendimento.
 */
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, minParaHhmm, minutosLocal, somarDias } from "@/lib/agenda/tempo";
import { enviarAutomacao } from "@/lib/automacoes/enviar";
import { db } from "@/lib/db";
import { descreverOpcao, opcoesDoDia } from "./espera";
import { converterIndicacoes } from "./indicacao";
import { escolherSugestoes, retornoDevido, ritmoDoCliente, TEXTOS } from "./regras";

const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const ESPERA_ENTRE_AVISOS_MS = 20 * MIN; // vaga que ninguem pegou vai para o proximo da fila
const MAX_RETORNOS_POR_RODADA = 20;
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "hoje" / "amanhã (quarta, 01/10)" / "sexta, 03/10" */
export function diaFalado(data: string, hoje: string) {
  const [, m, d] = data.split("-");
  const semana = DIAS[new Date(`${data}T12:00:00Z`).getUTCDay()];
  if (data === hoje) return "hoje";
  if (data === somarDias(hoje, 1)) return `amanhã (${semana}, ${d}/${m})`;
  return `${semana}, ${d}/${m}`;
}

export async function processarEsperas(agora: number, opts: { clienteIds?: string[] } = {}) {
  const cfg = await configuracao();
  const hoje = dataLocal(agora, cfg.fuso);
  const hojeDb = new Date(`${hoje}T00:00:00Z`);
  const so = opts.clienteIds ? { clienteId: { in: opts.clienteIds } } : {};
  await db.esperaHorario.updateMany({ where: { status: { in: ["ATIVA", "AVISADA"] }, data: { lt: hojeDb }, ...so }, data: { status: "EXPIRADA" } });

  const h = minutosLocal(agora, cfg.fuso) / 60;
  if (h < 7 || h >= 21) return 0;

  const esperas = await db.esperaHorario.findMany({
    where: { status: "ATIVA", data: { gte: hojeDb }, cliente: { aceitaMensagens: true }, ...so },
    orderBy: { criadoEm: "asc" },
    include: { cliente: { select: { nome: true, telefone: true } } },
  });
  const cache = new Map<string, Awaited<ReturnType<typeof opcoesDoDia>>>();
  let avisados = 0;
  for (const e of esperas) {
    const data = e.data.toISOString().slice(0, 10);
    // Ja marcou algo nesse dia (pelo aviso ou por conta propria): pronto.
    const perto = await db.agendamento.findMany({
      where: { clienteId: e.clienteId, status: { in: ["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO", "CONCLUIDO"] }, inicio: { gte: new Date(+e.data - DIA), lt: new Date(+e.data + 2 * DIA) } },
      select: { inicio: true },
    });
    if (perto.some((a) => dataLocal(a.inicio, cfg.fuso) === data)) {
      await db.esperaHorario.update({ where: { id: e.id }, data: { status: "ATENDIDA" } });
      continue;
    }
    const chave = `${data}|${e.servicoId}|${e.barbeiroId ?? "*"}|${e.periodo}`;
    if (!cache.has(chave)) cache.set(chave, await opcoesDoDia(data, e.servicoId, e.barbeiroId, e.periodo));
    const opcoes = cache.get(chave)!;
    if (!opcoes.length) continue;
    // Justo com a fila: com N horarios livres, avisa no maximo N pessoas a cada 20 min.
    const recentes = await db.esperaHorario.count({
      where: { status: "AVISADA", data: e.data, servicoId: e.servicoId, avisadaEm: { gt: new Date(agora - ESPERA_ENTRE_AVISOS_MS) } },
    });
    if (recentes >= opcoes.length) continue;
    const servico = await db.servico.findUnique({ where: { id: e.servicoId }, select: { nome: true } });
    const texto = TEXTOS.ESPERA({ nome: e.cliente.nome, servico: servico?.nome ?? "o serviço", dia: diaFalado(data, hoje), opcoes: escolherSugestoes(opcoes, 3).map(descreverOpcao) });
    if (await enviarAutomacao({ tipo: "ESPERA_HORARIO", chave: e.id, clienteId: e.clienteId, telefone: e.cliente.telefone, texto })) {
      await db.esperaHorario.update({ where: { id: e.id }, data: { status: "AVISADA", avisadaEm: new Date(agora) } });
      avisados++;
    }
  }
  return avisados;
}

/** Mais frequente de uma lista (barbeiro/servico de costume). */
function maisFrequente<T>(xs: T[]) {
  const n = new Map<T, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export async function processarRetornos(agora: number, opts: { clienteIds?: string[] } = {}) {
  const cfg = await configuracao();
  if (!cfg.retornoAtivo) return 0;
  const hoje = dataLocal(agora, cfg.fuso);
  const so = opts.clienteIds ? { clienteId: { in: opts.clienteIds } } : {};
  const visitas = await db.agendamento.findMany({
    where: { status: "CONCLUIDO", inicio: { gt: new Date(agora - 365 * DIA), lt: new Date(agora) }, cliente: { aceitaMensagens: true }, ...so },
    orderBy: { inicio: "asc" },
    select: { clienteId: true, inicio: true, barbeiroId: true, servicoId: true, assinaturaId: true },
  });
  const porCliente = new Map<string, typeof visitas>();
  for (const v of visitas) porCliente.set(v.clienteId, [...(porCliente.get(v.clienteId) ?? []), v]);

  let enviados = 0;
  for (const [clienteId, vs] of porCliente) {
    if (enviados >= MAX_RETORNOS_POR_RODADA) break;
    const ritmo = ritmoDoCliente(vs.map((v) => +v.inicio));
    if (!ritmo) continue;
    const ultima = vs.at(-1)!;
    if (!retornoDevido(+ultima.inicio, ritmo, agora)) continue;
    const [futuro, espera, sit] = await Promise.all([
      db.agendamento.count({ where: { clienteId, status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date(agora) } } }),
      db.esperaHorario.count({ where: { clienteId, status: "ATIVA" } }),
      db.assinatura.findFirst({ where: { clienteId, status: { in: ["ATIVA", "ATRASADA"] } }, select: { plano: { select: { intervaloMinDias: true } } } }),
    ]);
    if (futuro || espera) continue;
    // Assinante so pode voltar pelo plano depois do intervalo minimo.
    if (sit?.plano.intervaloMinDias && (agora - +ultima.inicio) / DIA < sit.plano.intervaloMinDias - 1) continue;

    const barbeiroId = maisFrequente(vs.slice(-6).map((v) => v.barbeiroId));
    const servicoId = maisFrequente(vs.slice(-6).map((v) => v.servicoId))!;
    const alvo = dataLocal(+ultima.inicio + ritmo * DIA, cfg.fuso);
    const opcoes: string[] = [];
    for (let i = 0; i < 4 && opcoes.length < 2; i++) {
      const d = somarDias(alvo < hoje ? hoje : alvo, i);
      const livres = await opcoesDoDia(d, servicoId, null, "QUALQUER");
      for (const o of escolherSugestoes(livres, 2 - opcoes.length, barbeiroId)) opcoes.push(`${diaFalado(d, hoje)} às ${minParaHhmm(o.minutos)} com ${o.nome}`);
    }
    const [cliente, servico] = await Promise.all([
      db.cliente.findUniqueOrThrow({ where: { id: clienteId }, select: { nome: true, telefone: true } }),
      db.servico.findUnique({ where: { id: servicoId }, select: { nome: true } }),
    ]);
    const texto = TEXTOS.RETORNO({ nome: cliente.nome, dias: Math.floor((agora - +ultima.inicio) / DIA), servico: servico?.nome ?? "corte", opcoes, peloPlano: !!sit });
    if (await enviarAutomacao({ tipo: "RETORNO", chave: `${clienteId}:${ultima.inicio.toISOString()}`, clienteId, telefone: cliente.telefone, texto })) enviados++;
  }
  return enviados;
}

export async function processarIndicacoes(opts: { clienteIds?: string[] } = {}) {
  const premiados = await converterIndicacoes(opts);
  let n = 0;
  for (const p of premiados) {
    const texto = TEXTOS.INDICACAO_CONVERTIDA({ nome: p.indicador.nome, amigo: p.amigo, premio: p.premio });
    if (await enviarAutomacao({ tipo: "INDICACAO", chave: p.indicacaoId, clienteId: p.indicador.id, telefone: p.indicador.telefone, texto })) n++;
  }
  return n;
}
