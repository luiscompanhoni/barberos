import type { Prisma } from "@prisma/client";

/** Links legados já saíram na primeira mensagem. Nos demais, a oferta libera o token. */
export const envioComLinkLiberado = {
  status: "ENVIADO",
  OR: [{ aberturaIniciadaEm: null }, { continuacaoReservadaEm: { not: null } }],
} satisfies Prisma.CampanhaEnvioWhereInput;
