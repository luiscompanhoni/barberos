/**
 * Protótipo offline para estudar supressão. Não é endpoint, não recebe votos
 * reais, não autentica uma pessoa nem prova anonimato ou integridade de votos.
 */
import { z } from "zod";
import { dataLocal } from "@/lib/agenda/tempo";

const profissionalId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const entrada = z.object({
  competencia: mes,
  profissionais: z.array(profissionalId).max(100),
  // Dados fictícios: não receber nome, identificador do cliente, comentário ou horário.
  votos: z.array(z.object({ profissionalId, estrelas: z.number().int().min(1).max(5) }).strict()).max(100_000),
}).strict().superRefine((dados, ctx) => {
  const ids = new Set(dados.profissionais);
  if (ids.size !== dados.profissionais.length) ctx.addIssue({ code: "custom", message: "Profissional duplicado." });
  if (dados.votos.some(v => !ids.has(v.profissionalId))) ctx.addIssue({ code: "custom", message: "Voto aponta profissional fora do período." });
});

/** Apenas um estudo: cinco reduz grupos pequenos, mas não garante anonimato. */
export const LIMIAR_ESTUDO = 5;
export function simularResumoMensal(dados: unknown, agora = Date.now()) {
  const { competencia, profissionais, votos } = entrada.parse(dados);
  if (competencia >= dataLocal(agora, "America/Sao_Paulo").slice(0, 7)) throw new Error("A competência ainda não foi encerrada.");
  const totais = new Map(profissionais.map(id => [id, { qtd: 0, soma: 0 }]));
  for (const voto of votos) {
    const total = totais.get(voto.profissionalId)!;
    total.qtd++; total.soma += voto.estrelas;
  }
  return profissionais.map(id => {
    const total = totais.get(id)!;
    return { profissionalId: id, competencia, media: total.qtd < LIMIAR_ESTUDO ? null : Math.round((total.soma / total.qtd) * 10) / 10 };
  });
}
