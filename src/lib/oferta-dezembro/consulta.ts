import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { instanteLocal } from "@/lib/agenda/tempo";
import { vagasRestantes } from "@/lib/assinaturas/vagas";
import { projetarRecorrenciaSimuladaDezembro } from "./cronograma-simulado";
import { lerConfigOfertaDezembro, ofertaDezembroEmHomologacao } from "./config";
import {
  adesaoNoPeriodo, avaliarLimiteDezembro, calcularMultaSimulada, CRONOGRAMA_DEZEMBRO, FIM_GRATIS_DEZEMBRO, INICIO_GRATIS_DEZEMBRO,
  inicioInatividade, motivoInelegibilidade, TERMO_DEZEMBRO,
} from "./regras";

export async function consultarPlanoBaseDezembro(c: Prisma.TransactionClient, planoId: string) {
  const plano = await c.plano.findFirst({
    where: {
      id: planoId, ativo: true, compravel: true, precoCentavos: { gt: 0 }, formasPagamento: { has: "CARTAO" },
      servicos: { some: { servico: { ativo: true } } },
    },
    select: {
      id: true, nome: true, precoCentavos: true, vagas: true,
      servicos: {
        where: { servico: { ativo: true } },
        select: { servicoId: true, usosPorCiclo: true, servico: { select: { nome: true } } },
        orderBy: { servico: { nome: "asc" } },
      },
    },
  });
  return plano;
}

export async function consultarOfertaPublicaDezembro(agora = new Date()) {
  const cfg = lerConfigOfertaDezembro();
  if (!cfg || !adesaoNoPeriodo(agora)) return null;
  const [plano, usadas] = await Promise.all([
    consultarPlanoBaseDezembro(db, cfg.planoId),
    db.ofertaDezembroAdesao.count(),
  ]);
  if (!plano) return null;
  const vagasDoPlano = await vagasRestantes(plano, db, agora);
  const vagas = Math.max(0, cfg.vagas - usadas);
  return {
    planoId: plano.id, planoNome: plano.nome, precoCentavos: plano.precoCentavos, limiteUsos: cfg.limiteUsos,
    servicos: plano.servicos.map(s => ({ id: s.servicoId, nome: s.servico.nome, usosPorCiclo: s.usosPorCiclo })),
    termosVersao: TERMO_DEZEMBRO, vagasRestantes: Math.min(vagas, vagasDoPlano ?? vagas),
  };
}

export async function consultarInelegibilidadeDezembro(c: Prisma.TransactionClient, clienteId: string, agora: Date) {
  const filtro = { clienteId };
  const [jaAderiu, assinaturaAberta, cancelamentoRecente] = await Promise.all([
    c.assinatura.findFirst({ where: { ...filtro, ofertaDezembro: { isNot: null } }, select: { id: true } }),
    c.assinatura.findFirst({ where: { ...filtro, status: { not: "CANCELADA" } }, select: { id: true } }),
    c.assinatura.findFirst({
      where: {
        ...filtro, status: "CANCELADA",
        OR: [{ canceladaEm: { gte: inicioInatividade(agora) } }, { canceladaEm: null, criadaEm: { gte: inicioInatividade(agora) } }],
      },
      select: { id: true },
    }),
  ]);
  return motivoInelegibilidade({ jaAderiu: !!jaAderiu, assinaturaAberta: !!assinaturaAberta, cancelamentoRecente: !!cancelamentoRecente });
}

export async function consultarContratoDezembro(clienteId: string, agora = new Date()) {
  if (!ofertaDezembroEmHomologacao()) return null;
  const a = await db.ofertaDezembroAdesao.findFirst({
    where: { assinatura: { clienteId } },
    select: {
      assinaturaId: true, aceitaEm: true, termosVersao: true, precoCentavos: true, limiteUsos: true,
      cancelamentoSolicitadoEm: true, multaSimuladaCentavos: true,
      assinatura: {
        select: {
          status: true, encerraEm: true, canceladaEm: true, plano: { select: { nome: true } },
          agendamentos: {
            where: { status: { not: "CANCELADO" }, inicio: { gte: new Date(INICIO_GRATIS_DEZEMBRO), lt: new Date(FIM_GRATIS_DEZEMBRO) } },
            select: { inicio: true },
          },
        },
      },
    },
  });
  if (!a) return null;
  const fimAgendado = a.assinatura.encerraEm
    ? new Date(instanteLocal(CRONOGRAMA_DEZEMBRO.fimFidelidade, 0, "America/Sao_Paulo")) : null;
  return {
    planoNome: a.assinatura.plano.nome, aceitaEm: a.aceitaEm.toISOString(), termosVersao: a.termosVersao,
    precoCentavos: a.precoCentavos, limiteUsos: a.limiteUsos,
    cancelamentoSolicitadoEm: a.cancelamentoSolicitadoEm?.toISOString() ?? null,
    multaSimuladaCentavos: a.multaSimuladaCentavos,
    multaImediataCentavos: calcularMultaSimulada(a.precoCentavos, a.aceitaEm, agora),
    status: a.assinatura.status, encerraEm: a.assinatura.encerraEm?.toISOString().slice(0, 10) ?? null,
    recorrencia: projetarRecorrenciaSimuladaDezembro(a.precoCentavos, agora, fimAgendado ?? a.assinatura.canceladaEm),
    ...avaliarLimiteDezembro(a.assinatura.agendamentos.map(({ inicio }) => ({ inicio: +inicio })), a.limiteUsos),
  };
}

export async function consultarPainelDezembro() {
  if (!ofertaDezembroEmHomologacao()) return null;
  const cfg = lerConfigOfertaDezembro();
  const [plano, usadas, adesoes] = await Promise.all([
    cfg ? consultarPlanoBaseDezembro(db, cfg.planoId) : null,
    db.ofertaDezembroAdesao.count(),
    db.ofertaDezembroAdesao.findMany({
      orderBy: { aceitaEm: "desc" }, take: 100,
      select: {
        assinaturaId: true, aceitaEm: true, limiteUsos: true, precoCentavos: true, multaSimuladaCentavos: true,
        assinatura: { select: { status: true, encerraEm: true, cliente: { select: { nome: true } }, plano: { select: { nome: true } } } },
      },
    }),
  ]);
  return {
    adesoes, usadas,
    restantesCampanha: cfg ? Math.max(0, cfg.vagas - usadas) : null,
    restantesPlano: plano ? await vagasRestantes(plano) : null,
    recebendoAdesoes: !!plano && adesaoNoPeriodo(new Date()),
  };
}
