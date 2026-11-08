/**
 * Comissoes dos barbeiros: regra geral por servico (avulso e plano), excecao por barbeiro
 * e relatorio por periodo a partir dos agendamentos CONCLUIDO.
 */
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import { mudancas } from "@/lib/auditoria-regras";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { resumoComanda, type ItemRegra, type PagamentoRegra } from "@/lib/comandas/regras";
import { ErroNegocio } from "@/lib/erros";
import { recebimentosMensalidades } from "@/lib/financeiro/recebimentos";
import { STATUS_EFETIVOS } from "@/lib/estornos/regras";
import { adicionaisDoCalculo } from "./adicionais";
import { regrasExtras } from "./pote";
import { baseProdutoRecebido } from "./base-produtos";
import { revisaoApuracao } from "./revisao";
import { competenciaSalario, competenciasRemuneracao, garantirBaselineRemuneracao, gravarVigenciaRemuneracao, lerVigenciaRemuneracao } from "./vigencias";
import { lerMemoriaFolha } from "./memoria-folha";
import { regrasServicoVigentes, regrasExtrasVigentes, salarioVigente } from "./vigencia-regras";
import { tocarPessoasDaFolha } from "./trava-regras-folha";
import {
  calcularAssinaturas, comissaoProdutos, descreverRegra, intervaloCompetencia, REGRA_SUGERIDA, resumirComissoes, SOMA, valorCobradoItem,
  type CategoriaComissao, type Regra, type RegraSalva,
} from "./regras";

const soRegra = (r: Regra): Regra => ({ avulsoTipo: r.avulsoTipo, avulsoValor: r.avulsoValor, planoTipo: r.planoTipo, planoValor: r.planoValor });
const revisaoRegras = (regras: (Regra & { id: string })[]) => createHash("sha256").update(JSON.stringify([...regras].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0))).digest("hex");

/** Tela de configuracao: todos os servicos ativos (sem regra salva vem a sugestao) + excecoes. */
export async function configComissoes() {
  const [servicos, barbeiros, regras] = await Promise.all([
    db.servico.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true, precoCentavos: true } }),
    db.barbeiro.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } }),
    db.comissaoServico.findMany(),
  ]);
  return {
    sugestao: REGRA_SUGERIDA,
    revisao: revisaoRegras(regras),
    vigenciaPadrao: competenciasRemuneracao().proxima,
    barbeiros,
    servicos: servicos.map((s) => {
      const g = regras.find((r) => r.servicoId === s.id && r.barbeiroId === null);
      return { ...s, salvo: !!g, ...soRegra(g ?? REGRA_SUGERIDA) };
    }),
    excecoes: regras.filter((r) => r.barbeiroId !== null).map((r) => ({ servicoId: r.servicoId, barbeiroId: r.barbeiroId!, ...soRegra(r) })),
  };
}

type Entrada = Regra & { servicoId: string };

function validar(r: Regra) {
  for (const [t, v] of [[r.avulsoTipo, r.avulsoValor], [r.planoTipo, r.planoValor]] as const) {
    if (t === "PERCENTUAL" && v > 10000) throw new ErroNegocio("A comissão percentual não pode passar de 100%.");
  }
}

/** Regras em texto, por "Servico" ou "Servico / Barbeiro" (para a auditoria mostrar antes -> depois). */
async function regrasEmTexto(regras: (Regra & { servicoId: string; barbeiroId: string | null })[], c: Prisma.TransactionClient = db) {
  const [servicos, barbeiros] = await Promise.all([
    c.servico.findMany({ select: { id: true, nome: true } }),
    c.barbeiro.findMany({ select: { id: true, nome: true } }),
  ]);
  const sv = new Map(servicos.map((x) => [x.id, x.nome])), bb = new Map(barbeiros.map((x) => [x.id, x.nome]));
  return Object.fromEntries(regras.map((r) => [
    `${sv.get(r.servicoId) ?? r.servicoId}${r.barbeiroId ? ` / ${bb.get(r.barbeiroId) ?? r.barbeiroId}` : ""}`,
    `avulso ${descreverRegra(r.avulsoTipo, r.avulsoValor, "AVULSO")} · plano ${descreverRegra(r.planoTipo, r.planoValor, "PLANO")}`,
  ]));
}

