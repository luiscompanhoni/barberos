import { z } from "zod";
import { zId } from "@/lib/validacao";

const schema = z.object({
  data: z.iso.date().optional().catch(undefined),
  barbeiroId: zId.optional().catch(undefined),
  servicoId: zId.optional().catch(undefined),
  encaixes: z.enum(["0", "1"]).default("0").catch("0"),
});

/** Parâmetros de navegação não ampliam o escopo de um barbeiro. */
export function entradaAgenda(q: Record<string, string | string[] | undefined>, s: { papel: string; barbeiroId: string | null }, pessoal = false) {
  const v = schema.parse(q);
  return {
    dataInicial: v.data,
    barbeiroInicial: pessoal || s.papel === "BARBEIRO" ? s.barbeiroId ?? undefined : v.barbeiroId,
    servicoInicial: v.servicoId,
    encaixesInicial: v.encaixes === "1",
  };
}

export function queryEntradaAgenda(v: ReturnType<typeof entradaAgenda>) {
  return new URLSearchParams({
    ...(v.dataInicial ? { data: v.dataInicial } : {}),
    ...(v.barbeiroInicial ? { barbeiroId: v.barbeiroInicial } : {}),
    ...(v.servicoInicial ? { servicoId: v.servicoInicial } : {}),
    ...(v.encaixesInicial ? { encaixes: "1" } : {}),
  }).toString();
}
