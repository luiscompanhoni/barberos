import { createHash } from "node:crypto";
import { z } from "zod";
import { obterAgente } from "./catalogo";
import { ErroNegocio } from "@/lib/erros";

export const zAgenteId = z.string().max(40).refine(id => { try { obterAgente(id); return true; } catch { return false; } }, "Agente inválido.");
export const zCriarExecucao = z.object({ agenteId: zAgenteId, tarefa: z.string().trim().min(10).max(6000), chave: z.string().min(8).max(100) }).strict();
export const zAcaoExecucao = z.object({ acao: z.enum(["aprovar", "cancelar", "repetir"]), revisao: z.number().int().nonnegative(), resultadoHash: z.string().length(64).optional() }).strict();
export const zConfigAgentes = z.object({ pausada: z.boolean(), limiteDiario: z.number().int().min(1).max(200), revisao: z.number().int().nonnegative() }).strict();
export const zRotinaAgente = zCriarExecucao.extend({ nome: z.string().trim().min(3).max(120), cadaMinutos: z.number().int().min(60).max(43200), ativa: z.boolean().default(false) }).strict();
export const zAlterarRotina = z.object({ ativa: z.boolean(), revisao: z.number().int().nonnegative() }).strict();
export const zResultadoAgente = z.object({
  resumo: z.string().min(1).max(2000),
  entregaveis: z.array(z.string().min(1).max(6000)).max(12),
  alertas: z.array(z.string().min(1).max(6000)).max(12),
  proximosPassos: z.array(z.object({ agenteId: zAgenteId, tarefa: z.string().trim().min(10).max(2000) }).strict()).max(4),
}).strict();

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === "object") return Object.fromEntries(Object.entries(valor).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, v]) => [k, ordenar(v)]));
  return valor;
}
/** jsonb pode reordenar propriedades; aprovação depende do conteúdo, não da ordem das chaves. */
export function hashAgente(valor: unknown) { return createHash("sha256").update(JSON.stringify(ordenar(JSON.parse(JSON.stringify(valor))))).digest("hex"); }
export function conferirResultado(agenteId: string, valor: unknown) {
  const resultado = zResultadoAgente.parse(valor);
  const agente = obterAgente(agenteId);
  const vistos = new Set<string>();
  for (const p of resultado.proximosPassos) {
    if (vistos.has(p.agenteId) || !(agente.proximos as readonly string[]).includes(p.agenteId) || p.agenteId === agenteId) {
      throw new ErroNegocio("O resultado contém encaminhamento não permitido.", 422, "encaminhamento_invalido");
    }
    vistos.add(p.agenteId);
  }
  return resultado;
}
export function conferirRevisao(atual: number, esperada: number) {
  if (atual !== esperada) throw new ErroNegocio("O registro mudou. Atualize a tela antes de continuar.", 409, "revisao_agente");
}

/** Intervalo móvel para limitar rajadas, sem depender do fuso do host. */
export const inicioLimiteDiario = (agora: Date) => new Date(+agora - 86_400_000);