/** Salva as regras gerais e substitui todas as excecoes. */
export async function salvarComissoes(s: Sessao, d: { gerais: Entrada[]; excecoes: (Entrada & { barbeiroId: string })[]; revisao?: string; competencia?: string }) {
  [...d.gerais, ...d.excecoes].forEach(validar);
  const chaves = new Set(d.excecoes.map((e) => `${e.servicoId}:${e.barbeiroId}`));
  if (chaves.size !== d.excecoes.length) throw new ErroNegocio("Tem exceção repetida para o mesmo barbeiro e serviço.");
  if (new Set(d.gerais.map(g => g.servicoId)).size !== d.gerais.length) throw new ErroNegocio("Há duas regras gerais para o mesmo serviço.");
  const competencia = competenciaSalario(d.competencia);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`folha-fechar:${competencia}`}))`;
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('rh:config:comissoes'))`;
    await tocarPessoasDaFolha(tx);
    const atuais = await tx.comissaoServico.findMany();
    if (d.revisao && d.revisao !== revisaoRegras(atuais)) throw new ErroNegocio("As regras foram alteradas por outra pessoa. Recarregue antes de salvar.", 409, "comissoes_mudaram");
    const antes = await regrasEmTexto(atuais, tx);
    const depois = await regrasEmTexto([...d.gerais.map((g) => ({ ...g, barbeiroId: null })), ...d.excecoes], tx);
    const m = mudancas(antes, { ...Object.fromEntries(Object.keys(antes).map((k) => [k, null])), ...depois });
    if (await tx.folhaPagamento.count({ where: { competencia, ativa: true } })) throw new ErroNegocio("Há folha fechada nesta competência. Escolha uma competência posterior para as regras.", 409, "folha_fechada");
    await garantirBaselineRemuneracao(tx, "servicos", JSON.parse(JSON.stringify(atuais)) as Prisma.InputJsonValue, s.usuarioId);
    for (const g of d.gerais) {
      // Unique com NULL nao impede duplicata no Postgres: procura e atualiza.
      const atual = await tx.comissaoServico.findMany({ where: { servicoId: g.servicoId, barbeiroId: null }, orderBy: { id: "asc" } });
      if (atual.length) {
        await tx.comissaoServico.update({ where: { id: atual[0].id }, data: soRegra(g) });
        if (atual.length > 1) await tx.comissaoServico.deleteMany({ where: { id: { in: atual.slice(1).map((a) => a.id) } } });
      } else {
        await tx.comissaoServico.create({ data: { servicoId: g.servicoId, barbeiroId: null, ...soRegra(g) } });
      }
    }
    await tx.comissaoServico.deleteMany({ where: { barbeiroId: { not: null } } });
    if (d.excecoes.length) await tx.comissaoServico.createMany({ data: d.excecoes.map((e) => ({ servicoId: e.servicoId, barbeiroId: e.barbeiroId, ...soRegra(e) })) });
    await gravarVigenciaRemuneracao(tx, { escopo: "servicos", competencia, conteudo: JSON.parse(JSON.stringify(await tx.comissaoServico.findMany({ orderBy: { id: "asc" } }))) as Prisma.InputJsonValue, atorId: s.usuarioId });
    if (m) await auditar(tx, s.usuarioId, "rh_comissoes_configurar", "comissao", "servicos", m as Prisma.InputJsonValue);
  });
  return configComissoes();
}

/** Base do avulso: o que ficou com a barbearia pelo servico na comanda (sem comanda, o preco do horario). */
function baseAvulso(a: { precoCentavos: number; itemComanda: ItemComServico | null }) {
  const it = a.itemComanda;
  if (!it) return a.precoCentavos;
  if (it.comanda.status === "CANCELADA") return 0;
  const r = resumoComanda(it.comanda.itens, it.comanda.pagamentos, it.comanda.descontoCentavos);
  return valorCobradoItem(it.quantidade * it.precoUnitCentavos, { subtotal: r.subtotal, desconto: r.desconto, estornado: r.estornado });
}
type ItemComServico = {
  quantidade: number; precoUnitCentavos: number;
  comanda: { status: string; descontoCentavos: number; itens: ItemRegra[]; pagamentos: PagamentoRegra[] };
};

