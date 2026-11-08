import { z } from "zod";
import { ErroNegocio } from "@/lib/erros";
const centavos = z.number().int().min(0).max(100_000_000);
const bps = z.number().int().min(0).max(10000);
const regra = z.object({ servicoId: z.string().min(1), barbeiroId: z.string().nullable(), avulsoTipo: z.enum(["PERCENTUAL", "FIXO"]), avulsoValor: centavos, planoTipo: z.enum(["PERCENTUAL", "FIXO"]), planoValor: centavos }).refine(r => (r.avulsoTipo !== "PERCENTUAL" || r.avulsoValor <= 10000) && (r.planoTipo !== "PERCENTUAL" || r.planoValor <= 10000));
const extras = z.object({ assinaturas: z.object({ ativo: z.boolean(), percentualBps: bps, creditos: z.record(z.string(), z.number().int().min(0).max(1000)) }), faixas: z.array(z.object({ categoria: z.enum(["BAR", "LOJA"]), minimoCentavos: centavos, percentualBps: bps })) });
function validar<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new ErroNegocio("A versão da regra de remuneração contém dados inválidos. Confira o histórico antes de calcular.", 409, "remuneracao_invalida");
  return r.data;
}
export const regrasServicoVigentes = (v: unknown) => validar(z.array(regra), v);
export const regrasExtrasVigentes = (v: unknown) => validar(extras, v);
export const salarioVigente = (v: unknown) => validar(z.object({ salarioCentavos: centavos }), v).salarioCentavos;
