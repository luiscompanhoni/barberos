/** Uma nota nunca altera o direito à recompensa. Publicação só em lotes completos. */
export const MINIMO_AVALIACOES = 5;
export const CATEGORIAS = ["corte", "atendimento", "ambiente", "pontualidade"] as const;
export type Categoria = (typeof CATEGORIAS)[number];
export type NotaCliente = { nota: number } & Partial<Record<Categoria, number | null>>;
export type SomaCategoria = { quantidade: number; soma: number };
export type TotaisCategorias = Partial<Record<Categoria, SomaCategoria>>;

export function quantidadePublicavel(quantidade: number) {
  return Math.floor(Math.max(0, quantidade) / MINIMO_AVALIACOES) * MINIMO_AVALIACOES;
}

export function resumirNotas(notas: NotaCliente[]) {
  const categorias: TotaisCategorias = {};
  for (const chave of CATEGORIAS) {
    const valores = notas.map(n => n[chave]).filter((n): n is number => typeof n === "number");
    // Perguntas opcionais têm também sua própria base mínima de cinco.
    const publicaveis = valores.slice(0, quantidadePublicavel(valores.length));
    categorias[chave] = { quantidade: publicaveis.length, soma: publicaveis.reduce((s, n) => s + n, 0) };
  }
  return { quantidade: notas.length, soma: notas.reduce((s, n) => s + n.nota, 0), categorias };
}

export function notaPublica(quantidade: number, soma: number) {
  const mediaBruta = quantidade >= MINIMO_AVALIACOES ? soma / quantidade : null;
  const media = mediaBruta === null ? null : Math.round(mediaBruta * 100) / 100;
  const faixa = mediaBruta === null ? "formacao" : mediaBruta >= 4.5 ? "excelente" : mediaBruta >= 4 ? "atencao" : "melhorar";
  return { quantidade: media === null ? 0 : quantidade, media, faixa, emFormacao: media === null };
}

/** Única falha do canal atual que prova que nenhum pedido saiu ao provedor. */
export function falhaSemEnvioConfirmado(erro: string | null) {
  return erro === "Fora da janela de 24h e WHATSAPP_TEMPLATE_AVISO não configurado: aviso não enviado.";
}

export function primeiraVisitaElegivel(p: {
  ativo: boolean; ativaDesde: Date | null; primeiraFim: Date | null; agora: Date;
}) {
  return p.ativo && !!p.ativaDesde && !!p.primeiraFim && p.primeiraFim >= p.ativaDesde
    && p.primeiraFim <= p.agora;
}

export function competenciaResposta(data: Date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(data);
}
