/**
 * Fluxos de gateways que nao tem fatura hospedada (Pagar.me):
 * - cartao digitado na pagina do BarberOS e tokenizado no navegador;
 * - Pix gerado pelo BarberOS a cada mes.
 * - checkout do plano (/c/assinar/...): abas Cartao | Pix enquanto o 1o mes nao foi pago.
 */
import type { Cobranca } from "@prisma/client";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import type { EstadoCheckout } from "@/lib/pagamentos/checkout-regras";
import { pixVencido } from "@/lib/pagamentos/checkout-regras";
import { gateway, gatewayPorId } from "@/lib/pagamentos/gateway";
import { ErroPagarme, PREFIXO_PIX } from "@/lib/pagamentos/pagarme";
import { cobrancaEmAberto, sincronizarAssinatura, sincronizarCobranca } from "./cobrancas";
import { valorComRetencao } from "./retencao-regras";
import { creditoDoCicloParaPix } from "@/lib/crescimento/credito-assinatura";
import { concluirPagamentoInicial, marcarPagamentoInicialIncerto, reservarPagamentoInicial } from "./operacao-inicial";

/** Gera (e salva) a cobranca Pix de um mes da assinatura. */
export async function gerarPixDoMes(assinaturaId: string, vencimento: string) {
  const data = new Date(`${vencimento}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento) || !Number.isFinite(+data) || data.toISOString().slice(0, 10) !== vencimento) throw new ErroNegocio("Vencimento inválido.");
  const reserva = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal-assinatura:${assinaturaId}`}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal:${assinaturaId}:${vencimento}`}, 0))`;
    const a = await tx.assinatura.findUniqueOrThrow({ where: { id: assinaturaId }, include: { plano: true } });
    if (a.operacaoInicial && !["CRIANDO", "PIX"].includes(a.operacaoInicial)) throw new ErroNegocio("A operação anterior está em conferência. Não é possível emitir outro Pix.", 409, "assinatura_operacao_revisao");
    if (a.status === "CANCELADA" || a.pausadaEm || a.encerraEm) throw new ErroNegocio("Assinatura cancelada, pausada ou em encerramento; confira antes de emitir Pix.", 409, "pix_revisao");
    if (await tx.alteracaoPlanoAssinatura.findFirst({ where: { assinaturaId, estado: { in: ["SOLICITADA", "AGENDADA", "EM_CONFERENCIA"] }, efetivaEm: { lte: data } }, select: { id: true } })) throw new ErroNegocio("Há uma troca de plano para esta renovação. A recepção precisa conferir o pedido antes da emissão.", 409, "troca_em_conferencia");
    if (!a.gatewayId || !a.gatewayClienteId) throw new ErroNegocio("Assinatura sem cadastro no meio de pagamento.");
    const intento = await tx.emissaoPixMensal.findUnique({ where: { assinaturaId_vencimento: { assinaturaId, vencimento: data } } });
    if (intento) {
      if (intento.estado === "CONFIRMADA" && intento.cobrancaId) {
        const c = await tx.cobranca.findUnique({ where: { id: intento.cobrancaId } });
        if (c && c.status !== "CANCELADA") return { existente: c };
      }
      throw new ErroNegocio("Esta mensalidade já tem uma emissão ou resultado incerto. Confira no gateway antes de emitir outro Pix.", 409, "pix_revisao");
    }
    const existente = await tx.cobranca.findFirst({ where: { assinaturaId, vencimento: data, status: { not: "CANCELADA" } } });
    if (existente) return { existente };
    const credito = await creditoDoCicloParaPix(tx, a, vencimento);
    const emissao = await tx.emissaoPixMensal.create({ data: { assinaturaId, vencimento: data } });
    return { a, emissaoId: emissao.id, credito };
  });
  if (reserva.existente) return reserva.existente;
  const { a, emissaoId } = reserva;
  try {
    const g = await gatewayPorId(a.gatewayId!);
    if (!g.criarCobrancaPix) throw new Error(`O gateway ${g.nome} não gera Pix avulso.`);
    const cfg = await configuracao();
    const cob = await g.criarCobrancaPix({
    clienteGatewayId: a.gatewayClienteId!,
    // Desconto de retencao nas mensalidades cobertas.
    valorCentavos: reserva.credito?.valorCentavos ?? valorComRetencao({
      precoCentavos: a.precoCentavos, vencimento,
      pct: a.descontoRetencaoPct, ate: a.descontoRetencaoAte?.toISOString().slice(0, 10) ?? null,
    }),
    vencimento,
    descricao: `${a.plano.nome} - ${cfg.nomeBarbearia}`,
    referencia: a.gatewayId!,
    // Vale do dia em que e gerado ate o fim da tolerancia de atraso.
    validadeHoras: (cfg.toleranciaAtrasoDias + 4) * 24,
    });
    await sincronizarCobranca(cob);
    const c = await db.cobranca.findUniqueOrThrow({ where: { gatewayId: cob.id } });
    if (c.assinaturaId !== assinaturaId || c.vencimento.getTime() !== data.getTime()) throw new Error("Cobrança vinculada a outra assinatura ou competência.");
    await db.emissaoPixMensal.update({ where: { id: emissaoId }, data: { estado: "CONFIRMADA", cobrancaId: c.id } });
    return c;
  } catch {
    // Mesmo timeout ou falha ao salvar pode ocorrer após o gateway ter criado o Pix.
    await db.emissaoPixMensal.updateMany({ where: { id: emissaoId, estado: "EMITINDO" }, data: { estado: "INCERTA" } }).catch(() => {});
    throw new ErroNegocio("Não foi possível confirmar a emissão do Pix. A equipe deve conferir o gateway antes de uma nova tentativa.", 503, "pix_incerto");
  }
}

