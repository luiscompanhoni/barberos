import { db } from "@/lib/db";
import { carregarDia, limitesDoDia } from "@/lib/agenda/carregar";
import { ocupacaoCadeira } from "@/lib/agenda/cadeiras";
import { janelasParaEncaixe } from "@/lib/agenda/encaixes-regras";
import type { Configuracao } from "@prisma/client";

/** Somente existência/quantidade da própria agenda. Não consulta preços nem nomes de clientes. */
export async function resumoEquipeProprio(barbeiroId: string, usuarioId: string, data: string, agora: Date, cfg: Configuracao) {
  const barbeiro = await db.barbeiro.findFirst({
    where: { id: barbeiroId, usuarioId, ativo: true, usuario: { ativo: true, papel: { not: "CLIENTE" } } },
    select: { cadeiraId: true, servicos: { where: { servico: { ativo: true } }, select: { duracaoMin: true, servico: { select: { duracaoMin: true } } } } },
  });
  if (!barbeiro) return null;
  const limites = limitesDoDia(data, cfg.fuso);
  const [mapa, atendimentos] = await Promise.all([
    carregarDia(data, [barbeiroId], { fuso: cfg.fuso }),
    db.agendamento.count({ where: { barbeiroId, adicionalDeId: null, inicio: { gte: new Date(limites.inicio), lt: new Date(limites.fim) }, fim: { gt: agora }, status: { in: ["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO"] } } }),
  ]);
  const dia = mapa.get(barbeiroId);
  if (!dia) return null;
  const cadeira = barbeiro.cadeiraId ? await db.cadeira.findUnique({ where: { id: barbeiro.cadeiraId }, select: { ativa: true } }) : null;
  const ocupacao = cadeira?.ativa ? await ocupacaoCadeira(barbeiro.cadeiraId, limites) : [];
  const agendamentos = [...dia.agendamentos, ...ocupacao.map(a => ({ inicio: +a.inicio, fim: +a.fim }))];
  const capacidade = barbeiro.cadeiraId && !cadeira?.ativa ? [] : barbeiro.servicos.map(bs => {
    const janelas = janelasParaEncaixe({ janelas: dia.janelas, bloqueios: dia.bloqueios, agendamentos,
      duracaoMin: bs.duracaoMin ?? bs.servico.duracaoMin, granularidadeMin: cfg.granularidadeMin,
      intervaloMin: cfg.intervaloEntreClientes, agora: +agora });
    return janelas.reduce((s, j) => s + j.quantidade, 0);
  });
  // Alternativas compartilham janelas: nunca somar capacidades de serviços diferentes.
  const encaixes = Math.max(0, ...capacidade);
  return atendimentos || encaixes ? { atendimentos, encaixes, expiraEm: new Date(limites.fim) } : null;
}
