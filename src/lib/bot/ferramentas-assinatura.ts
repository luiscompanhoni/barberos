/**
 * Ferramentas do bot para planos de assinatura.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { MOTIVOS_CANCELAMENTO } from "@/lib/assinaturas/schemas";
import { assinar, cancelar, entrarNaListaDeEspera, situacaoDoCliente, vagasRestantes } from "@/lib/assinaturas/servico";
import type { ContextoBot, ResultadoFerramenta } from "./ferramentas";

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
const dataBr = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : null);

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
    name: "assinar_plano",
    description:
      "Gera a assinatura e devolve o link de pagamento para o cliente. Só chame depois que ele escolher o plano e a forma de pagamento e informar o CPF (exigido pelo meio de pagamento).",
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
    name: "cancelar_assinatura",
    description:
      "Cancela o plano do cliente. Antes, pergunte o motivo e ofereça uma alternativa (outro horário, plano mais barato, falar com a equipe). Só cancele se ele confirmar.",
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string", enum: [...MOTIVOS_CANCELAMENTO] },
        detalhe: { type: "string", description: "O que o cliente contou, em poucas palavras" },
      },
      required: ["motivo"],
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
  cancelar_assinatura: z.object({ motivo: z.enum(MOTIVOS_CANCELAMENTO), detalhe: z.string().max(200).optional() }),
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
      const planos = await db.plano.findMany({
        where: { ativo: true },
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
              descricao: p.descricao,
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
      const sit = c ? await situacaoDoCliente(c.id) : null;
      if (!sit) return { texto: "O cliente não tem plano de assinatura." };
      const a = sit.assinatura;
      return {
        texto: JSON.stringify({
          plano: a.plano.nome,
          status: a.status === "PENDENTE" ? "aguardando primeiro pagamento" : a.status === "ATIVA" ? "ativo" : "mensalidade atrasada",
          pode_usar_o_plano: sit.valida,
          mensalidade: reais(a.precoCentavos),
          proxima_mensalidade: dataBr(a.proximoVencimento),
          pagamento_em_aberto: sit.cobrancaEmAberto && {
            valor: reais(sit.cobrancaEmAberto.valorCentavos),
            vencimento: dataBr(sit.cobrancaEmAberto.vencimento),
            link: sit.cobrancaEmAberto.link,
          },
        }),
      };
    }
    case "assinar_plano": {
      const e = ENTRADAS.assinar_plano.parse(entrada);
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
    case "cancelar_assinatura": {
      const e = ENTRADAS.cancelar_assinatura.parse(entrada);
      const c = await db.cliente.findUnique({ where: { telefone: ctx.telefone } });
      const sit = c ? await situacaoDoCliente(c.id) : null;
      if (!sit) return { texto: "O cliente não tem assinatura para cancelar.", erro: true };
      await cancelar(sit.assinatura.id, e.detalhe ? `${e.motivo}: ${e.detalhe}` : e.motivo, null, { avisar: false });
      return { texto: `Assinatura do ${sit.assinatura.plano.nome} cancelada. Horários já marcados continuam, como avulsos.` };
    }
    default:
      return { texto: `Ferramenta desconhecida: ${nome}`, erro: true };
  }
}
