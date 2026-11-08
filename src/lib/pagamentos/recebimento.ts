import type { CobrancaGateway } from "./gateway";
import { z } from "zod";

const zProva = z.object({ versao: z.literal(1), fonte: z.enum(["celcash", "pagarme", "asaas", "simulado", "conciliacao"]), fonteGateway: z.enum(["celcash", "pagarme", "asaas", "simulado"]).optional(), referencia: z.string().min(1), status: z.string().min(1), campoValor: z.string().min(1), campoData: z.string().min(1), em: z.string(), precisaoData: z.enum(["DIA", "INSTANTE"]).optional(), valorCentavos: z.number().int().min(0).max(2_147_483_647) });
export function fonteProvaRecebimento(v: unknown): "celcash" | "pagarme" | "asaas" | "simulado" | "indefinida" {
  const r = zProva.safeParse(v);
  return !r.success ? "indefinida" : r.data.fonte === "conciliacao" ? r.data.fonteGateway ?? "indefinida" : r.data.fonte;
}
export function provaRecebimentoValida(c: { gatewayId: string; valorRecebidoConfirmadoCentavos: number | null; recebidoConfirmadoEm: Date | null; provaRecebimento: unknown }) {
  const r = zProva.safeParse(c.provaRecebimento);
  return r.success && r.data.referencia === c.gatewayId && r.data.valorCentavos === c.valorRecebidoConfirmadoCentavos && !!c.recebidoConfirmadoEm && instanteRecebimento(r.data.em) === c.recebidoConfirmadoEm.toISOString();
}

export function instanteRecebimento(v: string | null | undefined): string | null {
  if (!v) return null;
  // Datas sem hora são competências locais, nunca meia-noite UTC de outro dia.
  const original = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00-03:00`
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v) ? `${v.replace(" ", "T")}-03:00` : v;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(original)) return null;
  if (+original.slice(11, 13) > 23 || +original.slice(14, 16) > 59 || +original.slice(17, 19) > 59) return null;
  const dia = original.slice(0, 10), calendario = new Date(`${dia}T00:00:00Z`);
  if (!Number.isFinite(+calendario) || calendario.toISOString().slice(0, 10) !== dia) return null;
  const d = new Date(original);
  return Number.isFinite(+d) ? d.toISOString() : null;
}

export const centavosValidos = (v: number | undefined): v is number => Number.isSafeInteger(v) && v! >= 0 && v! <= 2_147_483_647;

/** Sem prova não escreve valor/data e não substitui uma prova anterior por um fallback. */
export function dadosRecebimento(c: CobrancaGateway) {
  const r = c.recebimento;
  const em = r && instanteRecebimento(r.em);
  if (!r || !em || !centavosValidos(r.valorCentavos) || r.referencia !== c.id) return {};
  return { valorRecebidoConfirmadoCentavos: r.valorCentavos, recebidoConfirmadoEm: new Date(em), provaRecebimento: { versao: 1, ...r, em } };
}
