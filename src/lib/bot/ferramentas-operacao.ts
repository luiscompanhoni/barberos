import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { BALCAO, GESTAO } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { urlPainel } from "@/lib/dominios";
import { produtosAcabando } from "@/lib/comandas/relatorio";
import { resumoComanda } from "@/lib/comandas/regras";
import { indicadoresDoNegocio } from "@/lib/indicadores/negocio";
import { indicadoresDoBarbeiro } from "@/lib/indicadores/barbeiro";
import { resolverPeriodo } from "@/lib/indicadores/periodo";
import { relatorioComissoes } from "@/lib/rh/comissoes";
import { intervaloCompetencia } from "@/lib/rh/regras";
import { minhasTarefasDoDia } from "@/lib/checklist/servico";
import { criarLancamentoPessoal } from "@/lib/financeiro/pessoal";
import { equipeVerificadaPeloWhatsApp } from "@/lib/whatsapp/equipe-verificada";
import { preferenciaDeAtendimento } from "./historico-atendimento";
import type { ContextoBot, ResultadoFerramenta } from "./ferramentas";

const semParametros = { type: "object", properties: {}, additionalProperties: false } as const;
const erro = (texto: string): ResultadoFerramenta => ({ erro: true, texto });
const json = (dados: unknown): ResultadoFerramenta => ({ texto: JSON.stringify(dados) });
const semAcesso = () => erro("Essa consulta é exclusiva da equipe autorizada. Use sua conta verificada no BarberOS.");

export const FERRAMENTAS_OPERACAO: Anthropic.Beta.BetaTool[] = [
  { name: "consultar_produto", description: "Consulta disponibilidade e preço de produto do bar ou da loja pelo nome. Use se o cliente perguntar.", input_schema: {
    type: "object", properties: { nome: { type: "string" } }, required: ["nome"], additionalProperties: false,
  } },
  { name: "minhas_comandas_abertas", description: "Consulta as comandas abertas do próprio cliente. Use somente se ele perguntar sobre a própria comanda. Não cobra nem fecha.", input_schema: semParametros },
  { name: "minha_preferencia_de_atendimento", description: "Consulta últimos serviço e barbeiro ativos e horário médio das visitas do próprio cliente. Use quando ele aceitar ajuda para marcar ou pedir repetir o atendimento.", input_schema: semParametros },
  { name: "produtos_para_repor", description: "Lista produtos ativos no estoque mínimo ou abaixo dele, para dono, gerente ou recepção verificados.", input_schema: semParametros },
  { name: "indicadores_da_barbearia", description: "Indicadores agregados deste mês, para dono ou gerente verificado.", input_schema: semParametros },
  { name: "minha_receita_e_comissao", description: "Receita e comissão do próprio profissional neste mês, com situação da apuração.", input_schema: semParametros },
  { name: "meu_checklist", description: "Consulta o checklist do próprio integrante da equipe. Não marca tarefas em nome dele.", input_schema: semParametros },
  { name: "registrar_minha_despesa", description: "Registra uma despesa pessoal paga no app do próprio profissional. Use só quando ele informar claramente que gastou ou pedir o lançamento, com valor em reais e descrição.", input_schema: {
    type: "object", properties: { valor_centavos: { type: "integer" }, descricao: { type: "string" }, categoria: { type: "string" } },
    required: ["valor_centavos", "descricao"], additionalProperties: false,
  } },
];

export const NOMES_OPERACAO = new Set(FERRAMENTAS_OPERACAO.map(f => f.name));
export const OPERACOES_PRIVADAS = new Set(FERRAMENTAS_OPERACAO.map(f => f.name).filter(nome => !["consultar_produto", "minha_preferencia_de_atendimento"].includes(nome)));

/** Lê um único valor explicitamente escrito, sem aceitar valores inferidos pelo modelo. */
export function valorDaDespesaWhatsApp(texto?: string | null) {
  if (!texto || /[?]|\b(?:não|nao|talvez|se eu|vou gastar|devo)\b/i.test(texto) || !/\b(?:gastei|paguei|anota(?:r)?|registra(?:r)?|lança(?:r)?)\b/i.test(texto)) return null;
  const valores = [...texto.matchAll(/(?<![\p{L}\d.,+-])(?:(R\$\s*)?([1-9]\d{0,2}(?:\.\d{3}){1,2}|\d{1,7})(?:,(\d{1,2}))?(?![\d]|[.,]\d)(\s*reais\b)?)/giu)]
    .filter(m => m[1] || m[4]);
  if (valores.length !== 1) return null;
  const [, , reais, fracao] = valores[0];
  const centavos = Number(reais.replaceAll(".", "")) * 100 + Number((fracao ?? "").padEnd(2, "0"));
  return centavos > 0 ? centavos : null;
}