/** Pix expirado sem pagamento: cancela o antigo e gera outro para o mesmo mes. */
export async function renovarPixSeExpirado(cobrancaId: string) {
  const c = await db.cobranca.findUniqueOrThrow({ where: { id: cobrancaId } });
  if (c.forma !== "PIX" || c.status === "PAGA" || !c.expiraEm || c.expiraEm.getTime() > Date.now() + 3_600_000) return c;
  throw new ErroNegocio("O Pix venceu. A equipe precisa conferir o pagamento no gateway antes de substituir a cobrança.", 409, "pix_revisao");
}

async function assinaturaPorToken(tokenPublico: string) {
  const a = await db.assinatura.findUnique({ where: { tokenPublico }, include: { plano: true, cliente: true } });
  if (!a) throw naoEncontrado("Assinatura");
  return a;
}

/** Somente resposta explícita de validação permite corrigir e reenviar o cartão. */
function erroDeCartao(e: unknown) {
  console.error("[pagamentos] atualização do cartão não confirmada", e instanceof Error ? e.name : "falha");
  if (e instanceof ErroPagarme && [400, 422].includes(e.status)) return new ErroNegocio("O cartão não foi aceito. Confira os dados ou tente outro cartão.", 422, "cartao_recusado");
  return new ErroNegocio("Não foi possível confirmar a atualização do cartão. Peça à equipe para conferir antes de tentar novamente.", 503, "cartao_atualizacao_revisao");
}

/** Assinatura Pix do checkout que ainda nao pagou o 1o mes (pode trocar para cartao). */
const pixPendente = (a: { status: string; gatewayId: string | null; formaPagamento: string }) =>
  a.status === "PENDENTE" && a.formaPagamento === "PIX" && !!a.gatewayId?.startsWith(PREFIXO_PIX);

/** Confere no gateway as cobrancas Pix em aberto (pode ter pago agora ha pouco). */
async function conferirPixEmAberto(assinaturaId: string) {
  const abertas = await db.cobranca.findMany({ where: { assinaturaId, status: { in: ["PENDENTE", "ATRASADA"] } } });
  for (const c of abertas) {
    try {
      await sincronizarCobranca(await (await gatewayPorId(c.gatewayId)).buscarCobranca(c.gatewayId));
    } catch (e) {
      console.error("[assinaturas] conferir Pix", c.gatewayId, e);
    }
  }
  return db.cobranca.findMany({ where: { assinaturaId, status: { in: ["PENDENTE", "ATRASADA"] } } });
}

/**
 * Primeiro pagamento no cartao: cria a assinatura na Pagar.me com o token
 * gerado no navegador. Outra operação só é permitida depois de confirmar o
 * cancelamento da anterior, evitando cobrar um Pix ainda válido e um cartão.
 */
