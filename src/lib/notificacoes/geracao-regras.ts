import { createHash } from "node:crypto";
import { z } from "zod";

export const dadosAgenda = z.object({
  agendamentoId: z.string().min(1), inicio: z.iso.datetime(),
  tipo: z.enum(["LEMBRETE_VESPERA", "LEMBRETE_PROXIMO"]),
});
export const dadosAvaliacao = z.object({ conviteId: z.string().min(1) });
export const dadosRecompra = z.object({ clienteId: z.string().min(1), ciclos: z.array(z.object({ servicoId: z.string().min(1), ultimaEm: z.iso.datetime() })).min(1) });
export const dadosEquipe = z.object({ barbeiroId: z.string().min(1), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export function chaveAgenda(id: string, inicio: Date, tipo: "LEMBRETE_VESPERA" | "LEMBRETE_PROXIMO") {
  return `agenda:${id}:${inicio.toISOString()}:${tipo}`;
}

/** Uma chave curta por conjunto/ciclo; a ordem dos serviços não muda a identidade. */
export function chaveRecompra(ciclos: { servicoId: string; ultimaEm: string }[], rodada: number) {
  const origem = [...new Set(ciclos.map(c => `${c.servicoId}@${c.ultimaEm}`))].sort().join("|");
  return `recompra:${createHash("sha256").update(origem).digest("hex")}:${rodada}`;
}

export function mesmosCiclos(anteriores: { servicoId: string; ultimaEm: string }[], atuais: { servicoId: string; ultimaEm: string }[]) {
  const atuaisSet = new Set(atuais.map(c => `${c.servicoId}@${c.ultimaEm}`));
  // Qualquer ciclo resolvido torna o aviso antigo impreciso. O próximo lote usa os restantes.
  return anteriores.length > 0 && anteriores.every(c => atuaisSet.has(`${c.servicoId}@${c.ultimaEm}`));
}

export function limiteGeracao(valor: number | undefined) {
  if (valor === undefined) return 50;
  if (!Number.isFinite(valor)) return 50;
  return Math.min(200, Math.max(1, Math.floor(valor)));
}
