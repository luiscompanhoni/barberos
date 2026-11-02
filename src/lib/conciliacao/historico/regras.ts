import type { EscolhaHistorico, TransacaoHistorica } from "./schemas";
import { cpfValido } from "@/lib/assinaturas/regras";

export const digitos = (s: string | null) => (s ?? "").replace(/\D/g, "");
export const nomeNormal = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
export function telefoneNormal(s: string) {
  let d = digitos(s);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d.length === 11 ? `55${d}` : "";
}
export const gatewayHistorico = (id: string) => `celcash:pag:${id}`;
export const gatewaysDaTransacao = (id: string) => [gatewayHistorico(id), `celtx_${id}`];
export function cpfsParaBusca(cpf: string | null) {
  const d = digitos(cpf);
  return cpfValido(d) ? [...new Set([cpf!, d, `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`])] : [];
}

export type MovimentoHistorico = {
  id: string; fonte: string; tipo: string; transacaoId: string | null; valorCentavos: number; data: Date;
};
export type CobrancaHistorica = {
  id: string; assinaturaId: string; gatewayId: string; valorCentavos: number; vencimento: Date;
  status: string; pagaEm: Date | null; atualizadaEm: Date;
};
export type ClienteHistorico = { id: string; nome: string; cpf: string | null; telefone: string };
export type VinculoHistorico = { id: string; transacaoId: string; cobrancaId: string; estornoMovimentoId: string | null; pedidoEstornoId: string | null };
export type ContextoHistorico = {
  fonte: TransacaoHistorica; movimentos: MovimentoHistorico[];
  assinatura: { id: string; clienteId: string; status: string; gatewayId: string | null; cliente: ClienteHistorico };
  cobrancas: CobrancaHistorica[]; canonicas: CobrancaHistorica[]; vinculos: VinculoHistorico[];
  clientesMesmoCpf: { id: string }[];
  pedidos: { id: string; referenciaId: string; status: string; valorCentavos: number; executadoEm: Date | null }[];
};

/** CPF exato ou nome + telefone concordantes. Telefone sozinho nunca resolve homonimo/apelido. */
export function identidadeComprovada(fonte: TransacaoHistorica, cliente: ClienteHistorico) {
  const cpfFonte = digitos(fonte.cliente.cpf), cpfCliente = digitos(cliente.cpf);
  if (cpfFonte.length === 11 && cpfCliente.length === 11 && cpfFonte !== cpfCliente) return false;
  if (cpfFonte === cpfCliente && cpfValido(cpfFonte)) return true;
  return !!nomeNormal(fonte.cliente.nome) && nomeNormal(fonte.cliente.nome) === nomeNormal(cliente.nome)
    && fonte.cliente.telefones.some((t) => !!telefoneNormal(t) && telefoneNormal(t) === telefoneNormal(cliente.telefone));
}

export function backupApto(b: { restaurado: boolean; erro: string | null; criadoEm: Date; bytes: bigint | number } | null, agora = Date.now()) {
  return !!b && b.restaurado && !b.erro && b.bytes > 0 && +b.criadoEm <= agora && agora - +b.criadoEm <= 2 * 3_600_000;
}

