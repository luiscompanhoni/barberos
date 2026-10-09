/**
 * Regras do cancelamento com retencao (funcoes puras, sem banco).
 * Datas sempre "AAAA-MM-DD" (dia local da barbearia).
 */
import { somarMes } from "./regras";

export const MOTIVOS = ["PRECO", "NAO_USA", "VIAGEM", "MUDANCA", "HORARIOS", "INSATISFEITO", "OUTRO"] as const;
export type Motivo = (typeof MOTIVOS)[number];

export const ROTULO_MOTIVO: Record<Motivo, string> = {
  PRECO: "Ficou caro",
  NAO_USA: "Não estou usando o suficiente",
  VIAGEM: "Vou viajar",
  MUDANCA: "Mudei de cidade ou de bairro",
  HORARIOS: "Horários não batem com os meus",
  INSATISFEITO: "Insatisfeito com o atendimento",
  OUTRO: "Outro motivo",
};

/** Texto livre (painel, motivos antigos) -> codigo. */
export function motivoPorTexto(texto: string): Motivo {
  const base = texto.split(":")[0].trim().toLowerCase();
  const achado = MOTIVOS.find((m) => ROTULO_MOTIVO[m].toLowerCase() === base);
  return achado ?? "OUTRO";
}

export type ConfigRetencao = {
  descontoAtivo: boolean;
  descontoPct: number;
  descontoMeses: number;
  pausaAtiva: boolean;
  pausaMaxDias: number;
};

export const CONFIG_PADRAO: ConfigRetencao = { descontoAtivo: true, descontoPct: 20, descontoMeses: 2, pausaAtiva: true, pausaMaxDias: 60 };

/** O que o meio de pagamento da assinatura consegue fazer sozinho. */
export type Capacidades = { pausa: boolean; desconto: boolean };

/** Ja usou a oferta ha pouco (evita pausar ou ganhar desconto em sequencia). */
export type Historico = { descontoRecente: boolean; pausaRecente: boolean };
export const DIAS_ENTRE_DESCONTOS = 365;
export const DIAS_ENTRE_PAUSAS = 180;

export type Oferta =
  | { tipo: "DESCONTO"; pct: number; meses: number }
  | { tipo: "PAUSA"; opcoesDias: number[] }
  | { tipo: "GERENTE" }
  | { tipo: "NENHUMA" };

/** Opcoes de pausa: 30/60/90 dias ate o maximo do dono (se o maximo for menor que 30, so ele). */
export function opcoesDePausa(maxDias: number) {
  const max = Math.max(0, Math.floor(maxDias));
  if (max <= 0) return [];
  const lista = [30, 60, 90].filter((d) => d <= max);
  return lista.length ? lista : [max];
}

/**
 * Oferta para o motivo. Desconto e pausa so para plano ATIVO (pago e em dia).
 * Dono desligou a oferta -> sem oferta. Meio de pagamento nao consegue aplicar sozinho
 * -> fala com o gerente (a equipe resolve na mao).
 */
export function ofertaPara(p: {
  motivo: Motivo;
  status: string;
  pausada: boolean;
  encerrando: boolean;
  cfg: ConfigRetencao;
  cap: Capacidades;
  historico: Historico;
}): Oferta {
  const { motivo, cfg, cap, historico } = p;
  if (p.status === "PENDENTE" || p.encerrando) return { tipo: "NENHUMA" };
  if (motivo === "INSATISFEITO" || motivo === "HORARIOS") return { tipo: "GERENTE" };
  const ativa = p.status === "ATIVA" && !p.pausada;
  if (motivo === "PRECO") {
    if (!ativa || !cfg.descontoAtivo || cfg.descontoPct <= 0 || cfg.descontoMeses <= 0 || historico.descontoRecente) return { tipo: "NENHUMA" };
    if (!cap.desconto) return { tipo: "GERENTE" };
    return { tipo: "DESCONTO", pct: Math.min(100, cfg.descontoPct), meses: cfg.descontoMeses };
  }
  if (motivo === "NAO_USA" || motivo === "VIAGEM") {
    const opcoesDias = opcoesDePausa(cfg.pausaMaxDias);
    if (!ativa || !cfg.pausaAtiva || !opcoesDias.length || historico.pausaRecente) return { tipo: "NENHUMA" };
    if (!cap.pausa) return { tipo: "GERENTE" };
    return { tipo: "PAUSA", opcoesDias };
  }
  return { tipo: "NENHUMA" }; // mudou de cidade, outro motivo: cancela direto
}

