import type { Prisma } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, somarDias } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import { permissoesDoUsuario } from "@/lib/auth/permissoes";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { resumoMes } from "@/lib/financeiro/resumo";
import { resumosPublicados } from "@/lib/avaliacoes/resumos";
import { resumoDesempenhoPeriodo } from "@/lib/desempenho/consultas";
import { dadosDoPeriodo } from "./dados";
import { carregarMeuDia } from "./meu-dia";
import { leiturasDoPeriodo, protegerSnapshot } from "./regras";
import { criarReuniaoSchema, editarReuniaoSchema, periodoSchema } from "./schemas";
import type { AcaoReuniao, ReuniaoResposta, SnapshotReuniao } from "./tipos";

async function exigirAcesso(s: Sessao) {
  const p = await permissoesDoUsuario(s);
  if (!["DONO", "GERENTE", "LIDER"].includes(s.papel) || !p.reunioes) throw new ErroNegocio("Seu acesso não permite reuniões.", 403);
  return p;
}

export async function montarSnapshot(inicio: string, fim: string, tipo: "DIARIA" | "SEMANAL", ator: Sessao): Promise<SnapshotReuniao> {
  periodoSchema.parse({ inicio, fim });
  const cfg = await configuracao();
  const tamanho = Math.round((Date.parse(fim) - Date.parse(inicio)) / 86400000) + 1;
  const mesInicio = `${fim.slice(0, 7)}-01`;
  const [atual, anterior, mes, financeiro] = await Promise.all([
    dadosDoPeriodo(inicio, fim), dadosDoPeriodo(somarDias(inicio, -tamanho), somarDias(inicio, -1)),
    inicio === mesInicio ? null : dadosDoPeriodo(mesInicio, fim), resumoMes(fim.slice(0, 7)),
  ]);
  const avisos = [
    "Faturamento: vendas líquidas de comandas fechadas + mensalidades pagas líquidas. Produção e comissões usam a data do atendimento; recebimentos antecipados aparecem no resultado de caixa.",
    "Margem estimada antes de taxas e despesas fixas, com os custos cadastrados na geração. Sem custo ou comissão definidos, a margem fica pendente. Não equivale ao lucro líquido.",
    "Assinaturas atribuídas a profissionais/cadeiras/serviços pelo pote são uma distribuição da receita da casa e não devem ser somadas novamente ao faturamento.",
    "Estornos de itens ajustam a venda original; o total de estornos do período e o resultado de caixa seguem a data da devolução.",
  ];
  if (atual.semFechamento) avisos.push(`${atual.semFechamento} atendimento(s) avulso(s) concluído(s) sem comanda fechada no período. A produção e a comissão aparecem, mas essas vendas não entram no faturamento e a margem não considera esses atendimentos.`);
  if (!atual.poteLigado && atual.atual.assinantes) avisos.push("Pote das assinaturas desligado: a mensalidade entra só no total, e os atendimentos de plano ficam fora da margem por profissional, serviço e cadeira.");
  if (atual.datasDiferentes) avisos.push("Há vendas cujo atendimento não foi concluído neste mesmo período. Elas entram no faturamento, mas não na margem, para não misturar as bases de venda e produção.");
  if (atual.atual.custosPendentes) avisos.push(`${atual.atual.custosPendentes} serviço(s) ou item(ns) sem custo cadastrado. Complete os custos para calcular a margem estimada.`);
  const profissionais = await db.barbeiro.findMany({ where: { ativo: true }, select: { id: true, nome: true } });
  const [qualidade, desempenho, diaria] = await Promise.all([
    resumosPublicados(profissionais.map((b) => b.id)),
    Promise.all(profissionais.map(async (b) => {
      const r = await resumoDesempenhoPeriodo(b.id, inicio, fim);
      return { barbeiroId: b.id, nome: b.nome, presencaPercentual: r?.presenca.percentual ?? null, checklistTotal: r?.checklist.total ?? 0, checklistValidados: r?.checklist.validados ?? 0, mediaLider: r?.lider.media ?? null };
    })),
    tipo === "DIARIA" ? Promise.all(profissionais.map(async (b) => {
      const d = await carregarMeuDia(ator, { data: fim, barbeiroId: b.id });
      return { barbeiroId: b.id, nome: b.nome, clientes: d.resumo.clientes, assinantes: d.resumo.assinantes, avulsos: d.resumo.avulsos,
        receitaPrevistaCentavos: d.resumo.receitaPrevistaCentavos, comissaoAvulsaCentavos: d.resumo.comissaoAvulsaCentavos,
        comissaoPlanoCentavos: d.resumo.comissaoPlanoCentavos, planoPendente: d.resumo.planoPendente, prioridades: d.prioridades,
        cenarios: d.servicos.map((sv) => ({ servico: sv.nome, quantidadeMaxima: sv.quantidadeMaxima, receitaAdicionalCentavos: sv.precoCentavos * sv.quantidadeMaxima, comissaoAdicionalCentavos: sv.comissaoCentavos === null ? null : sv.comissaoCentavos * sv.quantidadeMaxima })) };
    })) : Promise.resolve([]),
  ]);
  return { versao: 1, geradoEm: new Date().toISOString(), inicio, fim, tipo, fuso: cfg.fuso,
    atual: atual.atual, anterior: anterior.atual, barbeiros: atual.barbeiros, cadeiras: atual.cadeiras, servicos: atual.servicos,
    leituras: leiturasDoPeriodo(atual.atual, anterior.atual), avisos,
    mes: { inicio: mesInicio, fim, faturamentoCentavos: (mes ?? atual).atual.faturamentoCentavos, atendimentos: (mes ?? atual).atual.atendimentos },
    financeiro: { mes: financeiro.mes, receitasCentavos: financeiro.receitas.total, despesasCentavos: financeiro.despesas.total, resultadoCaixaCentavos: financeiro.resultado },
    qualidade: qualidade.map((q) => ({ barbeiroId: q.barbeiroId, nome: q.nome, media: q.media, quantidade: q.quantidade })), desempenho, diaria };
}