/** "AAAA-MM" quando o periodo e exatamente um mes inteiro (para mostrar a folha junto). */
function mesInteiro(inicio: string, fim: string) {
  const comp = inicio.slice(0, 7);
  if (!inicio.endsWith("-01")) return null;
  try { return intervaloCompetencia(comp).fim === fim ? comp : null; } catch { return null; }
}

/**
 * Relatorio de comissoes do periodo (datas locais "AAAA-MM-DD", inclusivas): servicos avulsos (sobre o valor
 * efetivamente cobrado) e pelo plano, comissao das assinaturas (quando ligada, no lugar da regra "pelo plano"),
 * comissao diferenciada (adicionais) e produtos vendidos (por faixa). A comissao das assinaturas e calculada com
 * todos os barbeiros (a parte de um depende dos creditos dos outros). Mes inteiro: inclui a folha (bonus,
 * descontos e total a pagar).
 */
export async function relatorioComissoes(inicio: string, fim: string, barbeiroId?: string, c: Prisma.TransactionClient = db) {
  if (fim < inicio) throw new ErroNegocio("A data final é antes da inicial.");
  const fuso = (await configuracao(c)).fuso;
  const janela = { gte: new Date(instanteLocal(inicio, 0, fuso)), lt: new Date(instanteLocal(somarDias(fim, 1), 0, fuso)) };
  const [ags, regras, barbeiros, extras, adicionais, recebido, estornos, itens] = await Promise.all([
    c.agendamento.findMany({
      where: { status: "CONCLUIDO", inicio: janela },
      orderBy: { inicio: "asc" },
      select: {
        id: true, inicio: true, barbeiroId: true, servicoId: true, precoCentavos: true, assinaturaId: true,
        cliente: { select: { nome: true } }, servico: { select: { nome: true, precoCentavos: true } },
        itemComanda: {
          select: {
            quantidade: true, precoUnitCentavos: true,
            comanda: {
              select: {
                status: true, descontoCentavos: true,
                itens: { select: { quantidade: true, precoUnitCentavos: true } },
                pagamentos: { select: { forma: true, valorCentavos: true, status: true, estornadoCentavos: true, estornadoEm: true } },
              },
            },
          },
        },
      },
    }),
    c.comissaoServico.findMany({ orderBy: { id: "asc" } }) as Promise<RegraSalva[]>,
    c.barbeiro.findMany({ select: { id: true, nome: true } }),
    regrasExtras(c),
    adicionaisDoCalculo(c),
    // Mesma conta do resumo do mes: o recebido conta na data do pagamento e o estorno desconta na data em que foi feito.
    recebimentosMensalidades(janela, c),
    c.pedidoEstorno.aggregate({ where: { tipo: "MENSALIDADE", status: { in: STATUS_EFETIVOS }, executadoEm: janela }, _sum: { valorCentavos: true } }),
    c.itemComanda.findMany({
      where: { produtoId: { not: null }, barbeiroId: { not: null }, comanda: { status: "FECHADA", fechadaEm: janela } },
      select: { id: true, barbeiroId: true, quantidade: true, precoUnitCentavos: true, produto: { select: { categoria: true } }, comanda: { select: { fechadaEm: true, descontoCentavos: true, itens: { select: { id: true, quantidade: true, precoUnitCentavos: true } }, pagamentos: { select: { forma: true, valorCentavos: true, status: true, estornadoCentavos: true, estornadoEm: true } } } } },
    }),
  ]);
  const [versaoServicos, versaoExtras, fimServicos, fimExtras] = await Promise.all([
    lerVigenciaRemuneracao<RegraSalva[]>(c, "servicos", inicio.slice(0, 7)),
    lerVigenciaRemuneracao<Awaited<ReturnType<typeof regrasExtras>>>(c, "extras", inicio.slice(0, 7)),
    lerVigenciaRemuneracao(c, "servicos", fim.slice(0, 7)),
    lerVigenciaRemuneracao(c, "extras", fim.slice(0, 7)),
  ]);
  if (inicio.slice(0, 7) !== fim.slice(0, 7) && (revisaoApuracao(versaoServicos) !== revisaoApuracao(fimServicos) || revisaoApuracao(versaoExtras) !== revisaoApuracao(fimExtras))) throw new ErroNegocio("O período atravessa uma mudança de regra de comissão. Consulte cada competência separadamente para preservar as bases mensais.", 422, "regras_por_competencia");
  const regrasAplicadas = regrasServicoVigentes(versaoServicos?.conteudo ?? regras);
  const { assinaturas: cfgAssinaturas, faixas } = regrasExtrasVigentes(versaoExtras?.conteudo ?? extras);
  const comDia = ags.map((a) => ({ ...a, dia: dataLocal(a.inicio, fuso) }));
  const grupos = resumirComissoes(comDia.filter((a) => !barbeiroId || a.barbeiroId === barbeiroId).map((a) => ({
    id: a.id, barbeiroId: a.barbeiroId, servicoId: a.servicoId, preco: a.assinaturaId ? a.precoCentavos : baseAvulso(a), precoTabela: a.servico.precoCentavos,
    plano: !!a.assinaturaId, dia: a.dia, inicio: a.inicio, cliente: a.cliente.nome, servico: a.servico.nome,
  })), regrasAplicadas, { planoPeloPote: cfgAssinaturas.ativo, adicionais });
  const assinaturas = cfgAssinaturas.ativo
    ? calcularAssinaturas(cfgAssinaturas, { recebidoCentavos: recebido.totalElegivelComissoes, estornosCentavos: estornos._sum.valorCentavos ?? 0 }, comDia.filter((a) => a.assinaturaId), adicionais)
    : null;
  const produtos = comissaoProdutos(itens.filter((i) => i.produto?.categoria === "BAR" || i.produto?.categoria === "LOJA").map((i) => ({
    barbeiroId: i.barbeiroId!, categoria: i.produto!.categoria as CategoriaComissao, valorCentavos: baseProdutoRecebido(i),
  })), faixas);

  const nomes = new Map(barbeiros.map((b) => [b.id, b.nome]));
  const vazio = { qtd: 0, base: 0, comissao: 0, adicional: 0 };
  const comp = mesInteiro(inicio, fim);
  const folha = comp ? await folhaDoMes(comp, c) : new Map<string, FolhaBarbeiro>();
  const ids = new Set([...grupos.map((g) => g.barbeiroId), ...(assinaturas?.barbeiros.map((p) => p.barbeiroId) ?? []), ...produtos.keys(), ...folha.keys()]);
  const linhas = [...ids].filter((id) => !barbeiroId || id === barbeiroId).map((id) => {
    const g = grupos.find((x) => x.barbeiroId === id);
    const a = assinaturas?.barbeiros.find((x) => x.barbeiroId === id) ?? null;
    const pr = produtos.get(id) ?? null;
    const comissoes = (g?.total ?? 0) + (a?.comissao ?? 0) + (pr?.comissao ?? 0);
    const f = folha.get(id) ?? null;
    const historica = !!f && f.status !== "ABERTA";
    const memoria = f?.memoria?.comissao;
    return {
      barbeiroId: id, nome: historica ? f?.memoria?.barbeiro ?? nomes.get(id) ?? "?" : nomes.get(id) ?? "?", avulso: historica ? memoria?.avulso ?? vazio : g?.avulso ?? vazio, plano: historica ? memoria?.plano ?? vazio : g?.plano ?? vazio, assinaturas: historica ? memoria?.assinaturas ?? null : a, produtos: historica ? memoria?.produtos ?? null : pr,
      total: f?.comissaoCongelada ?? comissoes, semRegra: historica ? memoria?.semRegra ?? 0 : g?.semRegra ?? 0,
      fonte: historica ? "RETRATO_FECHADO" : "APURACAO_ATUAL", memoriaDisponivel: !historica || !!memoria,
      recalculoAtual: { total: comissoes, avulso: g?.avulso ?? vazio, plano: g?.plano ?? vazio, assinaturas: a, produtos: pr },
      folha: f && { ...f, totalAPagar: f.congelado ?? (f.salario + comissoes + f.bonus - f.descontos) },
      atendimentos: (historica ? [] : g?.detalhe ?? []).map((x) => ({ id: x.id, inicio: x.inicio, cliente: x.cliente, servico: x.servico, modalidade: x.modalidade, base: x.base, regra: x.regra, comissao: x.comissao })),
    };
  }).sort((a, b) => b.total - a.total);
  return {
    inicio, fim, competencia: comp, barbeiros: linhas, total: linhas.reduce((t, l) => t + l.total, 0), recebimentos: { completo: recebido.completo, pendentes: recebido.pendentes.length, nominalPendente: recebido.nominalPendente },
    revisao: revisaoApuracao({ inicio, fim, ags, regras: regrasAplicadas, versaoServicos, versaoExtras, extras, adicionais, recebido, estornos, itens }),
    regrasLegadas: !versaoServicos || versaoServicos.origem === "BASELINE_LEGADO_NAO_HOMOLOGADO" || (cfgAssinaturas.ativo && (!versaoExtras || versaoExtras.origem === "BASELINE_LEGADO_NAO_HOMOLOGADO")),
    assinaturas: assinaturas && {
      creditosPorServico: cfgAssinaturas.creditos,
      recebidoCentavos: assinaturas.recebidoCentavos, estornosCentavos: assinaturas.estornosCentavos, distribuivelCentavos: assinaturas.distribuivelCentavos,
      creditosTotal: assinaturas.creditosTotal, valorCreditoCentavos: assinaturas.valorCreditoCentavos, percentualBaseBps: assinaturas.percentualBaseBps,
      conciliacao: assinaturas.conciliacao,
    },
  };
}

