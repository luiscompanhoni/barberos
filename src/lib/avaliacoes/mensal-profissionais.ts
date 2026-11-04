/**
 * Consulta interna não conectada a rotas, mensagens ou votos. A relação entre
 * cliente e atendimentos deve permanecer na fronteira de elegibilidade.
 */
import { db } from "@/lib/db";
import { dataLocal, instanteLocal } from "@/lib/agenda/tempo";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";

const FUSO = "America/Sao_Paulo";

/** Mês de atendimento anterior ao pagamento, considerado no fuso da Black. */
export function periodoAnteriorAoPagamento(pagaEm: Date) {
  if (!Number.isFinite(+pagaEm)) throw new ErroNegocio("Pagamento sem data válida.");
  const mesPagamento = dataLocal(pagaEm, FUSO).slice(0, 7);
  const [ano, mes] = mesPagamento.split("-").map(Number);
  const inicioAtual = new Date(Date.UTC(ano, mes - 1, 1));
  const inicioAnterior = new Date(Date.UTC(ano, mes - 2, 1));
  const referencia = inicioAnterior.toISOString().slice(0, 7);
  return {
    competencia: referencia,
    inicio: new Date(instanteLocal(`${referencia}-01`, 0, FUSO)),
    fimExclusivo: new Date(instanteLocal(`${inicioAtual.toISOString().slice(0, 7)}-01`, 0, FUSO)),
  };
}

/** A lista não autoriza votos nem é prova de anonimato. */
export async function listarProfissionaisAvaliaveis(clienteId: string, cobrancaId: string, agora = new Date()) {
  const cobranca = await db.cobranca.findFirst({
    where: { id: cobrancaId, assinatura: { clienteId, cliente: { excluidoEm: null } } },
    select: { status: true, pagaEm: true },
  });
  if (!cobranca) throw naoEncontrado("Cobrança");
  if (cobranca.status !== "PAGA" || !cobranca.pagaEm || +cobranca.pagaEm > +agora) {
    throw new ErroNegocio("A mensalidade ainda não está paga.", 409, "mensalidade_nao_paga");
  }
  const periodo = periodoAnteriorAoPagamento(cobranca.pagaEm);
  const atendimentos = await db.agendamento.findMany({
    where: { clienteId, status: "CONCLUIDO", inicio: { gte: periodo.inicio, lt: periodo.fimExclusivo } },
    distinct: ["barbeiroId"],
    select: { barbeiroId: true, barbeiro: { select: { id: true, nome: true } } },
  });
  return { competencia: periodo.competencia, profissionais: atendimentos.map((a) => a.barbeiro) };
}
