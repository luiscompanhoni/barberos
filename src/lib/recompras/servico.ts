import { db } from "@/lib/db";
import { configuracao, carregarDia, STATUS_ATIVOS } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { contido, sobrepoe } from "@/lib/agenda/disponibilidade";
import { ocupacaoCadeira } from "@/lib/agenda/cadeiras";
import { precificar } from "@/lib/assinaturas/agenda";
import { calcularComissao, escolherRegra, adicionalNoDia } from "@/lib/rh/regras";
import { adicionaisDoCalculo } from "@/lib/rh/adicionais";
import { regrasExtras } from "@/lib/rh/pote";
import { configRecompras } from "./configuracao";
import { ultimasCompras } from "./historico";
import { descontoReativacao, diasDecorridos, podeRecomendar, DIA } from "./regras";

export type OportunidadeRecompra = {
  agendamentoId: string; clienteId: string; clienteNome: string; servicoId: string; servicoNome: string;
  ultimaEm: string; diasDesde: number; intervaloDias: number; duracaoMin: number; precoCentavos: number;
  cobertoPlano: boolean; motivo: string; oferta: { estado: string; lembrarEm: string | null } | null;
  podeEncaixar: boolean; inicioSugerido: string; comissaoCentavos: number | null; descontoCentavos: number;
  descontoExpiraEm: string; comandaId: string | null;
};

export async function oportunidadesDoDia(barbeiroId: string, data: string): Promise<OportunidadeRecompra[]> {
  const [cfg, politica, regras, adicionais, extras] = await Promise.all([
    configuracao(), configRecompras(), db.comissaoServico.findMany(), adicionaisDoCalculo(), regrasExtras(),
  ]);
  if (!politica.ativo) return [];
  const inicio = instanteLocal(data, 0, cfg.fuso), fim = instanteLocal(somarDias(data, 1), 0, cfg.fuso);
  const [agenda, servicos, dia] = await Promise.all([
    db.agendamento.findMany({ where: { barbeiroId, adicionalDeId: null, inicio: { gte: new Date(inicio), lt: new Date(fim) }, status: { in: [...STATUS_ATIVOS] } }, include: { cliente: { select: { nome: true } }, itemComanda: true } }),
    db.servico.findMany({ where: { ativo: true, intervaloRecompraDias: { not: null }, barbeiros: { some: { barbeiroId } } }, include: { barbeiros: { where: { barbeiroId } } } }),
    carregarDia(data, [barbeiroId], { fuso: cfg.fuso }),
  ]);
  const clientes = [...new Set(agenda.map(a => a.clienteId))];
  const [historico, futuros, ofertas] = await Promise.all([
    ultimasCompras(clientes, new Date(inicio)),
    db.agendamento.findMany({ where: { clienteId: { in: clientes }, status: { in: [...STATUS_ATIVOS] }, inicio: { gte: new Date(inicio) } }, select: { clienteId: true, servicoId: true, inicio: true, fim: true, adicionalDeId: true } }),
    db.ofertaRecompra.findMany({ where: { clienteId: { in: clientes } }, orderBy: { atualizadoEm: "desc" } }),
  ]);
  const turno = dia.get(barbeiroId);
  if (!turno) return [];
  const resultado: OportunidadeRecompra[] = [];
  const vistos = new Set<string>();
  for (const a of agenda) for (const servico of servicos) {
    const chave = `${a.clienteId}:${servico.id}`;
    if (vistos.has(chave)) continue;
    const ultima = historico.ultimas.get(chave);
    if (!ultima || !servico.intervaloRecompraDias) continue;
    const oferta = ofertas.find(o => o.clienteId === a.clienteId && o.servicoId === servico.id && +o.ultimaEm === +ultima.fim);
    const diasDesde = diasDecorridos(ultima.fim, data, cfg.fuso);
    if (!podeRecomendar({ dias: diasDesde, intervalo: servico.intervaloRecompraDias, agendado: futuros.some(f => f.clienteId === a.clienteId && f.servicoId === servico.id), estado: oferta?.estado, lembrarEm: oferta?.lembrarEm, agora: Math.max(Date.now(), inicio) })) continue;
    const sb = servico.barbeiros[0];
    const duracaoMin = sb.duracaoMin ?? servico.duracaoMin;
    const inicioExtra = +a.fim + cfg.intervaloEntreClientes * 60_000;
    const int = { inicio: inicioExtra, fim: inicioExtra + duracaoMin * 60_000 };
    const folga = cfg.intervaloEntreClientes * 60_000;
    const cabe = inicioExtra >= Date.now() && contido(int, turno.janelas) && !turno.bloqueios.some(b => sobrepoe(b, int)) && !turno.agendamentos.some(ag => sobrepoe({ inicio: ag.inicio - folga, fim: ag.fim + folga }, int));
    const cadeiraOcupada = await ocupacaoCadeira(a.cadeiraId, { inicio: int.inicio - folga, fim: int.fim + folga });
    const preco = await precificar({ clienteId: a.clienteId, servicoId: servico.id, barbeiroId, inicio: inicioExtra, precoBase: sb.precoCentavos ?? servico.precoCentavos, fuso: cfg.fuso, forcarAvulso: true });
    const regra = escolherRegra(regras, servico.id, barbeiroId);
    const adicionalBps = adicionalNoDia(adicionais, barbeiroId, preco.assinaturaId ? "ASSINATURA" : "AVULSO", data);
    const expiraEm = new Date(+(oferta?.criadoEm ?? new Date()) + politica.descontoValidadeDias * DIA);
    const descontoCentavos = descontoReativacao({ politica, preco: preco.precoCentavos, custo: servico.custoCentavos, regra, adicionalBps, diasSemVisita: diasDecorridos(historico.visitas.get(a.clienteId) ?? ultima.fim, data, cfg.fuso), cobertoPlano: !!preco.assinaturaId, expirou: +expiraEm < Date.now() });
    const comissaoCentavos = !regra || (preco.assinaturaId && extras.assinaturas.ativo) ? null : calcularComissao(regra, { modalidade: preco.assinaturaId ? "PLANO" : "AVULSO", preco: preco.precoCentavos, precoTabela: sb.precoCentavos ?? servico.precoCentavos }, adicionalBps).comissao;
    resultado.push({
      agendamentoId: a.id, clienteId: a.clienteId, clienteNome: a.cliente.nome, servicoId: servico.id, servicoNome: servico.nome,
      ultimaEm: ultima.fim.toISOString(), diasDesde, intervaloDias: servico.intervaloRecompraDias, duracaoMin,
      precoCentavos: preco.precoCentavos, cobertoPlano: !!preco.assinaturaId, motivo: `Último serviço há ${diasDesde} dias; intervalo de ${servico.intervaloRecompraDias} dias.`,
      oferta: oferta ? { estado: oferta.estado, lembrarEm: oferta.lembrarEm?.toISOString() ?? null } : null,
      podeEncaixar: cabe && !cadeiraOcupada.length && !futuros.some(f => f.clienteId === a.clienteId && !f.adicionalDeId && sobrepoe({ inicio: +f.inicio, fim: +f.fim }, int)), inicioSugerido: new Date(inicioExtra).toISOString(), comissaoCentavos,
      descontoCentavos, descontoExpiraEm: expiraEm.toISOString(), comandaId: a.itemComanda?.comandaId ?? null,
    });
    vistos.add(chave);
  }
  return resultado;
}

export async function diaDoAtendimento(id: string) {
  const a = await db.agendamento.findUniqueOrThrow({ where: { id } });
  return { a, data: dataLocal(a.inicio, (await configuracao()).fuso) };
}
