import { z } from "zod";
import { ErroNegocio, proibido } from "@/lib/erros";
import { urlPainel, urlSite } from "@/lib/dominios";
import { json } from "@/lib/estudio/http";
import { dataLocal, instanteLocal, somarDias } from "./tempo";

export const entradaPedido = z.object({
  chave: z.uuid(),
  servicoIds: z.array(z.string().min(1).max(40)).min(1).max(10).refine(ids => new Set(ids).size === ids.length, "Selecione serviços diferentes."),
  barbeiroId: z.string().min(1).max(40).nullable(),
  dataPreferida: z.iso.date(),
  horaPreferida: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  observacao: z.string().trim().max(500).default(""),
}).strict();
export type EntradaPedido = z.infer<typeof entradaPedido>;

export function validarPreferencia(p: Pick<EntradaPedido, "dataPreferida" | "horaPreferida">, cfg: { fuso: string; janelaAgendamentoDias: number; antecedenciaMinimaMin: number }, agora = Date.now()) {
  const hoje = dataLocal(agora, cfg.fuso);
  const [h, m] = p.horaPreferida.split(":").map(Number);
  const inicio = instanteLocal(p.dataPreferida, h * 60 + m, cfg.fuso);
  if (p.dataPreferida < hoje || p.dataPreferida > somarDias(hoje, cfg.janelaAgendamentoDias) || inicio < agora + cfg.antecedenciaMinimaMin * 60_000) {
    throw new ErroNegocio("Escolha uma preferência futura, dentro do período disponível para solicitar.", 422, "preferencia_invalida");
  }
}

export function mesmoPedido(a: { servicoIds: unknown; barbeiroId: string | null; dataPreferida: string; horaPreferida: string; observacao: string | null }, b: EntradaPedido) {
  return JSON.stringify(a.servicoIds) === JSON.stringify(b.servicoIds) && a.barbeiroId === b.barbeiroId && a.dataPreferida === b.dataPreferida && a.horaPreferida === b.horaPreferida && (a.observacao ?? "") === b.observacao;
}

/** Cada superfície só aceita sua própria origem; não inclui dados do pedido na URL. */
export async function corpoPedido<T>(req: Request, schema: z.ZodType<T>, equipe = false) {
  const origem = req.headers.get("origin"), permitida = new URL(equipe ? urlPainel() : urlSite()).origin;
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origem && origem !== permitida)) throw proibido();
  return json(req, schema);
}
