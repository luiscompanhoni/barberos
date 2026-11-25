/**
 * Ferramentas do bot para planos de assinatura.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { MOTIVOS, ROTULO_MOTIVO } from "@/lib/assinaturas/retencao-regras";
import { assinar, entrarNaListaDeEspera, situacaoDoCliente, vagasRestantes, verificarNovaAdesao } from "@/lib/assinaturas/servico";
import { executarCancelamento } from "./ferramentas-cancelamento";
import type { ContextoBot, ResultadoFerramenta } from "./ferramentas";
import { linkDaMensalidadeParaAtendimento } from "@/lib/assinaturas/link-atendimento";
import { alteracaoAtual, classificacaoTroca, solicitarAlteracaoPlano } from "@/lib/assinaturas/alteracao-plano";
import { ehCashbarber } from "@/lib/pagamentos/retencao-gateway";
import { urlSite } from "@/lib/dominios";
import { confirmouTrocaNoWhatsApp } from "./confirmacao-plano";
import { ofertaTesteVenda, assinaturaTesteUnico } from "@/lib/assinaturas/teste-venda";
import { adesaoLeonelDisponivel, linkDeAdesaoLeonel } from "@/lib/assinaturas/adesao-leonel";
import { ofertaDezembroEmHomologacao } from "@/lib/oferta-dezembro/config";

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
const dataBr = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : null);
const orientarOfertaDezembro = () => ofertaDezembroEmHomologacao()
  ? `Dezembro Grátis está em homologação. Consulte o contrato e as datas simuladas em ${urlSite()}/c/dezembro-gratis.`
  : "Peça à equipe para conferir a assinatura antes de orientar pagamento ou nova adesão.";
const CONFERIR_CASHBARBER = {
  cobranca_externa: true,
  em_conferencia: true,
  orientar: "A mensalidade é gerida no CashBarber. Use chamar_atendente para a equipe conferir o ciclo na Celcoin. O cadastro local não confirma dívida nem quitação. Não envie link, não gere Pix e não sugira nova adesão para pagar.",
} as const;

const MOTIVOS_DESCRICAO = MOTIVOS.map((m) => `${m} = ${ROTULO_MOTIVO[m]}`).join("; ");

export const FERRAMENTAS_ASSINATURA: Anthropic.Beta.BetaTool[] = [
  {
    name: "listar_planos",
    description: "Planos de assinatura à venda: preço mensal, o que inclui, regras (intervalo entre visitas, dias) e vagas.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "minha_assinatura",
    description: "Situação do plano do cliente desta conversa: status, próxima mensalidade e link de pagamento em aberto.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "link_pagamento_assinatura",
    description: "Use no pedido de link de uma assinatura existente. Distingue fatura vigente, plano ativo sem fatura em aberto e cobrança em conferência. Informe PIX se solicitado. Não gera outra mensalidade.",
    input_schema: { type: "object", properties: { forma: { type: "string", enum: ["PIX", "CARTAO", "BOLETO"] } }, additionalProperties: false },
  },
  {
    name: "link_adesao_plano",
    description: "Cria o link de checkout de uma nova adesão para o número desta conversa. Use depois que o cliente escolher um plano e aceitar o valor mensal e o cartão no app. O cliente faz cadastro e confirma o pagamento no próprio app.",
    input_schema: { type: "object", properties: { plano_id: { type: "string" } }, required: ["plano_id"], additionalProperties: false },
  },
  {
    name: "solicitar_troca_plano",
    description: "Registra pedido de upgrade/downgrade para a renovação. Primeiro informe nome, preço e data do novo plano usando listar_planos e minha_assinatura; só execute após confirmação explícita do titular.",
    input_schema: { type: "object", properties: { plano_id: { type: "string" }, nome_conferido: { type: "string" },
      preco_conferido_centavos: { type: "integer" }, renovacao_conferida: { type: "string", description: "AAAA-MM-DD" } },
      required: ["plano_id", "nome_conferido", "preco_conferido_centavos", "renovacao_conferida"], additionalProperties: false },
  },
  {
    name: "assinar_plano",
    description:
      "Ferramenta legada de adesão. Para venda pelo Leonel use link_adesao_plano e deixe cadastro e pagamento no app.",
    input_schema: {
      type: "object",
      properties: {
        plano_id: { type: "string" },
        forma_pagamento: { type: "string", enum: ["PIX", "CARTAO", "BOLETO"] },
        cpf: { type: "string", description: "CPF do cliente (só números ou com pontos)" },
        email: { type: "string", description: "E-mail do cliente (o meio de pagamento pode exigir)" },
        nome_cliente: { type: "string", description: "Obrigatório se o cliente ainda não tem cadastro" },
      },
      required: ["plano_id", "forma_pagamento"],
      additionalProperties: false,
    },
  },
  {
    name: "entrar_lista_espera",
    description: "Coloca o cliente na lista de espera de um plano esgotado. Avisamos no WhatsApp quando abrir vaga.",
    input_schema: {
      type: "object",
      properties: { plano_id: { type: "string" } },
      required: ["plano_id"],
      additionalProperties: false,
    },
  },
  {
    name: "oferta_cancelamento",
    description:
      "Cliente quer cancelar o plano: use o motivo informado ou OUTRO se não informar/recusar; motivo não é obrigatório para atender ao pedido. Devolve a oferta da barbearia (desconto, pausa, falar com o gerente ou nenhuma) e até quando o plano vale. Não insista em retenção já recusada nem em cobrança após pedido anterior.",
    input_schema: {
      type: "object",
      properties: { motivo: { type: "string", enum: [...MOTIVOS], description: MOTIVOS_DESCRICAO } },
      required: ["motivo"],
      additionalProperties: false,
    },
  },
  {
    name: "cancelar_assinatura",
    description:
      "Executa a decisão do cliente sobre o cancelamento, depois de oferta_cancelamento: aceitar_desconto, pausar (com dias), falar_com_gerente ou cancelar. Só use a decisão que o cliente escolheu claramente.",
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string", enum: [...MOTIVOS], description: MOTIVOS_DESCRICAO },
        decisao: { type: "string", enum: ["aceitar_desconto", "pausar", "falar_com_gerente", "cancelar"] },
        dias: { type: "number", description: "Só para pausar: uma das opções de dias devolvidas pela oferta" },
        detalhe: { type: "string", description: "O que o cliente contou, em poucas palavras" },
      },
      required: ["motivo", "decisao"],
      additionalProperties: false,
    },
  },
];

const ENTRADAS = {
  assinar_plano: z.object({
    plano_id: z.string(),
    forma_pagamento: z.enum(["PIX", "CARTAO", "BOLETO"]),
    cpf: z.string().max(20).optional(),
    email: z.string().trim().max(120).optional(),
    nome_cliente: z.string().trim().max(80).optional(),
  }),
  entrar_lista_espera: z.object({ plano_id: z.string() }),
  oferta_cancelamento: z.object({ motivo: z.enum(MOTIVOS) }),
  cancelar_assinatura: z.object({
    motivo: z.enum(MOTIVOS),
    decisao: z.enum(["aceitar_desconto", "pausar", "falar_com_gerente", "cancelar"]),
    dias: z.number().int().min(1).max(365).optional(),
    detalhe: z.string().max(200).optional(),
  }),
};

export const NOMES_ASSINATURA = new Set(FERRAMENTAS_ASSINATURA.map((f) => f.name));

async function clienteGarantido(ctx: ContextoBot, nome?: string) {
  const c = await db.cliente.findUnique({ where: { telefone: ctx.telefone } });
  if (c?.nome.trim()) return c;
  if (!nome?.trim()) return null;
  const novo = await db.cliente.upsert({
    where: { telefone: ctx.telefone },
    create: { telefone: ctx.telefone, nome: nome.trim() },
    update: { nome: nome.trim() },
  });
  await db.conversa.update({ where: { id: ctx.conversaId }, data: { clienteId: novo.id } });
  return novo;
}

export async function executarAssinatura(nome: string, entrada: unknown, ctx: ContextoBot): Promise<ResultadoFerramenta> {
  switch (nome) {
    case "listar_planos": {
      const teste = ofertaTesteVenda();
      const titularTeste = teste && await db.cliente.findUnique({ where: { telefone: ctx.telefone }, select: { id: true, excluidoEm: true } });
      const interno = teste && titularTeste?.id === teste.clienteId && !titularTeste.excluidoEm ? teste : null;
      const planos = await db.plano.findMany({
        where: { ativo: true, ...(interno ? { OR: [{ visivel: true }, { id: interno.planoId, visivel: false, precoCentavos: 100 }] } : { visivel: true }) },
        orderBy: [{ ordem: "asc" }, { precoCentavos: "asc" }],
        include: { servicos: { include: { servico: { select: { nome: true } } } } },
      });
      if (!planos.length) return { texto: "A barbearia não tem planos de assinatura à venda no momento." };
      return {
        texto: JSON.stringify(
          await Promise.all(
            planos.map(async (p) => ({
              plano_id: p.id,
              nome: p.nome,
              preco_mensal: reais(p.precoCentavos),
              preco_mensal_centavos: p.precoCentavos,
              ...(interno?.planoId === p.id ? { teste_interno: true, cobranca_unica: true, sem_renovacao_automatica: true, valor_total_teste: "R$ 1,00" } : {}),
              descricao: p.descricao,
              disponivel_para_compra: p.compravel && !p.vendaSomenteEquipe,
              venda_somente_equipe: p.vendaSomenteEquipe,
              condicoes: p.vendaSomenteEquipe ? "Visível para consulta; contratação somente pela recepção. Chame a equipe se o cliente quiser contratar." : p.compravel ? null : "Consulte as condições com a equipe; não está disponível para compra ou lista de espera.",
              inclui: p.servicos.map((s) => s.servico.nome + (s.usosPorCiclo ? ` (${s.usosPorCiclo}x por mês)` : " (à vontade)")),
              intervalo_entre_visitas_dias: p.intervaloMinDias,
              dias_validos: p.diasSemana.length && p.diasSemana.length < 7 ? [...p.diasSemana].sort().map((d) => DIAS[d]) : "todos os dias de funcionamento",
              desconto_outros_servicos: p.descontoExtrasPct ? `${p.descontoExtrasPct}%` : null,
              formas_pagamento: p.formasPagamento,
              vagas_restantes: await vagasRestantes(p),
            })),
          ),
        ),
      };
    }
    case "minha_assinatura": {
      const c = await db.cliente.findUnique({ where: { telefone: ctx.telefone } });
      const sit = c && !c.excluidoEm ? await situacaoDoCliente(c.id) : null;
      if (!sit) return { texto: "Não encontrei um plano em andamento no BarberOS. Se o titular relata ter plano no sistema antigo, peça à equipe para conferir o vínculo no CashBarber antes de orientar pagamento ou adesão." };
      const a = sit.assinatura;
      if (a.ofertaDezembro) return { texto: orientarOfertaDezembro() };
      if (ehCashbarber(a.gatewayId)) {
        return { texto: JSON.stringify({
          plano: a.plano.nome,
          pode_usar_o_plano: sit.valida,
          ...CONFERIR_CASHBARBER,
        }) };
      }
      const pagamento = sit.cobrancaEmAberto && c ? await linkDaMensalidadeParaAtendimento(c.id, sit.cobrancaEmAberto.id) : null;
      const renovacao = a.encerraEm ? null : a.proximoVencimento;
      return {
        texto: JSON.stringify({
          plano: a.plano.nome,
          status: a.status === "PENDENTE" ? "aguardando primeiro pagamento" : a.status === "ATIVA" ? "ativo" : "mensalidade atrasada",
          pode_usar_o_plano: sit.valida,
          mensalidade: reais(a.precoCentavos),
          ...(assinaturaTesteUnico(a) ? { teste_interno: true, cobranca_unica: true, sem_renovacao_automatica: true } : {}),
          forma_pagamento: a.formaPagamento,
          proxima_mensalidade: dataBr(renovacao),
          proxima_mensalidade_iso: renovacao?.toISOString().slice(0, 10) ?? null,
          ...(a.encerraEm ? { encerramento_agendado_em: dataBr(a.encerraEm) } : {}),
          troca_solicitada: await alteracaoAtual(a.id),
          pagamento_em_aberto: sit.cobrancaEmAberto && {
            valor: reais(sit.cobrancaEmAberto.valorCentavos),
            vencimento: dataBr(sit.cobrancaEmAberto.vencimento),
            ...pagamento,
          },
        }),
      };
    }
    case "link_pagamento_assinatura": {
      const e = z.object({ forma: z.enum(["PIX", "CARTAO", "BOLETO"]).optional() }).strict().parse(entrada);
      const c = await db.cliente.findUnique({ where: { telefone: ctx.telefone } });
      const sit = c && !c.excluidoEm ? await situacaoDoCliente(c.id) : null;
      if (!sit || !c) return { texto: JSON.stringify({ assinatura_local: false, orientar: "Se a pessoa já paga um plano, confira o vínculo na equipe. Se quer contratar, apresente os planos atuais e ofereça o checkout depois da escolha." }) };
      const a = sit.assinatura;
      if (a.ofertaDezembro) return { texto: orientarOfertaDezembro(), erro: true };
      if (ehCashbarber(a.gatewayId)) return { texto: JSON.stringify(CONFERIR_CASHBARBER), erro: true };
      const aberta = sit.cobrancaEmAberto;
      const pagamento = aberta && (!e.forma || aberta.forma === e.forma)
        ? await linkDaMensalidadeParaAtendimento(c.id, aberta.id) : null;
      const portal = `${urlSite()}/c/planos`;
      if (pagamento?.link) return { texto: JSON.stringify({ link: pagamento.link, forma: aberta?.forma, cobranca_existente: true }) };
      if (!aberta && a.status === "ATIVA" && sit.valida && !sit.pausada && !a.operacaoInicial &&
        (!a.encerraEm || +a.encerraEm > Date.now())) {
        return { texto: JSON.stringify({ cobranca_aberta_encontrada: false, forma_atual: a.formaPagamento, link_area_do_plano: portal,
          ...(a.encerraEm ? { encerramento_agendado_em: dataBr(a.encerraEm) } : {}),
          orientar: a.encerraEm
            ? "Diga que o BarberOS não encontrou mensalidade em aberto e informe a data de encerramento agendado. Se o titular viu uma pendência, pergunte de qual mês. Não declare quitação nem prometa renovação."
            : "Explique que o BarberOS não encontrou mensalidade em aberto. Se for cartão, diga que a forma atual é recorrente. Pode enviar a área do plano. Se o titular viu uma pendência, pergunte de qual mês. Não transfira só por estar no cartão e não declare quitação." }) };
      }
      if (a.status === "PENDENTE" && a.tokenPublico && !a.operacaoInicial && (!e.forma || a.plano.formasPagamento.includes(e.forma))) {
        return { texto: JSON.stringify({ link: portal, orientar: "Abra a assinatura pendente no app e confira as opções de pagamento disponíveis." }) };
      }
      if (a.formaPagamento === "CARTAO" || aberta || a.operacaoInicial) {
        return { texto: JSON.stringify({ link: portal, em_conferencia: true, orientar: "Confira com a equipe a cobrança e as tentativas do cartão antes de gerar outro Pix. Não diga que o cartão foi trocado ou suspenso." }), erro: true };
      }
      return { texto: JSON.stringify({ link: portal, orientar: "Não há um link vigente confirmado. Confira a assinatura no app." }) };
    }
    case "link_adesao_plano": {
      const e = z.object({ plano_id: z.string().min(1).max(40) }).strict().parse(entrada);
      const c = await db.cliente.findUnique({ where: { telefone: ctx.telefone }, select: { id: true, excluidoEm: true } });
      if (c?.excluidoEm) return { texto: "A recepção precisa conferir o cadastro antes de contratar.", erro: true };
      if (c && await situacaoDoCliente(c.id)) return { texto: "Já existe uma assinatura em andamento. Use link_pagamento_assinatura para conferir a situação antes de orientar pagamento.", erro: true };
      const plano = await db.plano.findFirst({ where: { id: e.plano_id, ativo: true, visivel: true, compravel: true, vendaSomenteEquipe: false,
        formasPagamento: { has: "CARTAO" } } });
      if (!plano || await vagasRestantes(plano) === 0) return { texto: "Esse plano não está disponível para adesão por cartão. Confira o catálogo antes de oferecer outra opção.", erro: true };
      const link = linkDeAdesaoLeonel(ctx.telefone, plano);
      if (!link) return { texto: "O checkout de novas adesões ainda não está disponível. Informe isso sem prometer nova cobrança.", erro: true };
      return { texto: JSON.stringify({ link, plano: plano.nome, valor_mensal: reais(plano.precoCentavos), forma: "CARTAO",
        orientar: "Envie o link ao cliente. Ele entra com o número desta conversa, completa o cadastro se necessário, confere as condições e confirma com cartão no app." }) };
    }
    case "solicitar_troca_plano": {
      const e = z.object({ plano_id: z.string().min(1).max(40), nome_conferido: z.string().trim().min(2).max(100),
        preco_conferido_centavos: z.number().int().nonnegative(), renovacao_conferida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().parse(entrada);
      const c = await db.cliente.findUnique({ where: { telefone: ctx.telefone }, select: {
        id: true, excluidoEm: true, usuario: { select: { id: true, ativo: true, telefone: true, telefoneVerificadoEm: true, papel: true } },
      } });
      if (!c || c.excluidoEm || !c.usuario?.ativo || !c.usuario.telefoneVerificadoEm || c.usuario.telefone !== ctx.telefone || c.usuario.papel !== "CLIENTE") {
        return { texto: `Para solicitar a troca, entre com sua conta verificada em ${urlSite()}/c/planos.`, erro: true };
      }
      if (!confirmouTrocaNoWhatsApp(ctx.textoEntrada)) {
        return { texto: "Peça confirmação escrita da troca depois de informar o novo plano, valor e renovação.", erro: true };
      }
      const sit = await situacaoDoCliente(c.id);
      if (!sit) return { texto: "Nenhuma assinatura em andamento para trocar.", erro: true };
      const p = await solicitarAlteracaoPlano({ assinaturaId: sit.assinatura.id, planoId: e.plano_id, origem: "BOT", usuarioId: c.usuario.id,
        esperado: { nome: e.nome_conferido, precoCentavos: e.preco_conferido_centavos, renovacao: e.renovacao_conferida } });
      return { texto: JSON.stringify({ pedido: p.estado, tipo: classificacaoTroca(p.precoAnteriorCentavos, p.precoNovoCentavos),
        a_partir_da_renovacao: dataBr(p.efetivaEm), valorCentavos: p.precoNovoCentavos, orientacao: "Pedido registrado. O plano atual permanece até a troca ser aplicada." }) };
    }
    case "assinar_plano": {
      if (adesaoLeonelDisponivel()) return { texto: "Use link_adesao_plano. O cliente faz o cadastro e dá o aceite no checkout.", erro: true };
      const e = ENTRADAS.assinar_plano.parse(entrada);
      if (!await db.cliente.findUnique({ where: { telefone: ctx.telefone }, select: { id: true } })) await verificarNovaAdesao(e.plano_id, "BOT");
      const c = await clienteGarantido(ctx, e.nome_cliente);
      if (!c) return { texto: "Cliente sem cadastro: pergunte o nome dele antes de assinar.", erro: true };
      const r = await assinar({ clienteId: c.id, planoId: e.plano_id, forma: e.forma_pagamento, cpf: e.cpf, email: e.email, origem: "BOT" });
      return {
        texto: r.link
          ? `Assinatura criada, aguardando pagamento. Envie este link ao cliente: ${r.link} . Quando o pagamento cair, ele recebe a confirmação aqui automaticamente.`
          : "Assinatura criada, mas o link não ficou pronto. Peça para o cliente aguardar e chame um atendente.",
      };
    }
    case "entrar_lista_espera": {
      const e = ENTRADAS.entrar_lista_espera.parse(entrada);
      const c = await clienteGarantido(ctx);
      if (!c) return { texto: "Cliente sem cadastro: pergunte o nome dele antes.", erro: true };
      const posicao = await entrarNaListaDeEspera(c.id, e.plano_id);
      return { texto: `Cliente na lista de espera, posição ${posicao}. Ele será avisado aqui quando abrir vaga.` };
    }
    case "oferta_cancelamento":
    case "cancelar_assinatura":
      return executarCancelamento(nome, entrada, ctx);
    default:
      return { texto: `Ferramenta desconhecida: ${nome}`, erro: true };
  }
}
