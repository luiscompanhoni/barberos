import { Prisma, type Configuracao } from "@prisma/client";
import { db } from "@/lib/db";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { horarioComercial, lembreteDevido } from "@/lib/automacoes/regras";
import { assegurarConvitePrimeiraVisita } from "@/lib/avaliacoes/convites";
import { configRecompras } from "@/lib/recompras/configuracao";
import { ciclosDoCliente } from "@/lib/recompras/rotina";
import { publicarNotificacao } from "./caixa";
import { chaveAgenda, chaveRecompra, limiteGeracao } from "./geracao-regras";
import { resumoEquipeProprio } from "./geracao-equipe";
import { notificacaoAindaRelevante } from "./geracao-relevancia";

export { notificacaoAindaRelevante } from "./geracao-relevancia";

const DIA = 86_400_000;
type Alvo = {
  id: string; papel: string; cliente: { id: string } | null; barbeiro: { id: string } | null;
  notificacaoPreferencia: { agenda: boolean; avaliacoes: boolean; recompra: boolean; equipe: boolean } | null;
};
type Totais = { usuarios: number; criadas: number; agenda: number; avaliacoes: number; recompras: number; equipe: number; falhas: number };
export type OpcoesGeracao = { clienteIds?: string[]; usuarioIds?: string[]; limite?: number };

async function gerarAgenda(u: Alvo, agora: Date, cfg: Configuracao) {
  const horizonte = Math.max(cfg.lembreteHorasAntes * 60, cfg.lembreteMinutosAntes) * 60_000;
  if (!u.cliente || horizonte <= 0) return 0;
  const agendamentos = await db.agendamento.findMany({ where: {
    clienteId: u.cliente.id, adicionalDeId: null, status: { in: ["MARCADO", "CONFIRMADO"] },
    inicio: { gt: agora, lte: new Date(+agora + horizonte) },
  }, select: { id: true, inicio: true, criadoEm: true, status: true }, orderBy: [{ inicio: "asc" }, { id: "asc" }] });
  let criadas = 0;
  for (const a of agendamentos) {
    const tipo = lembreteDevido({ inicio: +a.inicio, criadoEm: +a.criadoEm, status: a.status }, +agora, cfg);
    if (!tipo) continue;
    const r = await publicarNotificacao({ usuarioId: u.id, categoria: "AGENDA", chave: chaveAgenda(a.id, a.inicio, tipo),
      titulo: tipo === "LEMBRETE_PROXIMO" ? "Seu atendimento está próximo" : "Lembrete do seu atendimento",
      corpo: "Abra sua agenda para conferir o horário e os detalhes da visita.", href: "/c", criadoEm: agora, expiraEm: a.inicio,
      dados: { agendamentoId: a.id, inicio: a.inicio.toISOString(), tipo },
    });
    if (r?.criada) criadas++;
  }
  return criadas;
}

async function gerarAvaliacao(u: Alvo, agora: Date) {
  if (!u.cliente) return 0;
  const cfg = await db.avaliacaoConfig.findUnique({ where: { id: 1 } });
  if (!cfg?.ativo || !cfg.ativaDesde) return 0;
  // Não recria convites históricos vencidos para alguém que acabou de aderir.
  const recente = await db.agendamento.findFirst({ where: { clienteId: u.cliente.id, status: "CONCLUIDO", adicionalDeId: null,
    fim: { gte: new Date(Math.max(+cfg.ativaDesde, +agora - cfg.validadeDias * DIA)), lte: agora } }, select: { id: true } });
  if (!recente) return 0;
  const convite = await assegurarConvitePrimeiraVisita(u.cliente.id, agora);
  if (!convite) return 0;
  const dados = { conviteId: convite.id };
  if (!await notificacaoAindaRelevante({ usuarioId: u.id, categoria: "AVALIACAO", dados, expiraEm: convite.expiraEm }, agora)) return 0;
  const r = await publicarNotificacao({ usuarioId: u.id, categoria: "AVALIACAO", chave: `avaliacao:${convite.id}`,
    titulo: "Como foi sua visita?", corpo: "Sua avaliação interna já está disponível no aplicativo.", href: "/c/avaliacoes",
    dados, criadoEm: agora, expiraEm: convite.expiraEm,
  });
  return r?.criada ? 1 : 0;
}

