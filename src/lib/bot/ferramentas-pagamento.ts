/**
 * Ferramentas do bot para pagar um horario avulso antes do atendimento.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { antecipadoDisponivel, pagarAntecipado } from "@/lib/agenda/antecipado";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import type { ContextoBot, ResultadoFerramenta } from "./ferramentas";

export const FERRAMENTAS_PAGAMENTO: Anthropic.Beta.BetaTool[] = [
  {
    name: "pagar_horario_antes",
    description:
      "Gera o link para o cliente pagar AGORA um horário avulso já marcado (não serve para horário pelo plano). " +
      "Use quando ele quiser pagar antes de vir. Pergunte se prefere Pix ou cartão. Se faltar CPF ou e-mail, peça e chame de novo. " +
      "Envie o link (e, no Pix, o código copia e cola) exatamente como vier. Se ele cancelar o horário depois de pago, o valor vira saldo.",
    input_schema: {
      type: "object",
      properties: {
        agendamento_id: { type: "string", description: "id de meus_agendamentos" },
        forma: { type: "string", enum: ["PIX", "CARTAO"] },
        cpf: { type: "string", description: "Só se o sistema pedir" },
        email: { type: "string", description: "Só se o sistema pedir" },
      },
      required: ["agendamento_id", "forma"],
      additionalProperties: false,
    },
  },
];

export const NOMES_PAGAMENTO = new Set(FERRAMENTAS_PAGAMENTO.map((f) => f.name));

const ENTRADA = z.object({ agendamento_id: z.string(), forma: z.enum(["PIX", "CARTAO"]), cpf: z.string().max(20).optional(), email: z.string().max(120).optional() });

export async function executarPagamento(nome: string, entrada: unknown, ctx: ContextoBot): Promise<ResultadoFerramenta> {
  if (nome !== "pagar_horario_antes") return { texto: "Ferramenta desconhecida.", erro: true };
  if (!(await antecipadoDisponivel())) return { texto: "Pagamento antecipado indisponível no momento: o cliente paga no balcão.", erro: true };
  const e = ENTRADA.parse(entrada);
  const cliente = await db.cliente.findUnique({ where: { telefone: ctx.telefone } });
  if (!cliente) return { texto: "Cliente sem horários marcados.", erro: true };
  try {
    const p = await pagarAntecipado({ clienteId: cliente.id, agendamentoId: e.agendamento_id, forma: e.forma, cpf: e.cpf, email: e.email });
    return {
      texto: JSON.stringify({
        valor: `R$ ${(p.valorCentavos / 100).toFixed(2).replace(".", ",")}`,
        forma: p.forma,
        link: p.link,
        pix_copia_e_cola: p.pixCopiaECola,
        observacao: "Quando o pagamento cair, o cliente recebe a confirmação aqui no WhatsApp.",
      }),
    };
  } catch (err) {
    if (err instanceof ErroNegocio && (err.codigo === "cpf" || err.codigo === "email")) {
      return { texto: `${err.message} Peça ao cliente e chame de novo com o dado.`, erro: true };
    }
    throw err;
  }
}