export async function ativarComCartao(tokenPublico: string, cartaoToken: string) {
  const inicial = await assinaturaPorToken(tokenPublico);
  if (inicial.status !== "PENDENTE") {
    if (inicial.status === "CANCELADA") throw new ErroNegocio("Essa assinatura foi cancelada.");
    return trocarCartao(tokenPublico, cartaoToken);
  }
  if (inicial.gatewayId) throw new ErroNegocio("Cancele a operação inicial e aguarde a confirmação antes de escolher outro pagamento.", 409, "assinatura_operacao_revisao");
  const g = await gateway();
  const cfg = await configuracao();
  const a = await reservarPagamentoInicial(inicial.id, "CARTAO");
  let gatewayId: string;
  try {
    gatewayId = await g.criarAssinatura({
      clienteGatewayId: a.gatewayClienteId!,
      valorCentavos: a.precoCentavos,
      forma: "CARTAO",
      primeiroVencimento: dataLocal(Date.now(), cfg.fuso),
      descricao: `${a.plano.nome} - ${cfg.nomeBarbearia}`,
      referencia: a.id,
      cartaoToken,
    });
    // Uma resposta sem a identidade do contrato não comprova que a criação falhou.
    if (typeof gatewayId !== "string" || !gatewayId.trim() || (g.nome === "pagarme" && !/^sub_\S+$/.test(gatewayId))) {
      throw new Error("Contrato de assinatura não identificado.");
    }
  } catch {
    await marcarPagamentoInicialIncerto(a.id);
    throw new ErroNegocio("Não foi possível confirmar a resposta do cartão. Confira a operação antes de tentar novamente.", 503, "assinatura_operacao_revisao");
  }
  try {
    await db.assinatura.update({ where: { id: a.id }, data: { gatewayId } });
    await sincronizarAssinatura(a.id);
    await concluirPagamentoInicial(a.id);
  } catch {
    await marcarPagamentoInicialIncerto(a.id);
    throw new ErroNegocio("Pagamento em conferência. Não faça outra tentativa até atualizar o status.", 503, "assinatura_operacao_revisao");
  }
  return db.assinatura.findUniqueOrThrow({ where: { id: a.id }, select: { status: true } });
}

/** Cartao recusado ou vencido: troca o cartao e reprocessa. */
export async function trocarCartao(tokenPublico: string, cartaoToken: string) {
  const a = await assinaturaPorToken(tokenPublico);
  if (!a.gatewayId || a.formaPagamento !== "CARTAO") throw new ErroNegocio("Essa assinatura não é no cartão.");
  const g = await gatewayPorId(a.gatewayId);
  if (!g.atualizarCartao) throw new ErroNegocio("Troca de cartão indisponível neste meio de pagamento.");
  try {
    await g.atualizarCartao(a.gatewayId, cartaoToken);
  } catch (e) {
    throw erroDeCartao(e);
  }
  await sincronizarAssinatura(a.id);
  return db.assinatura.findUniqueOrThrow({ where: { id: a.id }, select: { status: true } });
}

/**
 * Aba Pix do checkout do plano: a assinatura (ainda sem pagamento) passa a ser Pix e o
 * BarberOS gera o Pix do 1o mes. Ja era Pix: devolve o Pix em aberto (renova se venceu).
 */