export async function listarReunioes(s: Sessao) {
  await exigirAcesso(s);
  return db.reuniao.findMany({ take: 60, orderBy: { criadoEm: "desc" }, select: { id: true, titulo: true, tipo: true, inicio: true, fim: true, criadoEm: true } });
}

export async function lerReuniao(s: Sessao, id: string, equipe = false): Promise<ReuniaoResposta> {
  const p = await exigirAcesso(s);
  const r = await db.reuniao.findUnique({ where: { id } });
  if (!r) throw naoEncontrado("Reunião");
  const privado = p.lucro && p.comissoes_equipe;
  return { id: r.id, titulo: r.titulo, tipo: r.tipo, inicio: r.inicio, fim: r.fim, versao: r.versao, criadoEm: r.criadoEm.toISOString(),
    snapshot: protegerSnapshot(r.snapshot as unknown as SnapshotReuniao, { lucro: p.lucro, comissoes: p.comissoes_equipe, equipe }),
    // Conteudo livre pode citar lucro/salarios: nao reaparece apos revogar acesso sensivel.
    conteudo: !equipe && privado ? r.conteudo : "",
    acoes: equipe ? [] : (r.acoes as unknown as AcaoReuniao[]).filter((a) => privado || a.barbeiroId === s.barbeiroId),
    podeEditar: !equipe && privado && (s.papel === "DONO" || r.criadoPorId === s.usuarioId), apresentacaoEquipe: equipe };
}

export async function criarReuniao(s: Sessao, entrada: unknown) {
  await exigirAcesso(s);
  const d = criarReuniaoSchema.parse(entrada);
  const hoje = dataLocal(Date.now(), (await configuracao()).fuso);
  if (d.fim > hoje && d.tipo === "SEMANAL") throw new ErroNegocio("Use um período encerrado ou até hoje para os resultados semanais.");
  const snapshot = await montarSnapshot(d.inicio, d.fim, d.tipo, s);
  const r = await db.$transaction(async (tx) => {
    const nova = await tx.reuniao.create({ data: { ...d, snapshot: snapshot as unknown as Prisma.InputJsonValue, criadoPorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "reuniao_criar", "reuniao", nova.id, { inicio: d.inicio, fim: d.fim, tipo: d.tipo });
    return nova;
  });
  return lerReuniao(s, r.id);
}

export async function editarReuniao(s: Sessao, id: string, entrada: unknown) {
  const permissoes = await exigirAcesso(s);
  if (!permissoes.lucro || !permissoes.comissoes_equipe) throw new ErroNegocio("Conteúdo livre pode conter dados reservados. Peça ao dono acesso a lucro e comissões para editar.", 403);
  const d = editarReuniaoSchema.parse(entrada);
  await db.$transaction(async (tx) => {
    const r = await tx.reuniao.findUnique({ where: { id } });
    if (!r) throw naoEncontrado("Reunião");
    if (s.papel !== "DONO" && r.criadoPorId !== s.usuarioId) throw new ErroNegocio("Somente o autor ou o dono edita esta reunião.", 403);
    const ids = [...new Set(d.acoes.flatMap((a) => a.barbeiroId ? [a.barbeiroId] : []))];
    if (ids.length !== await tx.barbeiro.count({ where: { id: { in: ids } } })) throw new ErroNegocio("Uma ação aponta para profissional inexistente.");
    const salvo = await tx.reuniao.updateMany({ where: { id, versao: d.versao }, data: { titulo: d.titulo, conteudo: d.conteudo, acoes: d.acoes as Prisma.InputJsonValue, versao: { increment: 1 } } });
    if (!salvo.count) throw new ErroNegocio("Outra pessoa alterou a reunião. Recarregue antes de salvar.", 409, "conflito");
    await auditar(tx, s.usuarioId, "reuniao_editar", "reuniao", id, { versaoAnterior: d.versao, acoes: d.acoes.length });
  });
  return lerReuniao(s, id);
}
