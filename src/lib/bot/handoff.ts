import { db } from "@/lib/db";
import { publicar } from "@/lib/eventos";
import type Anthropic from "@anthropic-ai/sdk";

export const FERRAMENTA_ATENDENTE: Anthropic.Beta.BetaTool = {
  name: "chamar_atendente",
  description: "Passa a conversa para uma pessoa da equipe (o bot para de responder). Use quando o cliente pedir, reclamar, ou o assunto fugir de agendamentos e informações da barbearia.",
  input_schema: {
    type: "object",
    properties: {
      motivo: { type: "string", description: "Motivo do encaminhamento, sem CPF, cartão ou segredo." },
      resumo: { type: "string", description: "Resumo interno: pedido do cliente, o que foi realmente verificado e pendência/próximo passo. Sem dados de cartão, CPF, senha, OTP ou links individuais." },
    },
    required: ["motivo"], additionalProperties: false,
  },
};

export async function transferirComResumo(conversaId: string, motivo: string, resumo?: string) {
  const nota = `Bot pediu atendente: ${motivo}${resumo ? `\nResumo: ${resumo}` : ""}`
    .replace(/https?:\/\/\S+/gi, "[link omitido]")
    .replace(/\b\d{3}[. ]?\d{3}[. ]?\d{3}[- ]?\d{2}\b/g, "[documento omitido]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[número omitido]");
  // Estado e nota são indivisíveis: não deixar a equipe sem contexto.
  await db.$transaction(async tx => {
    await tx.conversa.update({ where: { id: conversaId }, data: { estado: "HUMANO" } });
    await tx.mensagem.create({ data: { conversaId, autor: "NOTA", texto: nota } });
  });
  publicar({ tipo: "conversa", conversaId });
}
