/**
 * Extrato da Celcash no BarberOS: busca os movimentos do saldo (so leitura), classifica e guarda cada um uma vez.
 * A rotina diaria traz os ultimos dias; o painel pode trazer o historico inteiro. Classificacao mudada a mao fica.
 */
import type { Prisma } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { db } from "@/lib/db";
import { classificarCelcash, contraparte, paraCentavos, type MovimentoCelcash } from "./regras";
import { regraPara } from "./stone-regras";
import { regrasAtuais } from "./stone";

const DIA = 86_400_000;
/** Primeiro mes com movimento na conta (antes disso a Celcash devolve vazio). */
export const INICIO_HISTORICO = "2025-01-01";

function config() {
  const id = process.env.CELCASH_GALAX_ID;
  const hash = process.env.CELCASH_GALAX_HASH;
  if (!id || !hash) return null;
  const base = process.env.CELCASH_AMBIENTE === "producao" ? "https://api-celcash.celcoin.com.br/v2" : "https://api.sandbox.cel.cash/v2";
  return { base, basic: Buffer.from(`${id}:${hash}`).toString("base64") };
}

/** Token so de leitura do saldo (separado do token das cobrancas). */
let cache: { valor: string; ate: number } | null = null;
async function token() {
  const c = config();
  if (!c) throw new Error("Celcash não configurada (CELCASH_GALAX_ID/HASH).");
  if (cache && cache.ate > Date.now()) return { ...c, token: cache.valor };
  const r = await fetch(`${c.base}/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${c.basic}`, "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", scope: "balance.read" }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!r.ok || !j.access_token) throw new Error(`Celcash (token): ${j.error?.message ?? `HTTP ${r.status}`}`);
  cache = { valor: j.access_token, ate: Date.now() + Math.max(60, (j.expires_in ?? 600) - 60) * 1000 };
  return { ...c, token: cache.valor };
}

/** Movimentos entre duas datas "AAAA-MM-DD" (inclusivas) e o saldo inicial/final do periodo. */
export async function extratoCelcash(de: string, ate: string) {
  const { base, token: t } = await token();
  const r = await fetch(`${base}/company/balance/movements?initialDate=${de}&finalDate=${ate}`, {
    headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(30_000),
  });
  const j = (await r.json().catch(() => ({}))) as { Balances?: MovimentoCelcash[]; Totals?: { initial: number; final: number }; error?: { message?: string } };
  if (!r.ok) throw new Error(`Celcash (extrato): ${j.error?.message ?? `HTTP ${r.status}`}`);
  return { movimentos: j.Balances ?? [], saldoInicial: j.Totals?.initial ?? null, saldoFinal: j.Totals?.final ?? null };
}

/** Saldo disponivel agora na Celcash (centavos). */
export async function saldoCelcash() {
  const { base, token: t } = await token();
  const r = await fetch(`${base}/company/balance`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(20_000) });
  const j = (await r.json().catch(() => ({}))) as { Balance?: { enabled: number; requested: number; toBlock: number } };
  return j.Balance ? { disponivel: paraCentavos(j.Balance.enabled), aLiberar: paraCentavos(j.Balance.toBlock ?? 0) } : null;
}

/** Guarda os movimentos de um periodo (os que ja existem ficam como estao). Devolve quantos entraram. */
export async function sincronizarPeriodo(de: string, ate: string, contasProprias?: string[]) {
  const contas = contasProprias ?? (await configuracao()).contasProprias;
  const [{ movimentos }, regras] = await Promise.all([extratoCelcash(de, ate), regrasAtuais()]);
  if (!movimentos.length) return 0;
  const dados: Prisma.MovimentoExternoCreateManyInput[] = movimentos.map((m) => {
    const c = classificarCelcash(m, contas);
    const r = c.tipo === "PAGAMENTO" ? regraPara(contraparte(m.friendlyDescription), regras) : null;
    return {
      // "2026-10-13 06:06:57", no horario de Brasilia.
      fonte: "CELCASH", idExterno: String(m.galaxPayId), data: new Date(`${m.createdAt.replace(" ", "T")}-03:00`),
      valorCentavos: paraCentavos(m.value), tipo: r?.tipo ?? c.tipo, forma: c.forma, categoria: r?.categoria ?? null, descricao: m.friendlyDescription.slice(0, 200),
      transacaoId: m.transactionGalaxPayId ? String(m.transactionGalaxPayId) : null,
      observacao: c.tipo === "PAGAMENTO" || c.tipo === "TRANSFERENCIA" ? contraparte(m.friendlyDescription) : null,
      bruto: m as unknown as Prisma.InputJsonValue,
    };
  });
  const r = await db.movimentoExterno.createMany({ data: dados, skipDuplicates: true });
  return r.count;
}

/** Meses "AAAA-MM" de `de` ate `ate` (inclusivos). */
export function mesesEntre(de: string, ate: string) {
  const out: string[] = [];
  let [a, m] = de.slice(0, 7).split("-").map(Number);
  const [af, mf] = ate.slice(0, 7).split("-").map(Number);
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; a++; }
  }
  return out;
}

const ultimoDia = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

/** Historico inteiro, mes a mes (ja guardado nao duplica). */
export async function sincronizarHistorico(ate = new Date().toISOString().slice(0, 10)) {
  const contas = (await configuracao()).contasProprias;
  let total = 0;
  for (const mes of mesesEntre(INICIO_HISTORICO, ate)) total += await sincronizarPeriodo(`${mes}-01`, mes === ate.slice(0, 7) ? ate : ultimoDia(mes), contas);
  return total;
}

let ultimaRotina = 0;

/** Rotina: os ultimos 5 dias (cobre fim de semana e atraso da Celcash), no maximo uma vez por hora. */
export async function sincronizarRecentes(agora = Date.now(), forcar = false) {
  if (!config()) return 0;
  if (!forcar && agora - ultimaRotina < 3_600_000) return 0;
  ultimaRotina = agora;
  const de = new Date(agora - 5 * DIA).toISOString().slice(0, 10);
  const ate = new Date(agora).toISOString().slice(0, 10);
  return sincronizarPeriodo(de, ate);
}

/** Contas proprias mudaram: reclassifica os Pix ainda nao mexidos a mao. */
export async function reclassificarPix() {
  const contas = (await configuracao()).contasProprias;
  const ms = await db.movimentoExterno.findMany({ where: { fonte: "CELCASH", classificadoPorId: null, tipo: { in: ["PAGAMENTO", "TRANSFERENCIA"] } } });
  let n = 0;
  for (const m of ms) {
    const c = classificarCelcash(m.bruto as unknown as MovimentoCelcash, contas);
    if (c.tipo !== m.tipo) { await db.movimentoExterno.update({ where: { id: m.id }, data: { tipo: c.tipo } }); n++; }
  }
  return n;
}