async function gerarRecompra(u: Alvo, agora: Date, cfg: Configuracao) {
  if (!u.cliente) return 0;
  const politica = await configRecompras();
  if (!politica.ativo) return 0;
  const ciclos = (await ciclosDoCliente(u.cliente.id, +agora, cfg.fuso)).map(c => ({ servicoId: c.servicoId, ultimaEm: c.ultimaEm }));
  if (!ciclos.length) return 0;
  const intervaloMs = politica.intervaloContatoDias * DIA;
  const r = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notificacao-recompra:${u.id}`}))`;
    const recente = await tx.notificacao.findFirst({ where: { usuarioId: u.id, categoria: "RECOMPRA", criadoEm: { gt: new Date(+agora - intervaloMs) } }, select: { id: true } });
    if (recente) return null;
    // O canal do aplicativo tem adesão própria; a preferência do WhatsApp não participa.
    return publicarNotificacao({ usuarioId: u.id, categoria: "RECOMPRA", chave: chaveRecompra(ciclos, Math.floor(+agora / intervaloMs)),
      titulo: "Hora de renovar o cuidado", corpo: "Há uma sugestão de retorno disponível para você no aplicativo.", href: "/c",
      dados: { clienteId: u.cliente!.id, ciclos }, criadoEm: agora, expiraEm: new Date(+agora + intervaloMs),
    }, tx);
  });
  return r?.criada ? 1 : 0;
}

async function gerarEquipe(u: Alvo, agora: Date, cfg: Configuracao) {
  if (!u.barbeiro) return 0;
  const data = dataLocal(agora, cfg.fuso);
  const resumo = await resumoEquipeProprio(u.barbeiro.id, u.id, data, agora, cfg);
  if (!resumo) return 0;
  const r = await publicarNotificacao({ usuarioId: u.id, categoria: "EQUIPE", chave: `meu-dia:${u.barbeiro.id}:${data}`,
    titulo: "Seu dia na barbearia", corpo: "Consulte seus atendimentos e os espaços livres para encaixe no resumo de hoje.",
    href: "/meu-dia", criadoEm: agora, expiraEm: resumo.expiraEm, dados: { barbeiroId: u.barbeiro.id, data },
  });
  return r?.criada ? 1 : 0;
}

/** Lote justo persistido por usuário. Nunca executa envio de push ou WhatsApp. */
export async function gerarNotificacoes(agora = new Date(), opts: OpcoesGeracao = {}): Promise<Totais> {
  const totais: Totais = { usuarios: 0, criadas: 0, agenda: 0, avaliacoes: 0, recompras: 0, equipe: 0, falhas: 0 };
  if (!Number.isFinite(+agora)) throw new Error("Data inválida para gerar notificações.");
  if (opts.clienteIds?.length === 0 || opts.usuarioIds?.length === 0) return totais;
  const cfg = await configuracao();
  if (!horarioComercial(+agora, cfg.fuso)) return totais;
  const usuarios = await db.usuario.findMany({ where: {
    ativo: true,
    ...(opts.usuarioIds ? { id: { in: opts.usuarioIds } } : {}),
    ...(opts.clienteIds ? { cliente: { id: { in: opts.clienteIds } }, papel: "CLIENTE" } : { OR: [{ papel: "CLIENTE", cliente: { isNot: null } }, { papel: { not: "CLIENTE" }, barbeiro: { ativo: true } }] }),
  }, select: { id: true, papel: true, cliente: { select: { id: true } }, barbeiro: { select: { id: true } }, notificacaoPreferencia: true },
  orderBy: [{ notificacaoPreferencia: { ultimoProcessamentoEm: { sort: "asc", nulls: "first" } } }, { id: "asc" }], take: limiteGeracao(opts.limite) });
  for (const u of usuarios) {
    const pref = u.notificacaoPreferencia;
    try {
      if (u.papel === "CLIENTE") {
        if (pref?.agenda !== false) totais.agenda += await gerarAgenda(u, agora, cfg);
        if (pref?.avaliacoes !== false) totais.avaliacoes += await gerarAvaliacao(u, agora);
        if (pref?.recompra === true) totais.recompras += await gerarRecompra(u, agora, cfg);
      } else if (!opts.clienteIds && pref?.equipe !== false) totais.equipe += await gerarEquipe(u, agora, cfg);
    } catch (e) {
      totais.falhas++;
      console.error("[notificacoes] Falha ao gerar avisos de um usuário.", { codigo: e instanceof Prisma.PrismaClientKnownRequestError ? e.code : "interno" });
    } finally {
      await db.notificacaoPreferencia.upsert({ where: { usuarioId: u.id }, create: { usuarioId: u.id, ultimoProcessamentoEm: agora }, update: { ultimoProcessamentoEm: agora } });
      totais.usuarios++;
    }
  }
  totais.criadas = totais.agenda + totais.avaliacoes + totais.recompras + totais.equipe;
  return totais;
}