/** Calcula a correcao sem escrever. Datas/valores existentes nunca sao substituidos pelo pareamento. */
export function planejarHistorico(p: EscolhaHistorico, c: ContextoHistorico) {
  const bloqueios: string[] = [], avisos: string[] = [];
  const recebimentos = c.movimentos.filter((m) => m.fonte === "CELCASH" && m.transacaoId === p.transacaoId && m.tipo === "RECEBIMENTO");
  const estornos = c.movimentos.filter((m) => m.fonte === "CELCASH" && m.transacaoId === p.transacaoId && m.tipo === "ESTORNO");
  const recebimento = recebimentos.length === 1 ? recebimentos[0] : null;
  const estorno = estornos.length === 1 ? estornos[0] : null;
  if (c.fonte.id !== p.transacaoId) bloqueios.push("O código consultado não corresponde à origem.");
  if (!c.fonte.contratoId || !c.fonte.cliente.nome.trim()) bloqueios.push("A fonte precisa comprovar um contrato de assinatura e seu titular; cobrança avulsa não pode virar mensalidade.");
  if (c.clientesMesmoCpf.some((x) => x.id !== c.assinatura.clienteId)) bloqueios.push("O CPF também pertence a outro cadastro. Resolva a duplicidade de clientes antes de conciliar.");
  if (!recebimento || recebimento.valorCentavos <= 0 || recebimento.valorCentavos !== c.fonte.valorCentavos) {
    bloqueios.push("É necessário um único crédito no extrato Celcash, do mesmo código e valor. Sincronize o extrato antes.");
  }
  const estornadaNaFonte = ["reversed", "chargeback"].includes(c.fonte.status);
  if (c.assinatura.gatewayId?.startsWith("celsub_") && c.assinatura.gatewayId !== `celsub_${c.fonte.contratoId}`) bloqueios.push("A assinatura de destino representa outro contrato Celcash. Escolha a assinatura correspondente.");
  const pagaNaFonte = ["captured", "payedBoleto", "payedPix", "lessValueBoleto", "moreValueBoleto", "paidDuplicityBoleto"].includes(c.fonte.status);
  if (!pagaNaFonte && !estornadaNaFonte) bloqueios.push("O status da fonte não comprova recebimento pela Celcash.");
  const registrarEstorno = p.operacao === "ESTORNO" || (p.operacao === "IMPORTAR" && estornadaNaFonte);
  if (registrarEstorno && (!estornadaNaFonte || !estorno || !recebimento || estorno.valorCentavos !== -recebimento.valorCentavos || +estorno.data < +recebimento.data)) {
    bloqueios.push("O estorno exige status estornado e uma única saída integral posterior ao recebimento, com o mesmo código.");
  }
  if (!estornadaNaFonte && estornos.length) bloqueios.push("Há estorno no extrato e status pago na fonte. Resolva a divergência antes.");
  const identidade = identidadeComprovada(c.fonte, c.assinatura.cliente);
  if (!identidade) {
    avisos.push("A identidade não foi comprovada automaticamente. Confira nome, CPF e telefone e descreva sua decisão.");
    if (!p.identidadeConfirmada) bloqueios.push("A associação do cliente precisa da sua confirmação de identidade.");
  }
  const cobranca = p.cobrancaId ? c.cobrancas.find((x) => x.id === p.cobrancaId) : null;
  if (p.operacao === "VINCULAR" && estornadaNaFonte) bloqueios.push("A fonte já foi estornada. Escolha registrar o estorno realizado; cobranças já estornadas exigem conferir o registro existente.");
  const vinculo = c.vinculos.find((x) => x.transacaoId === p.transacaoId);
  if (vinculo && (p.operacao === "IMPORTAR" || vinculo.cobrancaId !== p.cobrancaId)) bloqueios.push("Essa transação já está vinculada. Use a cobrança existente.");
  if (p.operacao === "IMPORTAR") {
    if (p.cobrancaId) bloqueios.push("Selecione inclusão ou uma cobrança existente, não ambos.");
    if (c.canonicas.length) bloqueios.push("O código da transação já está no BarberOS. Vincule a cobrança existente.");
    // Impede pares por proximidade de meses; um ciclo igual exige tratar o registro existente.
    if (c.cobrancas.some((x) => x.valorCentavos === c.fonte.valorCentavos &&
      (x.vencimento.toISOString().slice(0, 10) === c.fonte.vencimento || (!!x.pagaEm && !!recebimento && diaSp(x.pagaEm) === diaSp(recebimento.data))))) {
      bloqueios.push("Já existe cobrança do mesmo cliente/valor no vencimento ou no dia do crédito. Confira e vincule a existente.");
    }
  } else {
    if (!cobranca) bloqueios.push("Escolha uma cobrança pertencente ao cliente da assinatura selecionada.");
    if (cobranca) {
      if (!["PAGA", "ESTORNADA"].includes(cobranca.status)) bloqueios.push("Só cobranças já pagas ou estornadas podem receber vínculo histórico.");
      if (cobranca.status === "ESTORNADA" && !estornadaNaFonte) bloqueios.push("A cobrança está estornada no BarberOS, mas a Celcash informa pagamento. Resolva a divergência antes de vincular.");
      if (cobranca.valorCentavos !== c.fonte.valorCentavos) bloqueios.push("O valor da cobrança difere da fonte. Nenhum valor será sobrescrito.");
      if (!cobranca.pagaEm) bloqueios.push("A cobrança existente não tem data de pagamento. Confira esse dado antes do vínculo.");
      if (!cobranca.gatewayId.startsWith("cashbarber:pag:") && !gatewaysDaTransacao(p.transacaoId).includes(cobranca.gatewayId)) bloqueios.push("A cobrança já tem outra origem. O vínculo existente será preservado.");
      if (cobranca.gatewayId.startsWith("cashbarber:pag:")) {
        const correspondentes = c.cobrancas.filter((x) => x.gatewayId.startsWith("cashbarber:pag:") && x.valorCentavos === c.fonte.valorCentavos &&
          x.vencimento.toISOString().slice(0, 10) === c.fonte.vencimento && x.pagaEm && recebimento && diaSp(x.pagaEm) === diaSp(recebimento.data));
        if (!correspondentes.some((x) => x.id === cobranca.id)) bloqueios.push("O vencimento e o dia de pagamento da cobrança Cash Barber precisam corresponder à fonte. O vínculo não foi comprovado.");
        if (correspondentes.length > 1) bloqueios.push("Há mais de uma cobrança Cash Barber com os mesmos dados. Resolva a duplicidade antes de vincular.");
      }
      if (c.canonicas.some((x) => x.id !== cobranca.id)) bloqueios.push("Outra cobrança já usa esse código Celcash.");
      if (c.vinculos.some((x) => x.cobrancaId === cobranca.id && x.transacaoId !== p.transacaoId)) bloqueios.push("Essa cobrança já representa outra transação Celcash.");
      if (c.pedidos.some((x) => x.referenciaId === cobranca.id && x.status !== "RECUSADO")) bloqueios.push("A cobrança já possui pedido de estorno ativo, efetivo ou passível de nova tentativa. Confira esse pedido antes.");
      if (registrarEstorno && cobranca.status === "ESTORNADA") bloqueios.push("A cobrança já está estornada. Confira seu registro de devolução antes de criar outro.");
      if (cobranca.vencimento.toISOString().slice(0, 10) !== c.fonte.vencimento) avisos.push("O vencimento existente difere da fonte e será preservado.");
      if (cobranca.pagaEm && recebimento && diaSp(cobranca.pagaEm) !== diaSp(recebimento.data)) avisos.push("A data paga existente difere do crédito Celcash e será preservada.");
    }
  }
  if (c.assinatura.status === "CANCELADA") avisos.push("A assinatura continuará cancelada. Esta operação corrige somente o histórico financeiro.");
  return { bloqueios, avisos, identidade, recebimento, estorno, registrarEstorno, cobranca: cobranca ?? null };
}

function diaSp(d: Date) { return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(d); }
