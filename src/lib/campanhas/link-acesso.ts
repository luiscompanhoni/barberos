import type { CampanhaEnvio, Prisma } from "@prisma/client";

/** Links legados já saíram na primeira mensagem. Nos demais, a oferta libera o token. */
export const envioComLinkLiberado = {
  status: "ENVIADO",
  OR: [{ aberturaIniciadaEm: null }, { continuacaoReservadaEm: { not: null } }],
} satisfies Prisma.CampanhaEnvioWhereInput;

/** A ferramenta de presentes só oferece novamente um link cuja oferta saiu. */
export const envioComLinkConfirmado = {
  status: "ENVIADO",
  OR: [{ aberturaIniciadaEm: null, enviadoEm: { not: null } }, { ofertaEnviadaEm: { not: null } }],
} satisfies Prisma.CampanhaEnvioWhereInput;

export function inicioDaValidadeDoLink(envio: Pick<CampanhaEnvio, "ofertaEnviadaEm" | "continuacaoReservadaEm" | "enviadoEm" | "liberadoEm">) {
  return envio.ofertaEnviadaEm ?? envio.continuacaoReservadaEm ?? envio.enviadoEm ?? envio.liberadoEm;
}
