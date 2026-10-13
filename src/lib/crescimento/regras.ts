/**
 * Regras puras de crescimento: ritmo de retorno, lista de espera e indicacao (testadas).
 */
const DIA = 86_400_000;

/** Ritmo do cliente: intervalo medio entre as ultimas visitas (7 a 60 dias). null com menos de 2 visitas. */
export function ritmoDoCliente(visitas: number[]) {
  if (visitas.length < 2) return null;
  const o = [...visitas].sort((a, b) => a - b).slice(-6); // ritmo recente pesa mais
  const media = (o.at(-1)! - o[0]) / (o.length - 1) / DIA;
  return Math.round(Math.min(60, Math.max(7, media)));
}

/**
 * Hora de lembrar do retorno: a partir de 1 dia antes do ritmo e ate 1,5x o ritmo
 * (depois disso quem cuida e a mensagem de "cliente sumido").
 */
export function retornoDevido(ultima: number, ritmoDias: number, agora: number) {
  const passados = (agora - ultima) / DIA;
  return passados >= ritmoDias - 1 && passados <= ritmoDias * 1.5;
}

export type Periodo = "QUALQUER" | "MANHA" | "TARDE" | "NOITE";
/** Minutos do dia (hora local) dentro do periodo pedido. */
export function noPeriodo(minutos: number, periodo: Periodo) {
  if (periodo === "MANHA") return minutos < 12 * 60;
  if (periodo === "TARDE") return minutos >= 12 * 60 && minutos < 18 * 60;
  if (periodo === "NOITE") return minutos >= 18 * 60;
  return true;
}

export type OpcaoHorario = { barbeiroId: string; nome: string; inicio: string; minutos: number };
/**
 * Ate `max` horarios espalhados no dia (nao 3 seguidos), preferindo o barbeiro de costume.
 */
export function escolherSugestoes(opcoes: OpcaoHorario[], max = 3, preferido?: string | null) {
  const pref = preferido ? opcoes.filter((o) => o.barbeiroId === preferido) : [];
  const base = (pref.length ? pref : opcoes).slice().sort((a, b) => a.minutos - b.minutos);
  if (base.length <= max) return base;
  const out: OpcaoHorario[] = [];
  for (let i = 0; i < max; i++) out.push(base[Math.round((i * (base.length - 1)) / (max - 1))]);
  return out.filter((o, i, arr) => arr.findIndex((x) => x.inicio === o.inicio && x.barbeiroId === o.barbeiroId) === i);
}

const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O e 1/I para nao confundir
/** Codigo curto e legivel: ate 5 letras do nome + 3 aleatorias (ex.: RAFAE7K2 -> "RAFA7K2"). */
export function gerarCodigoIndicacao(nome: string, aleatorio: () => number = Math.random) {
  const prefixo = nome.normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 5) || "AMIGO";
  let sufixo = "";
  for (let i = 0; i < 3; i++) sufixo += LETRAS[Math.floor(aleatorio() * LETRAS.length)];
  return `${prefixo}${sufixo}`;
}

/** Codigo digitado/colado pelo cliente -> formato do banco (ou null). */
export function normalizarCodigo(texto: string) {
  const c = texto.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length >= 4 && c.length <= 12 ? c : null;
}

const primeiro = (nome: string) => nome.trim().split(/\s+/)[0] || "tudo bem";
const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;

export const TEXTOS = {
  ESPERA: (p: { nome: string; servico: string; dia: string; opcoes: string[] }) =>
    `Oi, ${primeiro(p.nome)}! Abriu horário para ${p.servico} ${p.dia}: ${p.opcoes.join(", ")}. ` +
    `Quer? É só responder com o horário que eu marco (vale para quem responder primeiro).`,
  RETORNO: (p: { nome: string; dias: number; servico: string; opcoes: string[]; peloPlano: boolean }) =>
    `Oi, ${primeiro(p.nome)}! Já faz ${p.dias} dias do seu último ${p.servico.toLowerCase()}, tá chegando a hora do trato. ✂️ ` +
    (p.opcoes.length ? `Separei: ${p.opcoes.join(" ou ")}${p.peloPlano ? " (pelo plano)" : ""}. Quer que eu marque? ` : "Quer que eu veja um horário? ") +
    `(Se não quiser esse lembrete, responda PARAR.)`,
  INDICACAO_CONVERTIDA: (p: { nome: string; amigo: string; premio: number }) =>
    `Oi, ${primeiro(p.nome)}! O ${primeiro(p.amigo)} veio pela sua indicação. 🙌 Você ganhou ${reais(p.premio)} de desconto, ` +
    `já está guardado no seu cadastro e sai na próxima visita. Valeu por indicar!`,
  CONVITE: (p: { nome: string; barbearia: string; link: string; codigo: string; premioIndicado: number }) =>
    `Bora cortar na ${p.barbearia}? Usa meu link${p.premioIndicado ? ` e ganha ${reais(p.premioIndicado)} de desconto no primeiro corte` : ""}: ${p.link} ` +
    `(ou fala no WhatsApp da barbearia o código ${p.codigo}). — ${primeiro(p.nome)}`,
};