/** Dia seguinte ao ultimo dia valido a partir de "hoje" num ciclo mensal que comecou em `inicio`. */
export function proximoAniversario(inicio: string, hoje: string) {
  const dia = Number(inicio.slice(8, 10));
  let d = inicio;
  for (let i = 0; i < 1200 && d <= hoje; i++) d = somarMes(d, dia);
  return d;
}

/**
 * Ate quando o plano vale depois do pedido de cancelamento. Retorna a data em que o
 * acesso acaba (o ultimo dia valido e o anterior) ou null = cancela na hora.
 * - so plano ATIVO tem mes pago correndo; PENDENTE (nunca pagou) e ATRASADA (mes vencido sem pagar) cancelam na hora;
 * - o ciclo pago vai ate o proximo vencimento (definido quando a mensalidade e paga);
 * - CashBarber nao tem vencimento no BarberOS: estima pelo dia da adesao.
 */
export function fimDoAcesso(p: { status: string; proximoVencimento: string | null; criadaEm: string; cashbarber: boolean; hoje: string }) {
  if (p.status !== "ATIVA") return null;
  if (p.proximoVencimento) return p.proximoVencimento > p.hoje ? p.proximoVencimento : null;
  if (p.cashbarber) return proximoAniversario(p.criadaEm, p.hoje);
  return null;
}

/** Plano pausado agora? (pausadaEm vira null quando a rotina reativa.) */
export function estaPausada(p: { pausadaEm: Date | null; pausadaAte: string | null; hoje: string }) {
  return !!p.pausadaEm && !!p.pausadaAte && p.pausadaAte > p.hoje;
}

/** Ultimo vencimento com desconto: o proximo + (meses - 1). */
export function ultimoVencimentoComDesconto(proximoVencimento: string, meses: number) {
  const dia = Number(proximoVencimento.slice(8, 10));
  let d = proximoVencimento;
  for (let i = 1; i < meses; i++) d = somarMes(d, dia);
  return d;
}

/** Valor da mensalidade com o desconto de retencao, se o vencimento estiver coberto. */
export function valorComRetencao(p: { precoCentavos: number; vencimento: string; pct: number | null; ate: string | null }) {
  if (!p.pct || !p.ate || p.vencimento > p.ate) return p.precoCentavos;
  return Math.round((p.precoCentavos * (100 - Math.min(100, Math.max(0, p.pct)))) / 100);
}

/** Ultimo dia de uso (a data de fim e exclusiva). */
export function ultimoDia(fim: string) {
  const d = new Date(`${fim}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export type LinhaRetencao = { motivo: Motivo; desfecho: "CANCELOU" | "DESCONTO" | "PAUSA" | "GERENTE" };

/** Indicador do mes: por motivo, quantos cancelaram e quantos ficaram (desconto, pausa, gerente). */
export function resumoPorMotivo(linhas: LinhaRetencao[]) {
  const vazio = () => ({ CANCELOU: 0, DESCONTO: 0, PAUSA: 0, GERENTE: 0 });
  const porMotivo = new Map<Motivo, ReturnType<typeof vazio>>();
  const total = vazio();
  for (const l of linhas) {
    const g = porMotivo.get(l.motivo) ?? vazio();
    g[l.desfecho]++;
    total[l.desfecho]++;
    porMotivo.set(l.motivo, g);
  }
  const retidos = total.DESCONTO + total.PAUSA;
  const decididos = retidos + total.CANCELOU;
  return {
    total,
    taxaRetencaoPct: decididos ? Math.round((retidos / decididos) * 100) : null,
    motivos: MOTIVOS.filter((m) => porMotivo.has(m)).map((m) => ({ motivo: m, rotulo: ROTULO_MOTIVO[m], ...porMotivo.get(m)! })),
  };
}