export async function pagarPlanoComPix(tokenPublico: string) {
  const a = await assinaturaPorToken(tokenPublico);
  if (a.status === "CANCELADA") throw new ErroNegocio("Essa assinatura foi cancelada.");
  if (a.status !== "PENDENTE") throw new ErroNegocio("Essa assinatura já está paga. ✅", 409, "ja_pago");
  if (!a.plano.formasPagamento.includes("PIX")) throw new ErroNegocio("Esse plano não aceita Pix.");
  if (a.operacaoInicial) throw new ErroNegocio("A operação anterior está em conferência.", 409, "assinatura_operacao_revisao");
  if (pixPendente(a)) {
    const aberta = await cobrancaEmAberto(a.id);
    if (aberta) return renovarPixSeExpirado(aberta.id);
  } else if (a.formaPagamento !== "CARTAO" || a.gatewayId) {
    throw new ErroNegocio("Essa assinatura já tem uma forma de pagamento. Fale com a barbearia.", 409, "forma");
  }
  const g = await gateway();
  if (g.pix !== "avulso" || !a.gatewayClienteId) throw new ErroNegocio("Pix indisponível para esse plano agora.", 409, "indisponivel");
  const cfg = await configuracao();
  await reservarPagamentoInicial(a.id, "PIX");
  try {
    const gatewayId = a.gatewayId ?? (await g.criarAssinatura({
      clienteGatewayId: a.gatewayClienteId, valorCentavos: a.precoCentavos, forma: "PIX",
      primeiroVencimento: dataLocal(Date.now(), cfg.fuso), descricao: `${a.plano.nome} - ${cfg.nomeBarbearia}`, referencia: a.id,
    }));
    await db.assinatura.update({ where: { id: a.id }, data: { formaPagamento: "PIX", gatewayId } });
    const cobranca = await gerarPixDoMes(a.id, dataLocal(Date.now(), cfg.fuso));
    await concluirPagamentoInicial(a.id);
    return cobranca;
  } catch (e) {
    await marcarPagamentoInicialIncerto(a.id);
    const emissao = await db.emissaoPixMensal.findFirst({ where: { assinaturaId: a.id }, select: { id: true } });
    if (emissao) throw new ErroNegocio("A emissão do Pix precisa ser conferida pela equipe antes de tentar novamente.", 503, "pix_revisao");
    console.error("[assinaturas] Pix do checkout não confirmado", e instanceof Error ? e.name : "falha");
    throw new ErroNegocio("Não foi possível confirmar o Pix. A equipe deve conferir antes de outra tentativa.", 502, "assinatura_operacao_revisao");
  }
}

/** Estado do checkout do plano (status da assinatura e o Pix do 1o mes). `conferir`: consulta o gateway. */
export async function checkoutDaAssinatura(tokenPublico: string, conferir = true): Promise<EstadoCheckout> {
  const a = await assinaturaPorToken(tokenPublico);
  if (a.status === "CANCELADA") return { status: "CANCELADO", forma: null, pix: null, link: null };
  if (a.status !== "PENDENTE") return { status: "PAGO", forma: a.formaPagamento === "PIX" ? "PIX" : "CARTAO", pix: null, link: null };
  if (a.operacaoInicial) return { status: "PENDENTE", forma: null, pix: null, link: null, processando: true, mensagem: "Operação em conferência. Aguarde a confirmação antes de escolher outra forma de pagamento." };
  if (!pixPendente(a)) {
    // Contrato enviado continua bloqueado até pagamento ou cancelamento comprovado.
    if (conferir && a.gatewayId && a.formaPagamento === "CARTAO") {
      await sincronizarAssinatura(a.id).catch((e) => console.error("[assinaturas] conferir cartão", a.id, e));
      const atual = await db.assinatura.findUniqueOrThrow({ where: { id: a.id } });
      if (atual.status === "CANCELADA") return { status: "CANCELADO", forma: null, pix: null, link: null };
      if (atual.status !== "PENDENTE") return { status: "PAGO", forma: "CARTAO", pix: null, link: null };
    }
    const ultima = a.gatewayId ? await db.cobranca.findFirst({ where: { assinaturaId: a.id, vinculosExternos: { none: {} } }, orderBy: { criadaEm: "desc" } }) : null;
    const processando = a.formaPagamento === "CARTAO" && !!a.gatewayId;
    const mensagem = processando && ultima?.status === "ATRASADA"
      ? "O primeiro pagamento foi recusado. Cancele a operação abaixo e aguarde a confirmação antes de escolher outro cartão ou Pix."
      : undefined;
    return { status: "PENDENTE", forma: processando ? "CARTAO" : null, pix: null, link: null, processando, mensagem };
  }
  const abertas = conferir
    ? await conferirPixEmAberto(a.id)
    : await db.cobranca.findMany({ where: { assinaturaId: a.id, status: { in: ["PENDENTE", "ATRASADA"] } } });
  if (conferir) {
    const atual = await db.assinatura.findUniqueOrThrow({ where: { id: a.id } });
    if (atual.status === "CANCELADA") return { status: "CANCELADO", forma: null, pix: null, link: null };
    if (atual.status !== "PENDENTE") return { status: "PAGO", forma: "PIX", pix: null, link: null };
  }
  const c: Cobranca | undefined = abertas.find((x) => x.forma === "PIX" && x.pixCopiaECola && !pixVencido(x.expiraEm));
  return {
    status: "PENDENTE", forma: "PIX", link: null,
    pix: c ? { copiaECola: c.pixCopiaECola!, qrUrl: c.pixQrUrl, expiraEm: c.expiraEm?.toISOString() ?? null } : null,
  };
}
