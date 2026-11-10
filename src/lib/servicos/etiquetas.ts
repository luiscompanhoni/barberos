import { z } from "zod";

export const FORMATOS_ETIQUETA = ["PILULA", "ARREDONDADA", "RETANGULAR"] as const;
export const MAX_ETIQUETAS_SERVICO = 6;
export const zEtiquetaServico = z.object({
  texto: z.string().trim().min(1, "Informe o texto da etiqueta.").max(40, "Use até 40 caracteres.")
    .regex(/^[^<>\u0000-\u001f\u007f]+$/, "Use texto simples, sem HTML ou caracteres de controle."),
  cor: z.string().regex(/^#[0-9a-f]{6}$/i, "Informe uma cor no formato #RRGGBB.").transform(cor => cor.toUpperCase()),
  formato: z.enum(FORMATOS_ETIQUETA),
}).strict();
export const zEtiquetasServico = z.array(zEtiquetaServico).max(MAX_ETIQUETAS_SERVICO);
export const zSalvarEtiquetasServico = z.object({
  versao: z.number().int().nonnegative().max(2_147_483_646),
  etiquetas: zEtiquetasServico,
}).strict();
export type EtiquetaServico = z.infer<typeof zEtiquetaServico>;
export type EtiquetasServicoResposta = { etiquetas: EtiquetaServico[]; versao: number };

/** O catálogo público só projeta o contrato conhecido, inclusive em dados legados. */
export function etiquetasDoServico(valor: unknown): EtiquetaServico[] {
  const resultado = zEtiquetasServico.safeParse(valor);
  return resultado.success ? resultado.data : [];
}

/** Escolhe a maior razão de contraste entre preto e branco para qualquer cor válida. */
export function textoDaEtiqueta(cor: string): "#000000" | "#FFFFFF" {
  if (!/^#[0-9a-f]{6}$/i.test(cor)) return "#000000";
  const canais = [1, 3, 5].map(i => parseInt(cor.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminancia = canais[0] * 0.2126 + canais[1] * 0.7152 + canais[2] * 0.0722;
  return (luminancia + 0.05) / 0.05 >= 1.05 / (luminancia + 0.05) ? "#000000" : "#FFFFFF";
}

export function raioDaEtiqueta(formato: EtiquetaServico["formato"]) {
  return formato === "PILULA" ? "999px" : formato === "ARREDONDADA" ? "8px" : "0px";
}
