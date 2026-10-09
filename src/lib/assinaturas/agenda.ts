/**
 * Preco de um agendamento para quem tem assinatura: coberto (R$ 0), com
 * desconto de assinante (servico fora do plano) ou bloqueado pela regra do plano.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { diaSemana, dataLocal } from "@/lib/agenda/tempo";
import { avaliarUso, precoComDesconto, type PlanoRegras } from "./regras";
import { situacaoDoCliente } from "./servico";

type Cliente = typeof db | Prisma.TransactionClient;

export type Precificacao = { assinaturaId: string | null; precoCentavos: number; nota: string | null };

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (ms: number, fuso: string) => dataLocal(ms, fuso).split("-").reverse().join("/");

/**
 * @param forcarAvulso cliente/equipe aceitou pagar normalmente quando a regra do plano nao deixa.
 * @param ignorarAgendamentoId o proprio agendamento, ao remarcar.
 */
export async function precificar(p: {
  clienteId: string;
  servicoId: string;
  barbeiroId: string;
  inicio: number;
  precoBase: number;
  fuso: string;
  forcarAvulso?: boolean;
  ignorarAgendamentoId?: string;
  c?: Cliente;
}): Promise<Precificacao> {
  const sit = await situacaoDoCliente(p.clienteId);
  if (!sit || !sit.valida) return { assinaturaId: null, precoCentavos: p.precoBase, nota: null };
  // Cancelado com fim do ciclo: horario depois do fim nao entra no plano.
  if (sit.assinatura.encerraEm && p.inicio >= sit.assinatura.encerraEm.getTime()) return { assinaturaId: null, precoCentavos: p.precoBase, nota: null };

  const a = sit.assinatura;
  const regras: PlanoRegras = {
    nome: a.plano.nome,
    intervaloMinDias: a.plano.intervaloMinDias,
    maxAgendamentosAbertos: a.plano.maxAgendamentosAbertos,
    diasSemana: a.plano.diasSemana,
    descontoExtrasPct: a.plano.descontoExtrasPct,
    servicos: a.plano.servicos.map((s) => ({ servicoId: s.servicoId, usosPorCiclo: s.usosPorCiclo })),
    barbeiroIds: a.plano.barbeiros.map((b) => b.barbeiroId),
  };
  const agora = Date.now();
  const usos = await (p.c ?? db).agendamento.findMany({
    where: {
      assinaturaId: a.id,
      status: { not: "CANCELADO" }, // falta conta como uso (evita marcar e nao vir)
      ...(p.ignorarAgendamentoId ? { id: { not: p.ignorarAgendamentoId } } : {}),
    },
    select: { id: true, inicio: true, servicoId: true, status: true },
  });

  const r = avaliarUso({
    plano: regras,
    servicoId: p.servicoId,
    barbeiroId: p.barbeiroId,
    inicio: p.inicio,
    diaSemana: diaSemana(dataLocal(p.inicio, p.fuso)),
    usos: usos.map((u) => ({
      id: u.id,
      inicio: u.inicio.getTime(),
      servicoId: u.servicoId,
      futuro: u.inicio.getTime() > agora && (u.status === "MARCADO" || u.status === "CONFIRMADO"),
    })),
    cicloInicio: a.cicloInicio?.getTime() ?? null,
  });

  if (r.cobre) return { assinaturaId: a.id, precoCentavos: 0, nota: `Pelo ${a.plano.nome}` };

  const comDesconto = precoComDesconto(p.precoBase, regras.descontoExtrasPct);
  const nota = regras.descontoExtrasPct ? `Assinante: ${regras.descontoExtrasPct}% de desconto` : null;
  if (r.codigo === "servico" || p.forcarAvulso) return { assinaturaId: null, precoCentavos: comDesconto, nota };

  throw new ErroNegocio(
    `${r.motivo}${r.aPartirDe ? ` Pelo plano, o próximo pode ser a partir de ${dataBr(r.aPartirDe, p.fuso)}.` : ""} ` +
      `Se quiser, dá para marcar como avulso por ${reais(comDesconto)}.`,
    422,
    "regra_plano",
    { aPartirDe: r.aPartirDe ?? null, precoAvulso: comDesconto, codigoRegra: r.codigo },
  );
}

/**
 * Plano acabou de ativar: horarios futuros que o cliente ja tinha marcado como
 * avulso passam a sair pelo plano, se as regras deixarem (na ordem da agenda).
 */
export async function aplicarPlanoAosFuturos(clienteId: string, fuso: string) {
  const futuros = await db.agendamento.findMany({
    where: { clienteId, assinaturaId: null, inicio: { gt: new Date() }, status: { in: ["MARCADO", "CONFIRMADO"] } },
    orderBy: { inicio: "asc" },
    select: { id: true, servicoId: true, barbeiroId: true, inicio: true, precoCentavos: true },
  });
  let convertidos = 0;
  for (const a of futuros) {
    try {
      const p = await precificar({
        clienteId, servicoId: a.servicoId, barbeiroId: a.barbeiroId, inicio: a.inicio.getTime(),
        precoBase: a.precoCentavos, fuso, ignorarAgendamentoId: a.id,
      });
      if (p.assinaturaId) {
        await db.agendamento.update({ where: { id: a.id }, data: { assinaturaId: p.assinaturaId, precoCentavos: 0 } });
        convertidos++;
      }
    } catch (e) {
      if (!(e instanceof ErroNegocio)) throw e; // regra do plano nao deixa: continua avulso
    }
  }
  return convertidos;
}
