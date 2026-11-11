/**
 * Assinar, cancelar e consultar a assinatura de um cliente.
 */
import type { FormaPagamento, OrigemAgendamento, Plano, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { configuracao, servicoDoBarbeiro } from "@/lib/agenda/carregar";
import { travarClienteAgenda, type TitularAgenda } from "@/lib/agenda/cliente-identidade";
import { dataLocal } from "@/lib/agenda/tempo";
import { gateway, gatewayPorId, provedorPorId } from "@/lib/pagamentos/gateway";
import { exigirEmissaoDeCobranca } from "@/lib/pagamentos/bloqueio-cobranca";
import { notificarEmSegundoPlano } from "@/lib/whatsapp/conversas";
import { cobrancaEmAberto, linkAbsoluto, novoTokenPublico, sincronizarAssinatura } from "./cobrancas";
import { gerarPixDoMes } from "./cartao-pix";
import { assinaturaValida, cpfValido } from "./regras";
import { estaPausada } from "./retencao-regras";
import { ehCashbarber } from "@/lib/pagamentos/retencao-gateway";
import { concluirPagamentoInicial, marcarPagamentoInicialIncerto, cancelarOperacaoInicial } from "./operacao-inicial";
import { fimDoCicloManual } from "./registro-manual-regras";

/** Assinaturas que ocupam vaga: ativas, atrasadas e pendentes recentes (link ainda valendo). */
const PENDENTE_SEGURA_VAGA_MS = 3 * 86_400_000;

function exigirVenda(plano: Pick<Plano, "ativo" | "visivel" | "compravel" | "vendaSomenteEquipe"> | null, origem?: OrigemAgendamento) {
  if (!plano || !plano.ativo || ((origem === "SITE" || origem === "BOT") && !plano.visivel)) throw naoEncontrado("Plano");
  if (!plano.compravel) throw new ErroNegocio("Este plano está disponível apenas para consulta. Fale com a equipe para conhecer as condições.", 409, "plano_consulta");
  if (plano.vendaSomenteEquipe && origem !== "RECEPCAO" && origem !== "PAINEL") throw new ErroNegocio("A contratação deste plano é feita somente pela recepção. Posso chamar a equipe para ajudar.", 409, "plano_venda_equipe");
}

/** Verificação inicial, antes de cadastrar um novo cliente; a transação revalida sob trava. */
export async function verificarNovaAdesao(planoId: string, origem: OrigemAgendamento) {
  exigirEmissaoDeCobranca();
  const plano = await db.plano.findUnique({ where: { id: planoId } });
  exigirVenda(plano, origem);
}

export async function vagasRestantes(plano: Pick<Plano, "id" | "vagas">) {
  if (plano.vagas === null) return null;
  const ocupadas = await db.assinatura.count({
    where: {
      planoId: plano.id,
      OR: [{ status: { in: ["ATIVA", "ATRASADA"] } }, { status: "PENDENTE", criadaEm: { gt: new Date(Date.now() - PENDENTE_SEGURA_VAGA_MS) } }],
    },
  });
  return Math.max(0, plano.vagas - ocupadas);
}

/** Assinatura atual do cliente (a mais recente que nao foi cancelada) e se ela vale agora. */
export async function situacaoDoCliente(clienteId: string, c: typeof db | Prisma.TransactionClient = db) {
  const cfg = await configuracao(c);
  const a = await c.assinatura.findFirst({
    where: { clienteId, status: { not: "CANCELADA" } },
    orderBy: { criadaEm: "desc" },
    include: { plano: { include: { servicos: { include: { servico: true } }, barbeiros: true } } },
  });
  if (!a) return null;
  const agora = Date.now();
  const hoje = dataLocal(agora, cfg.fuso);
  const aberta = await cobrancaEmAberto(a.id, c);
  const pausada = estaPausada({
    pausadaEm: a.pausadaEm, pausadaAte: a.pausadaAte?.toISOString().slice(0, 10) ?? null, hoje,
  });
  const vencida = await c.cobranca.findFirst({
    where: { assinaturaId: a.id, status: { in: ["ATRASADA", "ESTORNADA"] }, vinculosExternos: { none: {} } },
    orderBy: { vencimento: "asc" },
  });
  const fimManual = fimDoCicloManual(a);
  const manualForaDaVigencia = fimManual !== null && (!a.cicloInicio || a.cicloInicio.getTime() > agora || fimManual < hoje);
  return {
    assinatura: a.status === "ATIVA" && manualForaDaVigencia ? { ...a, status: "ATRASADA" as const } : a,
    pausada,
    // Pausado: nao usa o plano ate a pausa acabar.
    valida: !manualForaDaVigencia && !pausada && assinaturaValida({
      status: a.status,
      vencimentoMaisAntigoEmAberto: vencida?.vencimento.getTime() ?? null,
      toleranciaDias: cfg.toleranciaAtrasoDias,
      agora,
    }),
    cobrancaEmAberto: aberta ? { ...aberta, link: linkAbsoluto(aberta.link) } : null,
  };
}

/**
 * Cria a assinatura no gateway e devolve o link da primeira cobranca. Se ja
 * existe uma pendente do mesmo plano, reaproveita (cliente que perdeu o link).
 */
export async function assinar(p: {
  clienteId: string;
  planoId: string;
  forma: FormaPagamento;
  cpf?: string;
  email?: string;
  origem: OrigemAgendamento;
  usuarioId?: string | null;
  titular?: TitularAgenda;
}) {
  const cfg = await configuracao();
  const cliente = await db.cliente.findUnique({ where: { id: p.clienteId } });
  if (!cliente || cliente.excluidoEm) {
    if (p.titular) throw new ErroNegocio("Sua sessão mudou. Entre novamente para continuar.", 401, "sessao_invalida");
    throw naoEncontrado("Cliente ativo");
  }
  if (!cliente.nome.trim()) throw new ErroNegocio("Informe o nome do cliente antes de assinar.");
  const plano = await db.plano.findUnique({ where: { id: p.planoId } });
  if (!plano || !plano.ativo) throw naoEncontrado("Plano");
  if (!plano.formasPagamento.includes(p.forma)) throw new ErroNegocio("Essa forma de pagamento não está disponível para esse plano.");

  const atual = await situacaoDoCliente(cliente.id);
  if (atual) {
    if (atual.assinatura.operacaoInicial) throw new ErroNegocio("A operação anterior está em conferência. Aguarde a confirmação antes de tentar outra forma de pagamento.", 409, "assinatura_operacao_revisao");
    if (atual.assinatura.status === "PENDENTE" && await db.emissaoPixMensal.findFirst({ where: { assinaturaId: atual.assinatura.id, estado: { in: ["EMITINDO", "INCERTA"] } }, select: { id: true } })) {
      throw new ErroNegocio("A emissão do Pix precisa ser conferida pela equipe antes de tentar novamente.", 409, "pix_revisao");
    }
    const linkPendente =
      atual.cobrancaEmAberto?.link ?? (atual.assinatura.tokenPublico ? linkAbsoluto(`/c/assinar/${atual.assinatura.tokenPublico}`) : null);
    if (atual.assinatura.status === "PENDENTE" && atual.assinatura.planoId === plano.id && atual.assinatura.formaPagamento === p.forma && linkPendente) {
      return { assinatura: atual.assinatura, link: linkPendente, reaproveitada: true };
    }
    if (atual.assinatura.status !== "PENDENTE") {
      throw new ErroNegocio(`Esse cliente já tem o ${atual.assinatura.plano.nome} (${atual.assinatura.status.toLowerCase()}).`, 409, "ja_assinante");
    }
    // Não é seguro cancelar no gateway antes de garantir a nova adesão. A equipe
    // deve resolver a pendência; a troca automática exige reconciliação entre gateways.
    throw new ErroNegocio("Existe uma assinatura pendente. Conclua o pagamento ou fale com a equipe antes de solicitar uma nova assinatura.", 409, "assinatura_pendente");
  }

  exigirVenda(plano, p.origem);

  const vagas = await vagasRestantes(plano);
  if (vagas !== null && vagas <= 0) {
    throw new ErroNegocio(`As vagas do ${plano.nome} estão esgotadas no momento.`, 409, "sem_vagas");
  }

  const g = await gateway();
  exigirEmissaoDeCobranca(g.nome);
  const { assinatura, clienteConfirmado, cpf, email } = await db.$transaction(async (tx) => {
    // Exclusão e revogação de sessão ganham ou perdem antes de qualquer adesão.
    try { await travarClienteAgenda(tx, cliente.id, p.titular); }
    catch (e) {
      if (p.titular && e instanceof ErroNegocio && [401, 404].includes(e.status)) throw new ErroNegocio("Sua sessão mudou. Entre novamente para continuar.", 401, "sessao_invalida");
      throw e;
    }
    await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${cliente.id} FOR UPDATE`;
    const clienteConfirmado = await tx.cliente.findUniqueOrThrow({ where: { id: cliente.id } });
    if (!clienteConfirmado.nome.trim()) throw new ErroNegocio("Informe o nome do cliente antes de assinar.");
    const email = (p.email ?? clienteConfirmado.email ?? "").trim().toLowerCase();
    if (g.exigeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ErroNegocio("Para assinar precisamos de um e-mail válido (exigência do meio de pagamento).", 422, "email");
    const cpf = (p.cpf ?? clienteConfirmado.cpf ?? "").replace(/\D/g, "");
    if (!cpfValido(cpf)) throw new ErroNegocio("Para assinar precisamos de um CPF válido (exigência do meio de pagamento).", 422, "cpf");
    // Evita duas adesões concorrentes do mesmo cliente, mesmo em planos diferentes.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assinatura-cliente:${cliente.id}`}, 0))`;
    // O cadastro de plano também obtém este lock ao alterar as condições de venda.
    await tx.$queryRaw`SELECT id FROM planos WHERE id = ${plano.id} FOR UPDATE`;
    const corrente = await tx.plano.findUnique({ where: { id: plano.id } });
    exigirVenda(corrente, p.origem);
    if (!corrente || corrente.precoCentavos !== plano.precoCentavos || !corrente.formasPagamento.includes(p.forma)) {
      throw new ErroNegocio("As condições do plano mudaram. Atualize antes de continuar.", 409, "plano_alterado");
    }
    if (await tx.assinatura.findFirst({ where: { clienteId: cliente.id, status: { not: "CANCELADA" } }, select: { id: true } })) {
      throw new ErroNegocio("Já existe uma assinatura para este cliente. Atualize a tela e consulte a equipe antes de continuar.", 409, "assinatura_existente");
    }
    if (corrente.vagas !== null) {
      const ocupadas = await tx.assinatura.count({ where: { planoId: corrente.id, OR: [
        { status: { in: ["ATIVA", "ATRASADA"] } },
        { status: "PENDENTE", criadaEm: { gt: new Date(Date.now() - PENDENTE_SEGURA_VAGA_MS) } },
      ] } });
      if (ocupadas >= corrente.vagas) throw new ErroNegocio(`As vagas do ${corrente.nome} estão esgotadas no momento.`, 409, "sem_vagas");
    }
    if (cpf !== clienteConfirmado.cpf || (email && email !== clienteConfirmado.email)) {
      await tx.cliente.update({ where: { id: cliente.id }, data: { cpf, ...(email ? { email } : {}) } });
    }
    const assinatura = await tx.assinatura.create({ data: {
      clienteId: cliente.id, planoId: plano.id, formaPagamento: p.forma, precoCentavos: plano.precoCentavos,
      origem: p.origem, tokenPublico: novoTokenPublico(), operacaoInicial: "CRIANDO",
    } });
    return { assinatura, clienteConfirmado, cpf, email };
  });

  let linkCartao: string | null = null;
  try {
    const anteriores = await db.assinatura.findMany({
      where: { clienteId: cliente.id, gatewayClienteId: { not: null } },
      select: { gatewayClienteId: true },
      orderBy: { criadaEm: "desc" },
    });
    // So reaproveita o cadastro do mesmo gateway (cliente antigo da Celcash vira cliente novo na Pagar.me).
    const anterior = anteriores.find((x) => provedorPorId(x.gatewayClienteId!) === g.nome);
    const gatewayClienteId =
      anterior?.gatewayClienteId ??
      (await g.criarCliente({ nome: clienteConfirmado.nome, cpf, telefone: clienteConfirmado.telefone, email: email || null, referencia: cliente.id }));
    if (p.forma === "CARTAO" && g.cartao === "token") {
      // O cliente digita o cartao na pagina do BarberOS; a assinatura no gateway nasce la.
      await db.assinatura.update({ where: { id: assinatura.id }, data: { gatewayClienteId } });
      linkCartao = linkAbsoluto(`/c/assinar/${assinatura.tokenPublico}`);
    } else {
      const gatewayId = await g.criarAssinatura({
        clienteGatewayId: gatewayClienteId,
        valorCentavos: plano.precoCentavos,
        forma: p.forma,
        primeiroVencimento: dataLocal(Date.now(), cfg.fuso),
        descricao: `${plano.nome} - ${cfg.nomeBarbearia}`,
        referencia: assinatura.id,
      });
      await db.assinatura.update({ where: { id: assinatura.id }, data: { gatewayId, gatewayClienteId } });
      // Pix sem recorrencia no gateway: o BarberOS gera o Pix do primeiro mes.
      if (p.forma === "PIX" && g.pix === "avulso") await gerarPixDoMes(assinatura.id, dataLocal(Date.now(), cfg.fuso));
      else await sincronizarAssinatura(assinatura.id);
    }
  } catch (e) {
    await marcarPagamentoInicialIncerto(assinatura.id);
    const emissao = await db.emissaoPixMensal.findFirst({ where: { assinaturaId: assinatura.id }, select: { id: true } });
    if (emissao) throw new ErroNegocio("A emissão do Pix precisa ser conferida pela equipe antes de tentar novamente.", 503, "pix_revisao");
    console.error("[assinaturas] resultado da criação não confirmado", e instanceof Error ? e.name : "falha");
    throw new ErroNegocio("Não foi possível confirmar a criação da cobrança. A equipe deve conferir antes de uma nova tentativa.", 502, "assinatura_operacao_revisao");
  }
  await concluirPagamentoInicial(assinatura.id);

  await db.$transaction(async (tx) => {
    await auditar(tx, p.usuarioId ?? null, "assinar", "assinatura", assinatura.id, { planoId: plano.id, forma: p.forma, origem: p.origem });
    await tx.listaEsperaPlano.deleteMany({ where: { planoId: plano.id, clienteId: cliente.id } });
  });
  const aberta = await cobrancaEmAberto(assinatura.id);
  return { assinatura, link: linkCartao ?? linkAbsoluto(aberta?.link ?? null), reaproveitada: false };
}

/**
 * Cancela no gateway e aqui. Horarios futuros que estavam pelo plano viram
 * avulsos (preco normal). Abre vaga: avisa o primeiro da lista de espera.
 */
export async function cancelar(
  assinaturaId: string,
  motivo: string,
  usuarioId: string | null,
  opts: { avisar?: boolean; semGateway?: boolean } = {},
) {
  const a = await db.assinatura.findUnique({ where: { id: assinaturaId }, include: { cliente: true, plano: true } });
  if (!a) throw naoEncontrado("Assinatura");
  if (a.status === "CANCELADA") return a;
  if (a.status === "PENDENTE" && !a.ativadaEm) {
    const resultado = await cancelarOperacaoInicial(a.id, usuarioId);
    if (!resultado.cancelada) throw new ErroNegocio("Cancelamento em conferência. O pagamento anterior precisa ser encerrado no provedor antes de uma nova adesão.", 409, "assinatura_operacao_revisao");
    return a;
  }
  // CashBarber cobra por la (a equipe cancela no CashBarber); encerramento agendado ja parou a recorrencia.
  if (a.gatewayId && !opts.semGateway && !a.encerraEm && !ehCashbarber(a.gatewayId)) {
    try {
      await (await gatewayPorId(a.gatewayId)).cancelarAssinatura(a.gatewayId);
    } catch (e) {
      console.error("[assinaturas] falha ao cancelar no gateway:", e);
      throw new ErroNegocio("Não foi possível cancelar no meio de pagamento. Tente de novo.", 502, "gateway");
    }
  }
  const futuros = await db.$transaction(async (tx) => {
    // Espera reservas/alterações em voo antes de encerrar a cobertura e recalcular os futuros.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${a.clienteId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal-assinatura:${a.id}`}, 0))`;
    const atual = await tx.assinatura.findUniqueOrThrow({ where: { id: a.id } });
    if (atual.status === "CANCELADA") return [];
    if (atual.gatewayId?.startsWith("pixrec_")) {
      const aberto = await tx.cobranca.findFirst({ where: { assinaturaId: a.id, forma: "PIX", status: { in: ["PENDENTE", "ATRASADA"] } } });
      const emissao = await tx.emissaoPixMensal.findFirst({ where: { assinaturaId: a.id, estado: { in: ["EMITINDO", "INCERTA"] } } });
      if (aberto || emissao) throw new ErroNegocio("Há Pix em aberto ou em verificação. A equipe precisa conferir no gateway antes de cancelar.", 409, "pix_revisao");
    }
    const futuros = await tx.agendamento.findMany({
      where: { assinaturaId: a.id, inicio: { gt: new Date() }, status: { in: ["MARCADO", "CONFIRMADO"] } },
    });
    await tx.assinatura.update({ where: { id: a.id }, data: { status: "CANCELADA", canceladaEm: new Date(), motivoCancelamento: motivo } });
    await tx.cobranca.updateMany({ where: { assinaturaId: a.id, status: { in: ["PENDENTE", "ATRASADA"] } }, data: { status: "CANCELADA" } });
    for (const ag of futuros) {
      const sb = await servicoDoBarbeiro(ag.barbeiroId, ag.servicoId, tx);
      await tx.agendamento.update({ where: { id: ag.id }, data: { assinaturaId: null, precoCentavos: sb?.precoCentavos ?? ag.precoCentavos } });
    }
    await auditar(tx, usuarioId, "cancelar", "assinatura", a.id, { motivo });
    return futuros;
  });
  publicar({ tipo: "agenda", barbeiroIds: [...new Set(futuros.map((f) => f.barbeiroId))], datas: [] });

  if (opts.avisar !== false && a.status !== "PENDENTE") {
    notificarEmSegundoPlano(
      a.cliente.telefone,
      `Oi, ${a.cliente.nome.split(" ")[0]}! Seu ${a.plano.nome} foi cancelado.` +
        (futuros.length ? " Os horários que você já tinha marcado continuam, agora como avulsos." : "") +
        " Se mudar de ideia, é só chamar aqui. 💈",
    );
  }
  if (a.status !== "PENDENTE") await avisarListaEspera(a.planoId);
  return a;
}

/** Vaga abriu: avisa o primeiro da fila que ainda nao foi avisado. */
async function avisarListaEspera(planoId: string) {
  const plano = await db.plano.findUniqueOrThrow({ where: { id: planoId } });
  if (!plano.ativo || !plano.visivel || !plano.compravel || plano.vendaSomenteEquipe) return;
  if ((await vagasRestantes(plano)) === 0) return;
  const primeiro = await db.listaEsperaPlano.findFirst({
    where: { planoId, avisadoEm: null },
    orderBy: { criadoEm: "asc" },
    include: { cliente: true },
  });
  if (!primeiro) return;
  await db.listaEsperaPlano.update({ where: { id: primeiro.id }, data: { avisadoEm: new Date() } });
  notificarEmSegundoPlano(
    primeiro.cliente.telefone,
    `Oi, ${primeiro.cliente.nome.split(" ")[0]}! Abriu uma vaga no ${plano.nome} que você queria. Quer garantir? É só responder aqui que eu te mando o link. 💈`,
  );
}

export async function entrarNaListaDeEspera(clienteId: string, planoId: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM planos WHERE id = ${planoId} FOR UPDATE`;
    const plano = await tx.plano.findUnique({ where: { id: planoId } });
    exigirVenda(plano, "SITE");
    await tx.listaEsperaPlano.upsert({
      where: { planoId_clienteId: { planoId, clienteId } },
      create: { planoId, clienteId },
      update: {},
    });
    return tx.listaEsperaPlano.count({ where: { planoId, avisadoEm: null } });
  });
}