async function consultarProduto(entrada: unknown) {
  const { nome } = z.object({ nome: z.string().trim().min(2).max(80) }).strict().parse(entrada);
  const produtos = await db.produto.findMany({
    where: { ativo: true, categoria: { in: ["BAR", "LOJA"] }, nome: { contains: nome, mode: "insensitive" } },
    orderBy: { nome: "asc" }, take: 6, select: { nome: true, estoque: true, precoCentavos: true },
  });
  return json(produtos.map(p => ({ nome: p.nome, disponivel: p.estoque > 0, precoCentavos: p.precoCentavos })));
}

async function minhasComandas(ctx: ContextoBot) {
  const comandas = await db.comanda.findMany({
    where: { cliente: { telefone: ctx.telefone, excluidoEm: null }, status: "ABERTA" },
    orderBy: { abertaEm: "desc" }, select: { numero: true, descontoCentavos: true, itens: true, pagamentos: true },
  });
  return json(comandas.map(c => {
    const r = resumoComanda(c.itens, c.pagamentos, c.descontoCentavos);
    return { numero: c.numero, totalCentavos: r.total, faltaCentavos: r.falta, pagamentoEmConferenciaCentavos: r.aguardando };
  }));
}

export async function executarOperacao(nome: string, entrada: unknown, ctx: ContextoBot): Promise<ResultadoFerramenta> {
  if (nome === "consultar_produto") return consultarProduto(entrada);
  if (nome === "minha_preferencia_de_atendimento") return json(await preferenciaDeAtendimento(ctx.telefone, (await configuracao()).fuso));
  if (nome === "minhas_comandas_abertas") return ctx.textoEntrada && /\b(?:comanda|conta|quanto (?:falta|deu|ficou|devo|preciso pagar)|falta pagar)\b/i.test(ctx.textoEntrada)
    ? minhasComandas(ctx) : erro("Só consulte a comanda se o cliente perguntar sobre ela.");
  const u = await equipeVerificadaPeloWhatsApp(ctx.telefone);
  if (!u) return semAcesso();
  if (nome === "produtos_para_repor") {
    if (!BALCAO.includes(u.papel)) return semAcesso();
    return json((await produtosAcabando()).map(({ nome, estoque, estoqueMinimo, unidade }) => ({ nome, estoque, estoqueMinimo, unidade })));
  }
  if (nome === "meu_checklist") return json(await minhasTarefasDoDia(u.id));
  if (nome !== "indicadores_da_barbearia" && !GESTAO.includes(u.papel) && u.papel !== "BARBEIRO") return semAcesso();
  const cfg = await configuracao();
  const hoje = dataLocal(Date.now(), cfg.fuso);
  const periodo = resolverPeriodo("mes", cfg.fuso);
  if (nome === "indicadores_da_barbearia") {
    if (!GESTAO.includes(u.papel) || !await pode({ usuarioId: u.id, papel: u.papel }, "resultado")) return semAcesso();
    const i = await indicadoresDoNegocio(periodo);
    return json({ periodo: periodo.rotulo, receitaCentavos: i.atual.receita, atendimentos: i.atual.atendimentos,
      clientes: i.atual.clientesUnicos, faltas: i.atual.faltas, recebimentosPendentes: i.atual.recebimentosPendentes, painel: `${urlPainel()}/indicadores` });
  }
  if (nome === "minha_receita_e_comissao") {
    if (!u.barbeiro?.ativo) return semAcesso();
    const mes = intervaloCompetencia(hoje.slice(0, 7));
    const [indicadores, comissao] = await Promise.all([
      indicadoresDoBarbeiro(u.barbeiro.id, periodo),
      relatorioComissoes(mes.inicio, mes.fim, u.barbeiro.id),
    ]);
    const linha = comissao.barbeiros.find(b => b.barbeiroId === u.barbeiro!.id);
    return json({ competencia: comissao.competencia, receitaAvulsaCentavos: indicadores.receitaServicosCentavos,
      vendasProdutosCentavos: indicadores.vendasProdutosCentavos, comissaoCentavos: linha?.total ?? null,
      apuracao: linha?.fonte === "RETRATO_FECHADO" ? "Folha fechada" : "Prévia, sujeita ao fechamento e conciliação",
      recebimentosPendentes: comissao.recebimentos.pendentes > 0 });
  }
  if (nome !== "registrar_minha_despesa") return erro("Ferramenta desconhecida.");
  const b = z.object({ valor_centavos: z.number().int().positive(), descricao: z.string(), categoria: z.string().default("Outros") }).strict().parse(entrada);
  if (!ctx.entradaId || valorDaDespesaWhatsApp(ctx.textoEntrada) !== b.valor_centavos) {
    return erro("Confira a despesa em uma mensagem escrita com valor em reais antes de registrar.");
  }
  const item = await criarLancamentoPessoal(u.id, { tipo: "DESPESA", descricao: b.descricao, categoria: b.categoria,
    valorCentavos: b.valor_centavos, data: hoje, realizado: true }, { id: ctx.entradaId, telefone: ctx.telefone });
  return json({ registrada: true, descricao: item.descricao, valorCentavos: item.valorCentavos, painel: `${urlPainel()}/meu-financeiro` });
}
