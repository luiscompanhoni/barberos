import { db } from "@/lib/db";
import { configuracao } from "@/lib/agenda/carregar";
import { capacidadeDaAgenda } from "@/lib/campanhas/capacidade";
import { indicadoresDoNegocio } from "@/lib/indicadores/negocio";
import { resolverPeriodo } from "@/lib/indicadores/periodo";
import { obterAgente } from "./catalogo";
import { integracoesAgentes } from "./integracoes";
import { configurarMeta, consultarInsights } from "./meta";
import { dataLocal, somarDias } from "@/lib/agenda/tempo";

import { CONHECIMENTO_BLACK } from "./conhecimento-black";
import { CONHECIMENTO_CRESCIMENTO_BLACK } from "./conhecimento-crescimento";

type Fonte = { nome: string; consultadoEm: string; dados: unknown };
export type ContextoAgente = { fontes: Fonte[]; integracoes: ReturnType<typeof integracoesAgentes>; limites: string[]; anterior: unknown };

/** Somente leituras delimitadas por especialidade, sem contatos pessoais nem credenciais. */
export async function contextoAgente(agenteId: string, usuarioId: string, anterior: unknown = null): Promise<ContextoAgente> {
  const a = obterAgente(agenteId), agora = new Date();
  const cfg = await configuracao();
  const fontes: Fonte[] = [{ nome: "Configuração da barbearia", consultadoEm: agora.toISOString(), dados: { nome: cfg.nomeBarbearia, fuso: cfg.fuso, endereco: cfg.endereco } }];
  fontes.push({ nome: "Base Black aprovada — " + CONHECIMENTO_BLACK.id, consultadoEm: agora.toISOString(), dados: CONHECIMENTO_BLACK });
  if (a.grupo === "crescimento" || agenteId === "assistente" || agenteId === "dados") fontes.push({ nome: "Plano de crescimento aprovado — " + CONHECIMENTO_CRESCIMENTO_BLACK.id, consultadoEm: agora.toISOString(), dados: CONHECIMENTO_CRESCIMENTO_BLACK });
  const loaders: Record<string, () => Promise<unknown>> = {
    negocio: () => db.servico.findMany({ where: { ativo: true }, select: { id: true, nome: true, duracaoMin: true, precoCentavos: true }, take: 100, orderBy: { nome: "asc" } }),
    agenda: async () => { const c = await capacidadeDaAgenda(+agora); return { hoje: c.hoje, horizontes: c.horizontes, servico: c.servico, observacao: "Disponibilidade é uma fotografia; reservar exige revalidar no serviço de agenda." }; },
    financeiro: async () => {
      const [pendentes, cobrancas] = await Promise.all([
        db.despesa.aggregate({ where: { status: "PENDENTE" }, _sum: { valorCentavos: true }, _count: true }),
        db.cobranca.groupBy({ by: ["status"], _count: true, _sum: { valorCentavos: true } }),
      ]);
      return { pendentes, cobrancas, ressalva: "Situação cadastral, não prova de conciliação bancária. Identidades e vínculos divergentes precisam de revisão; não inferir dívida só deste total." };
    },
    equipe: () => db.barbeiro.findMany({ where: { ativo: true }, select: { id: true, nome: true }, take: 100 }),
    clientes: () => db.cliente.groupBy({ by: ["origem"], _count: true }),
    conteudo: () => db.estudioProjeto.findMany({ where: { usuarioId }, select: { id: true, nome: true, versoes: { select: { id: true, estado: true, numero: true, sha256: true }, take: 3, orderBy: { numero: "desc" } } }, take: 10, orderBy: { atualizadoEm: "desc" } }),
    campanhas: async () => ({ canal: "WHATSAPP", unidadeLimiteDiario: "mensagens", observacao: "Limite de mensagens por campanha; não representa orçamento de anúncios nem valor monetário.", campanhas: await db.campanha.findMany({ select: { id: true, nome: true, status: true, limiteDiario: true }, orderBy: { criadoEm: "desc" }, take: 20 }) }),
    recrutamento: () => db.candidaturaRecrutamento.groupBy({ by: ["etapa"], _count: true }),
  };
  await Promise.all(a.dados.map(async categoria => { fontes.push({ nome: categoria, consultadoEm: agora.toISOString(), dados: await loaders[categoria]() }); }));
  if (["dados", "estrategia", "assistente"].includes(agenteId)) {
    const periodo = resolverPeriodo("30d", cfg.fuso, +agora);
    const dados = await indicadoresDoNegocio(periodo, +agora);
    fontes.push({ nome: "Indicadores operacionais (não equivalem a saldo bancário)", consultadoEm: agora.toISOString(), dados: {
      periodo, fuso: cfg.fuso, atual: dados.atual, anterior: dados.anterior, agenda: dados.agenda,
      clientes: { novos: dados.clientes.novos, origens: dados.clientes.origens, frequencia: dados.clientes.frequencia, retorno: dados.clientes.retorno },
      indicacoes: { novas: dados.indicacoes.novas, convertidas: dados.indicacoes.convertidas },
    } });
  }
  if (["trafego", "dados"].includes(agenteId) && configurarMeta().disponivel) {
    const hoje = dataLocal(+agora, cfg.fuso);
    const relatorio = await consultarInsights({ de: somarDias(hoje, -7), ate: somarDias(hoje, -1) });
    fontes.push({ nome: "Meta Ads — atribuição do provedor, não receita de caixa", consultadoEm: agora.toISOString(), dados: relatorio.fuso === cfg.fuso ? relatorio : { pendencia: "Fuso da conta Meta difere da barbearia. Harmonize o período antes de analisar resultados." } });
  }
  return { fontes, integracoes: integracoesAgentes(), anterior, limites: [
    "A central só produz análises, rascunhos e tarefas internas. Nenhum envio, pagamento ou anúncio é executado.",
    "Não há dados de venda de software neste escopo.",
    "Totais cadastrais e atribuição Meta não provam conciliação, causalidade ou retorno financeiro incremental.",
  ] };
}
