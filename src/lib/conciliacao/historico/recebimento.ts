import type { Prisma } from "@prisma/client";
import { ErroNegocio } from "@/lib/erros";
import { centavosValidos, fonteProvaRecebimento, instanteRecebimento, provaRecebimentoValida } from "@/lib/pagamentos/recebimento";
import { hashConferencia } from "../despesas-hash";
import type { TransacaoHistorica } from "./schemas";
import type { MovimentoHistorico } from "./regras";

type CobrancaComProva = {
  gatewayId: string; valorRecebidoConfirmadoCentavos: number | null; recebidoConfirmadoEm: Date | null;
  provaRecebimento: unknown; recebimentoPendente: string | null;
};
type MovimentoComOrigem = MovimentoHistorico & { idExterno: string; bruto: unknown };
const conflito = () => new ErroNegocio("A cobrança já tem prova de recebimento divergente ou incompleta. Confira a origem antes de conciliar; a prova anterior foi preservada.", 409, "recebimento_historico_divergente");

function mesmaOrigem(cobranca: CobrancaComProva, fonte: TransacaoHistorica, movimento: MovimentoComOrigem) {
  if (fonteProvaRecebimento(cobranca.provaRecebimento) !== "celcash") return false;
  const prova = cobranca.provaRecebimento as Record<string, unknown>;
  const refs = prova.movimentosExternos;
  if (refs !== undefined) {
    if (!Array.isArray(refs) || refs.length !== 1 || !refs[0] || typeof refs[0] !== "object") return false;
    const ref = refs[0] as Record<string, unknown>;
    return ref.id === movimento.id && ref.fonte === "CELCASH" && ref.idExterno === movimento.idExterno && ref.transacaoId === fonte.id;
  }
  return prova.fonte === "celcash" && cobranca.gatewayId === `celtx_${fonte.id}`;
}

export function pendenciaRecebimentoHistorico(fonte: TransacaoHistorica, movimento: Pick<MovimentoHistorico, "data"> | null) {
  const em = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(fonte.pagamentoEfetivoEm ?? "") ? instanteRecebimento(fonte.pagamentoEfetivoEm) : null;
  if (fonte.pagoForaDoGateway) return "Pagamento marcado como externo: o vínculo histórico não comprova recebimento normal pelo gateway. Confira a prova do pagamento externo.";
  if (!em) return "Recebimento pendente: falta a data efetiva do pagamento na Celcash. A data do crédito em saldo não comprova a data efetiva do pagamento.";
  if (+new Date(em) > Date.now() || (movimento && +new Date(em) > +movimento.data)) return "A data efetiva do pagamento é posterior ao crédito ou está no futuro. Confira a divergência antes de reconhecer receita.";
  return null;
}

/** O extrato prova o valor; somente o campo efetivo da transação prova a data do pagamento. */
export function prepararRecebimentoHistorico(fonte: TransacaoHistorica, movimento: MovimentoComOrigem, cobranca: CobrancaComProva, importar: boolean) {
  if (movimento.fonte !== "CELCASH" || movimento.tipo !== "RECEBIMENTO" || movimento.transacaoId !== fonte.id
    || !centavosValidos(movimento.valorCentavos) || movimento.valorCentavos <= 0 || movimento.valorCentavos !== fonte.valorCentavos
    || !Number.isFinite(+movimento.data) || !movimento.idExterno) {
    throw new ErroNegocio("O movimento não comprova um único recebimento Celcash desta transação. Confira o extrato.", 409, "recebimento_historico_invalido");
  }
  const em = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(fonte.pagamentoEfetivoEm ?? "") ? instanteRecebimento(fonte.pagamentoEfetivoEm) : null;
  const pendencia = pendenciaRecebimentoHistorico(fonte, movimento);
  const tinhaProva = cobranca.valorRecebidoConfirmadoCentavos !== null || cobranca.recebidoConfirmadoEm !== null || cobranca.provaRecebimento !== null;
  if (tinhaProva && (!provaRecebimentoValida(cobranca) || !mesmaOrigem(cobranca, fonte, movimento))) throw conflito();
  if (tinhaProva && (cobranca.valorRecebidoConfirmadoCentavos !== movimento.valorCentavos || (em && cobranca.recebidoConfirmadoEm?.toISOString() !== em))) throw conflito();
  if (tinhaProva && pendencia && (em || fonte.pagoForaDoGateway)) throw conflito();
  if (pendencia && importar) throw new ErroNegocio(pendencia, 409, "recebimento_historico_pendente");
  const referenciaMovimento = { id: movimento.id, fonte: movimento.fonte, idExterno: movimento.idExterno, transacaoId: movimento.transacaoId };
  const evidenciaSha256 = hashConferencia({ versao: 1, fonte: { id: fonte.id, contratoId: fonte.contratoId, status: fonte.status, pagamentoEfetivoEm: em, pagoForaDoGateway: fonte.pagoForaDoGateway ?? false }, movimento: { ...referenciaMovimento, tipo: movimento.tipo, valorCentavos: movimento.valorCentavos, creditoEm: movimento.data, brutoHash: hashConferencia(movimento.bruto) } });
  const prova = {
    versao: 1, fonte: "conciliacao", fonteGateway: "celcash", referencia: cobranca.gatewayId, status: fonte.status,
    campoValor: "MovimentoExterno.valorCentavos (Balances.value)", campoData: "Transactions.paydayDateDateTime",
    valorCentavos: movimento.valorCentavos, em: em!, movimentosExternos: [referenciaMovimento], evidenciaSha256,
  } satisfies Prisma.InputJsonObject;
  // Ausência atual do campo não destitui uma prova completa anterior da mesma origem.
  const pendenciaFinal = tinhaProva && !em ? cobranca.recebimentoPendente : pendencia;
  const dados: { recebimentoPendente?: string | null; valorRecebidoConfirmadoCentavos?: number; recebidoConfirmadoEm?: Date; provaRecebimento?: typeof prova } = tinhaProva && !em ? {} : pendencia ? { recebimentoPendente: pendencia }
    : tinhaProva ? { recebimentoPendente: null }
      : { valorRecebidoConfirmadoCentavos: movimento.valorCentavos, recebidoConfirmadoEm: new Date(em!), provaRecebimento: prova, recebimentoPendente: null };
  return { dados, comprovado: !pendenciaFinal, pendencia: pendenciaFinal, evidenciaSha256, movimento: referenciaMovimento };
}
