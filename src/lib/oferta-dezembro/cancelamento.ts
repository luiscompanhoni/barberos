import type { Prisma } from "@prisma/client";
import { servicoDoBarbeiro } from "@/lib/agenda/carregar";
import { travarClienteAgenda } from "@/lib/agenda/cliente-identidade";
import { dataParaColuna, instanteLocal } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { ofertaDezembroEmHomologacao } from "./config";
import { calcularMultaSimulada, CRONOGRAMA_DEZEMBRO } from "./regras";
import type { TitularOfertaDezembro } from "./servico";

const fimFidelidade = dataParaColuna(CRONOGRAMA_DEZEMBRO.fimFidelidade);
const fimFidelidadeEm = instanteLocal(CRONOGRAMA_DEZEMBRO.fimFidelidade, 0, "America/Sao_Paulo");

async function encerrarContrato(tx: Prisma.TransactionClient, assinaturaId: string, agora: Date, motivo: string, encerraEm: Date | null = null) {
  await tx.assinatura.update({
    where: { id: assinaturaId }, data: { status: "CANCELADA", canceladaEm: agora, motivoCancelamento: motivo, encerraEm },
  });
  const futuros = await tx.agendamento.findMany({
    where: {
      assinaturaId, inicio: { gt: agora }, status: { in: ["MARCADO", "CONFIRMADO"] },
      // A comanda já aberta conserva o preço com que foi aberta.
      itemComanda: { is: null },
    },
    select: { id: true, barbeiroId: true, servicoId: true, servico: { select: { precoCentavos: true } } },
  });
  for (const a of futuros) {
    const item = await servicoDoBarbeiro(a.barbeiroId, a.servicoId, tx);
    await tx.agendamento.update({
      where: { id: a.id },
      data: { assinaturaId: null, precoCentavos: item?.precoCentavos ?? a.servico.precoCentavos },
    });
  }
  return [...new Set(futuros.map(a => a.barbeiroId))];
}

export async function solicitarCancelamentoDezembro(titular: TitularOfertaDezembro, quando: "agora" | "fim_fidelidade", agora = new Date()) {
  if (!ofertaDezembroEmHomologacao()) throw naoEncontrado("Oferta Dezembro Grátis");
  const { clienteId, usuarioId } = titular;
  const { barbeiros, ...contrato } = await db.$transaction(async tx => {
    await travarClienteAgenda(tx, clienteId, titular);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${clienteId}`}))`;
    const adesao = await tx.ofertaDezembroAdesao.findFirst({
      where: { assinatura: { clienteId } },
      select: {
        assinaturaId: true, aceitaEm: true, precoCentavos: true, multaSimuladaCentavos: true,
        assinatura: { select: { status: true, encerraEm: true } },
      },
    });
    if (!adesao) throw naoEncontrado("Contrato da oferta");
    const { assinaturaId, assinatura } = adesao;
    const aoFim = quando === "fim_fidelidade" && +agora < fimFidelidadeEm;
    if (assinatura.status === "CANCELADA" || (aoFim && assinatura.encerraEm)) {
      return { status: assinatura.status, encerraEm: assinatura.encerraEm, multaSimuladaCentavos: adesao.multaSimuladaCentavos, barbeiros: [] };
    }
    if (+agora < +adesao.aceitaEm) throw new ErroNegocio("A solicitação é anterior à adesão. Atualize a página.", 409);
    const motivo = aoFim ? "Cancelamento ao fim da fidelidade (homologação)" : "Cancelamento imediato (homologação)";
    const encerraEm = aoFim ? fimFidelidade : null;
    const multaSimuladaCentavos = aoFim ? 0 : calcularMultaSimulada(adesao.precoCentavos, adesao.aceitaEm, agora);
    const barbeiros = aoFim ? [] : await encerrarContrato(tx, assinaturaId, agora, motivo);
    if (aoFim) await tx.assinatura.update({ where: { id: assinaturaId }, data: { encerraEm, motivoCancelamento: motivo } });
    await tx.ofertaDezembroAdesao.update({
      where: { assinaturaId },
      data: { cancelamentoSolicitadoEm: agora, multaSimuladaCentavos },
    });
    await auditar(tx, usuarioId, "solicitar_cancelamento_dezembro", "assinatura", assinaturaId, {
      quando: aoFim ? "fim_fidelidade" : "agora", multaSimuladaCentavos, encerraEm: encerraEm?.toISOString().slice(0, 10) ?? null,
    });
    return { status: aoFim ? assinatura.status : "CANCELADA" as const, encerraEm, multaSimuladaCentavos, barbeiros };
  });
  if (barbeiros.length) publicar({ tipo: "agenda", barbeiroIds: barbeiros, datas: [] });
  return contrato;
}

export async function encerrarOfertasDezembroAgendadas(agora = new Date()) {
  if (!ofertaDezembroEmHomologacao() || +agora < fimFidelidadeEm) return 0;
  const lista = await db.assinatura.findMany({
    where: { status: { not: "CANCELADA" }, encerraEm: { lte: fimFidelidade }, ofertaDezembro: { isNot: null } },
    select: { id: true, clienteId: true },
  });
  let total = 0;
  for (const { id, clienteId } of lista) {
    const resultado = await db.$transaction(async tx => {
      // Mesma ordem de travas da agenda e do pedido de cancelamento.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente-ciclo:${clienteId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${clienteId}`}))`;
      const a = await tx.assinatura.findUniqueOrThrow({ where: { id }, select: { status: true, encerraEm: true } });
      if (a.status === "CANCELADA" || !a.encerraEm || a.encerraEm > fimFidelidade) return null;
      const barbeiros = await encerrarContrato(tx, id, agora, "Fim da fidelidade (homologação)", a.encerraEm);
      await auditar(tx, null, "encerrar_oferta_dezembro", "assinatura", id);
      return barbeiros;
    });
    if (!resultado) continue;
    total++;
    if (resultado.length) publicar({ tipo: "agenda", barbeiroIds: resultado, datas: [] });
  }
  return total;
}