type FolhaBarbeiro = { salario: number; bonus: number; descontos: number; congelado: number | null; comissaoCongelada: number | null; memoria: ReturnType<typeof lerMemoriaFolha>; status: "ABERTA" | "FECHADA" | "PAGA" };

/** Salario, bonus/adicionais e vales/descontos lancados na folha do mes, por barbeiro (funcionario ligado a ele). */
async function folhaDoMes(comp: string, c: Prisma.TransactionClient) {
  const pessoas = await c.checklistPessoa.findMany({
    where: { OR: [{ barbeiroId: { not: null } }, { folhas: { some: { competencia: comp, ativa: true } } }] },
    select: { id: true, barbeiroId: true, salarioCentavos: true, lancamentosFolha: { where: { competencia: comp }, select: { tipo: true, valorCentavos: true } }, folhas: { where: { competencia: comp, ativa: true } } },
  });
  const linhas = await Promise.all(pessoas.map(async (p) => {
    const soma = (tipos: string[]) => p.lancamentosFolha.filter((l) => tipos.includes(l.tipo)).reduce((t, l) => t + l.valorCentavos, 0);
    const f = p.folhas[0];
    const memoria = f ? lerMemoriaFolha(f.detalhe) : null;
    const barbeiroId = f?.barbeiroIdCongelado ?? (memoria?.barbeiroId !== undefined ? memoria.barbeiroId : p.barbeiroId);
    if (!barbeiroId) return null;
    const salario = await lerVigenciaRemuneracao<{ salarioCentavos: number }>(c, `salario:${p.id}`, comp);
    const info: FolhaBarbeiro = { salario: f?.salarioCentavos ?? (salario ? salarioVigente(salario.conteudo) : p.salarioCentavos), bonus: f?.adicionaisCentavos ?? soma(SOMA), descontos: f?.descontosCentavos ?? soma(["VALE", "DESCONTO"]), congelado: f?.liquidoCentavos ?? null, comissaoCongelada: f?.comissaoCentavos ?? null, memoria, status: f ? f.status : "ABERTA" };
    return [barbeiroId, info] as const;
  }));
  const mapa = new Map<string, FolhaBarbeiro>();
  for (const l of linhas) if (l) {
    const atual = mapa.get(l[0]);
    if (atual && atual.status !== "ABERTA" && l[1].status !== "ABERTA") throw new ErroNegocio("Há duas folhas históricas para a mesma cadeira. Confira as identidades antes de usar o relatório.", 409, "cadeira_folha_duplicada");
    if (!atual || atual.status === "ABERTA") mapa.set(l[0], l[1]);
  }
  return mapa;
}
