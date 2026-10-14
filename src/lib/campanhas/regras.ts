/**
 * Campanhas: segmentos da base, vagas livres da agenda e tamanho do lote (regras puras, testadas em
 * tests/campanhas.test.ts).
 */
import { diasDesde } from "@/lib/clientes/segmentos";

export const SEGMENTOS = [
  { chave: "ate30", rotulo: "Veio nos últimos 30 dias" },
  { chave: "d31a60", rotulo: "31 a 60 dias" },
  { chave: "d61a90", rotulo: "61 a 90 dias" },
  { chave: "d91a180", rotulo: "91 a 180 dias" },
  { chave: "mais180", rotulo: "Mais de 180 dias" },
  { chave: "assinante", rotulo: "Assinantes" },
  { chave: "exAssinante", rotulo: "Ex-assinantes" },
  { chave: "perdido", rotulo: "Perdidos (mais de 90 dias)" },
  { chave: "novo", rotulo: "Novos (1ª visita nos últimos 30 dias)" },
  { chave: "nunca", rotulo: "Cadastrados que nunca vieram" },
] as const;
export type Segmento = (typeof SEGMENTOS)[number]["chave"];
export const CHAVES_SEGMENTO = SEGMENTOS.map((s) => s.chave) as Segmento[];

/** Mesmo corte dos indicadores (lib/indicadores/calculos.ts): mais de 90 dias sem vir = perdido. */
const PERDIDO_DIAS = 90;
const NOVO_DIAS = 30;

export type DadosCliente = {
  /** Ultima e primeira visita concluida (ms) ou null. */
  ultima: number | null;
  primeira: number | null;
  /** Assinatura: "ativa" (ativa, atrasada ou esperando o 1o pagamento), "ex" (so canceladas) ou null (nunca teve). */
  assinatura: "ativa" | "ex" | null;
};

/** Em quais segmentos o cliente esta (um cliente pode estar em varios: ex. assinante e 0–30 dias). */
export function segmentosDoCliente(c: DadosCliente, agora: number): Segmento[] {
  const out: Segmento[] = [];
  const dias = diasDesde(c.ultima, agora);
  if (dias === null) out.push("nunca");
  else if (dias <= 30) out.push("ate30");
  else if (dias <= 60) out.push("d31a60");
  else if (dias <= 90) out.push("d61a90");
  else if (dias <= 180) out.push("d91a180");
  else out.push("mais180");
  if (dias !== null && dias > PERDIDO_DIAS) out.push("perdido");
  const desdePrimeira = diasDesde(c.primeira, agora);
  if (desdePrimeira !== null && desdePrimeira <= NOVO_DIAS) out.push("novo");
  if (c.assinatura === "ativa") out.push("assinante");
  if (c.assinatura === "ex") out.push("exAssinante");
  return out;
}

/** Quantos atendimentos de `duracaoMin` (+ intervalo entre clientes) cabem em cada janela livre. */
export function vagasNasJanelas(janelas: { inicio: number; fim: number }[], duracaoMin: number, intervaloMin = 0) {
  const passo = (duracaoMin + intervaloMin) * 60_000;
  const dur = duracaoMin * 60_000;
  if (dur <= 0) return 0;
  // O ultimo atendimento da janela nao precisa do intervalo depois dele.
  return janelas.reduce((t, j) => t + (j.fim - j.inicio >= dur ? Math.floor((j.fim - j.inicio - dur) / passo) + 1 : 0), 0);
}

/**
 * Tamanho sugerido do proximo lote: quem cabe na agenda (vagas / taxa de quem costuma marcar),
 * sem passar do limite do dia nem de quem ainda falta avisar.
 */
export function loteSugerido(p: { vagas: number; taxaRespostaBps: number; limiteDiario: number; elegiveis: number; naFila: number }) {
  const taxa = Math.max(1, p.taxaRespostaBps) / 10_000;
  const pelaAgenda = Math.floor(p.vagas / taxa) - p.naFila;
  return Math.max(0, Math.min(pelaAgenda, p.limiteDiario, p.elegiveis));
}

/** Texto final: troca {nome} (primeiro nome), {barbearia} e {link}; sempre termina com como parar de receber. */
export function montarMensagem(modelo: string, v: { nome: string; barbearia: string; link: string }) {
  const primeiro = v.nome.trim().split(/\s+/)[0] || "tudo bem";
  const texto = modelo.replaceAll("{nome}", primeiro).replaceAll("{barbearia}", v.barbearia).replaceAll("{link}", v.link).trim();
  return /\bPARAR\b/.test(texto) ? texto : `${texto}\n\nPara não receber mais, responda PARAR.`;
}

export const MENSAGEM_PADRAO =
  "Oi, {nome}! Aqui é da {barbearia}. Abrimos horários nos próximos dias e lembramos de você. Quer garantir o seu? Marque por aqui: {link}";
