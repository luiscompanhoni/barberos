/**
 * Comissoes dos barbeiros: regra geral por servico (avulso e plano), excecao por barbeiro
 * e relatorio por periodo a partir dos agendamentos CONCLUIDO.
 */
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { resumoComanda, type ItemRegra, type PagamentoRegra } from "@/lib/comandas/regras";
import { ErroNegocio } from "@/lib/erros";
import { mensalidadesEstornadas } from "@/lib/estornos/financeiro";
import { STATUS_EFETIVOS } from "@/lib/estornos/regras";
import { adicionaisDoCalculo } from "./adicionais";
import { regrasExtras } from "./pote";
import {
  calcularAssinaturas, comissaoProdutos, intervaloCompetencia, REGRA_SUGERIDA, resumirComissoes, SOMA, valorCobradoItem,
  type CategoriaComissao, type Regra, type RegraSalva,
} from "./regras";

const soRegra = (r: Regra): Regra => ({ avulsoTipo: r.avulsoTipo, avulsoValor: r.avulsoValor, planoTipo: r.planoTipo, planoValor: r.planoValor });

/** Tela de configuracao: todos os servicos ativos (sem regra salva vem a sugestao) + excecoes. */
export async function configComissoes() {
  const [servicos, barbeiros, regras] = await Promise.all([
    db.servico.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true, precoCentavos: true } }),
    db.barbeiro.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } }),
    db.comissaoServico.findMany(),
  ]);
  return {
    sugestao: REGRA_SUGERIDA,
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

/** Salva as regras gerais e substitui todas as excecoes. */
export async function salvarComissoes(s: Sessao, d: { gerais: Entrada[]; excecoes: (Entrada & { barbeiroId: string })[] }) {
  [...d.gerais, ...d.excecoes].forEach(validar);
  const chaves = new Set(d.excecoes.map((e) => `${e.servicoId}:${e.barbeiroId}`));
  if (chaves.size !== d.excecoes.length) throw new ErroNegocio("Tem exceção repetida para o mesmo barbeiro e serviço.");
  await db.$transaction(async (tx) => {
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
    await auditar(tx, s.usuarioId, "rh_comissoes_configurar", "comissao", "servicos", { gerais: d.gerais.length, excecoes: d.excecoes.length });
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
export async function relatorioComissoes(inicio: string, fim: string, barbeiroId?: string) {
  if (fim < inicio) throw new ErroNegocio("A data final é antes da inicial.");
  const fuso = (await configuracao()).fuso;
  const janela = { gte: new Date(instanteLocal(inicio, 0, fuso)), lt: new Date(instanteLocal(somarDias(fim, 1), 0, fuso)) };
  const estornadas = await mensalidadesEstornadas();
  const [ags, regras, barbeiros, extras, adicionais, recebido, estornos, itens] = await Promise.all([
    db.agendamento.findMany({
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
    db.comissaoServico.findMany() as Promise<RegraSalva[]>,
    db.barbeiro.findMany({ select: { id: true, nome: true } }),
    regrasExtras(),
    adicionaisDoCalculo(),
    // Mesma conta do resumo do mes: o recebido conta na data do pagamento e o estorno desconta na data em que foi feito.
    db.cobranca.aggregate({ where: { OR: [{ status: "PAGA" }, { status: "ESTORNADA", id: { in: estornadas } }], pagaEm: janela }, _sum: { valorCentavos: true } }),
    db.pedidoEstorno.aggregate({ where: { tipo: "MENSALIDADE", status: { in: STATUS_EFETIVOS }, executadoEm: janela }, _sum: { valorCentavos: true } }),
    db.itemComanda.findMany({
      where: { produtoId: { not: null }, barbeiroId: { not: null }, comanda: { status: "FECHADA", fechadaEm: janela } },
      select: { barbeiroId: true, quantidade: true, precoUnitCentavos: true, produto: { select: { categoria: true } } },
    }),
  ]);
  const { assinaturas: cfgAssinaturas, faixas } = extras;
  const comDia = ags.map((a) => ({ ...a, dia: dataLocal(a.inicio, fuso) }));
  const grupos = resumirComissoes(comDia.filter((a) => !barbeiroId || a.barbeiroId === barbeiroId).map((a) => ({
    id: a.id, barbeiroId: a.barbeiroId, servicoId: a.servicoId, preco: a.assinaturaId ? a.precoCentavos : baseAvulso(a), precoTabela: a.servico.precoCentavos,
    plano: !!a.assinaturaId, dia: a.dia, inicio: a.inicio, cliente: a.cliente.nome, servico: a.servico.nome,
  })), regras, { planoPeloPote: cfgAssinaturas.ativo, adicionais });
  const assinaturas = cfgAssinaturas.ativo
    ? calcularAssinaturas(cfgAssinaturas, { recebidoCentavos: recebido._sum.valorCentavos ?? 0, estornosCentavos: estornos._sum.valorCentavos ?? 0 }, comDia.filter((a) => a.assinaturaId), adicionais)
    : null;
  const produtos = comissaoProdutos(itens.filter((i) => i.produto?.categoria === "BAR" || i.produto?.categoria === "LOJA").map((i) => ({
    barbeiroId: i.barbeiroId!, categoria: i.produto!.categoria as CategoriaComissao, valorCentavos: i.quantidade * i.precoUnitCentavos,
  })), faixas);

  const nomes = new Map(barbeiros.map((b) => [b.id, b.nome]));
  const ids = new Set([...grupos.map((g) => g.barbeiroId), ...(assinaturas?.barbeiros.map((p) => p.barbeiroId) ?? []), ...produtos.keys()]);
  const vazio = { qtd: 0, base: 0, comissao: 0, adicional: 0 };
  const comp = mesInteiro(inicio, fim);
  const folha = comp ? await folhaDoMes(comp, [...ids]) : new Map<string, FolhaBarbeiro>();
  const linhas = [...ids].filter((id) => !barbeiroId || id === barbeiroId).map((id) => {
    const g = grupos.find((x) => x.barbeiroId === id);
    const a = assinaturas?.barbeiros.find((x) => x.barbeiroId === id) ?? null;
    const pr = produtos.get(id) ?? null;
    const comissoes = (g?.total ?? 0) + (a?.comissao ?? 0) + (pr?.comissao ?? 0);
    const f = folha.get(id) ?? null;
    return {
      barbeiroId: id, nome: nomes.get(id) ?? "?", avulso: g?.avulso ?? vazio, plano: g?.plano ?? vazio, assinaturas: a, produtos: pr,
      total: comissoes, semRegra: g?.semRegra ?? 0,
      folha: f && { ...f, totalAPagar: f.salario + comissoes + f.bonus - f.descontos },
      atendimentos: (g?.detalhe ?? []).map((x) => ({ id: x.id, inicio: x.inicio, cliente: x.cliente, servico: x.servico, modalidade: x.modalidade, base: x.base, regra: x.regra, comissao: x.comissao })),
    };
  }).sort((a, b) => b.total - a.total);
  return {
    inicio, fim, competencia: comp, barbeiros: linhas, total: linhas.reduce((t, l) => t + l.total, 0),
    assinaturas: assinaturas && {
      recebidoCentavos: assinaturas.recebidoCentavos, estornosCentavos: assinaturas.estornosCentavos, distribuivelCentavos: assinaturas.distribuivelCentavos,
      creditosTotal: assinaturas.creditosTotal, valorCreditoCentavos: assinaturas.valorCreditoCentavos, percentualBaseBps: assinaturas.percentualBaseBps,
    },
  };
}

type FolhaBarbeiro = { salario: number; bonus: number; descontos: number; status: "ABERTA" | "FECHADA" | "PAGA" };

/** Salario, bonus/adicionais e vales/descontos lancados na folha do mes, por barbeiro (funcionario ligado a ele). */
async function folhaDoMes(comp: string, barbeiroIds: string[]) {
  const pessoas = await db.checklistPessoa.findMany({
    where: { barbeiroId: { in: barbeiroIds } },
    select: { barbeiroId: true, salarioCentavos: true, lancamentosFolha: { where: { competencia: comp }, select: { tipo: true, valorCentavos: true } }, folhas: { where: { competencia: comp }, select: { status: true } } },
  });
  return new Map(pessoas.map((p) => {
    const soma = (tipos: string[]) => p.lancamentosFolha.filter((l) => tipos.includes(l.tipo)).reduce((t, l) => t + l.valorCentavos, 0);
    return [p.barbeiroId!, { salario: p.salarioCentavos, bonus: soma(SOMA), descontos: soma(["VALE", "DESCONTO"]), status: p.folhas[0]?.status ?? "ABERTA" } satisfies FolhaBarbeiro];
  }));
}
