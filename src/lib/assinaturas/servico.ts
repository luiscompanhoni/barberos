/**
 * Assinar, cancelar e consultar a assinatura de um cliente.
 */
import type { FormaPagamento, OrigemAgendamento, Plano } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { configuracao, servicoDoBarbeiro } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { gateway } from "@/lib/pagamentos/gateway";
import { notificarEmSegundoPlano } from "@/lib/whatsapp/conversas";
import { cobrancaEmAberto, linkAbsoluto, novoTokenPublico, sincronizarAssinatura } from "./cobrancas";
import { gerarPixDoMes } from "./cartao-pix";
import { assinaturaValida, cpfValido } from "./regras";

/** Assinaturas que ocupam vaga: ativas, atrasadas e pendentes recentes (link ainda valendo). */
const PENDENTE_SEGURA_VAGA_MS = 3 * 86_400_000;

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
export async function situacaoDoCliente(clienteId: string) {
  const cfg = await configuracao();
  const a = await db.assinatura.findFirst({
    where: { clienteId, status: { not: "CANCELADA" } },
    orderBy: { criadaEm: "desc" },
    include: { plano: { include: { servicos: { include: { servico: true } }, barbeiros: true } } },
  });
  if (!a) return null;
  const aberta = await cobrancaEmAberto(a.id);
  const vencida = await db.cobranca.findFirst({
    where: { assinaturaId: a.id, status: { in: ["ATRASADA", "ESTORNADA"] } },
    orderBy: { vencimento: "asc" },
  });
  return {
    assinatura: a,
    valida: assinaturaValida({
      status: a.status,
      vencimentoMaisAntigoEmAberto: vencida?.vencimento.getTime() ?? null,
      toleranciaDias: cfg.toleranciaAtrasoDias,
      agora: Date.now(),
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
}) {
  const cfg = await configuracao();
  const cliente = await db.cliente.findUnique({ where: { id: p.clienteId } });
  if (!cliente) throw naoEncontrado("Cliente");
  if (!cliente.nome.trim()) throw new ErroNegocio("Informe o nome do cliente antes de assinar.");
  const plano = await db.plano.findUnique({ where: { id: p.planoId } });
  if (!plano || !plano.ativo) throw naoEncontrado("Plano");
  if (!plano.formasPagamento.includes(p.forma)) throw new ErroNegocio("Essa forma de pagamento não está disponível para esse plano.");

  const atual = await situacaoDoCliente(cliente.id);
  if (atual) {
    const linkPendente =
      atual.cobrancaEmAberto?.link ?? (atual.assinatura.tokenPublico ? linkAbsoluto(`/c/assinar/${atual.assinatura.tokenPublico}`) : null);
    if (atual.assinatura.status === "PENDENTE" && atual.assinatura.planoId === plano.id && atual.assinatura.formaPagamento === p.forma && linkPendente) {
      return { assinatura: atual.assinatura, link: linkPendente, reaproveitada: true };
    }
    if (atual.assinatura.status !== "PENDENTE") {
      throw new ErroNegocio(`Esse cliente já tem o ${atual.assinatura.plano.nome} (${atual.assinatura.status.toLowerCase()}).`, 409, "ja_assinante");
    }
    // Pendente de outro plano: troca (cancela a antiga que nunca foi paga).
    await cancelar(atual.assinatura.id, "Trocou de plano antes de pagar", p.usuarioId ?? null, { avisar: false });
  }

  const vagas = await vagasRestantes(plano);
  if (vagas !== null && vagas <= 0) {
    throw new ErroNegocio(`As vagas do ${plano.nome} estão esgotadas no momento.`, 409, "sem_vagas");
  }

  const g = await gateway();
  const email = (p.email ?? cliente.email ?? "").trim().toLowerCase();
  if (g.exigeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new ErroNegocio("Para assinar precisamos de um e-mail válido (exigência do meio de pagamento).", 422, "email");
  }
  const cpf = (p.cpf ?? cliente.cpf ?? "").replace(/\D/g, "");
  if (!cpfValido(cpf)) throw new ErroNegocio("Para assinar precisamos de um CPF válido (exigência do meio de pagamento).", 422, "cpf");
  if (cpf !== cliente.cpf || (email && email !== cliente.email)) {
    await db.cliente.update({ where: { id: cliente.id }, data: { cpf, ...(email ? { email } : {}) } });
  }

  const assinatura = await db.assinatura.create({
    data: {
      clienteId: cliente.id, planoId: plano.id, formaPagamento: p.forma, precoCentavos: plano.precoCentavos,
      origem: p.origem, tokenPublico: novoTokenPublico(),
    },
  });

  let linkCartao: string | null = null;
  try {
    const anterior = await db.assinatura.findFirst({
      where: { clienteId: cliente.id, gatewayClienteId: { not: null } },
      select: { gatewayClienteId: true },
    });
    const gatewayClienteId =
      anterior?.gatewayClienteId ??
      (await g.criarCliente({ nome: cliente.nome, cpf, telefone: cliente.telefone, email: email || null, referencia: cliente.id }));
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
    await db.assinatura.delete({ where: { id: assinatura.id } });
    console.error("[assinaturas] falha no gateway:", e);
    throw new ErroNegocio("Não foi possível gerar a cobrança agora. Tente de novo em instantes.", 502, "gateway");
  }

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
export async function cancelar(assinaturaId: string, motivo: string, usuarioId: string | null, opts: { avisar?: boolean } = {}) {
  const a = await db.assinatura.findUnique({ where: { id: assinaturaId }, include: { cliente: true, plano: true } });
  if (!a) throw naoEncontrado("Assinatura");
  if (a.status === "CANCELADA") return a;
  if (a.gatewayId) {
    try {
      await (await gateway()).cancelarAssinatura(a.gatewayId);
    } catch (e) {
      console.error("[assinaturas] falha ao cancelar no gateway:", e);
      throw new ErroNegocio("Não foi possível cancelar no meio de pagamento. Tente de novo.", 502, "gateway");
    }
  }
  const futuros = await db.agendamento.findMany({
    where: { assinaturaId: a.id, inicio: { gt: new Date() }, status: { in: ["MARCADO", "CONFIRMADO"] } },
  });
  await db.$transaction(async (tx) => {
    await tx.assinatura.update({ where: { id: a.id }, data: { status: "CANCELADA", canceladaEm: new Date(), motivoCancelamento: motivo } });
    await tx.cobranca.updateMany({ where: { assinaturaId: a.id, status: { in: ["PENDENTE", "ATRASADA"] } }, data: { status: "CANCELADA" } });
    for (const ag of futuros) {
      const sb = await servicoDoBarbeiro(ag.barbeiroId, ag.servicoId, tx);
      await tx.agendamento.update({ where: { id: ag.id }, data: { assinaturaId: null, precoCentavos: sb?.precoCentavos ?? ag.precoCentavos } });
    }
    await auditar(tx, usuarioId, "cancelar", "assinatura", a.id, { motivo });
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
  await db.listaEsperaPlano.upsert({
    where: { planoId_clienteId: { planoId, clienteId } },
    create: { planoId, clienteId },
    update: {},
  });
  return db.listaEsperaPlano.count({ where: { planoId, avisadoEm: null } });
}
