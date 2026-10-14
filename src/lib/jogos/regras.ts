/**
 * Regras puras do motor de jogos de recompensa (roleta, caixas, raspadinha): sorteio pela chance,
 * premios que podem sair, validacao das chances, codigo do premio, grade da raspadinha e jogadas devidas.
 * O servidor decide tudo; a tela so anima o que ja foi decidido e gravado.
 */
import type { CelulaRaspadinha } from "./tipos";

/** 100% em centesimos de % (a chance de cada premio e guardada assim: 1250 = 12,5%). */
export const TOTAL_BPS = 10_000;

export type PremioSorteio = { id: string; chanceBps: number; ativo: boolean; limiteMensal: number | null; estoque: number | null };

/** Premios que podem sair agora: ativos, com chance, com estoque e sem ter batido o limite do mes. */
export function elegiveis<T extends PremioSorteio>(premios: T[], saiuNoMes: Map<string, number>) {
  return premios.filter(
    (p) => p.ativo && p.chanceBps > 0 && (p.estoque === null || p.estoque > 0) && (p.limiteMensal === null || (saiuNoMes.get(p.id) ?? 0) < p.limiteMensal),
  );
}

/**
 * Escolhe pela chance. `r` e um inteiro sorteado em [0, soma das chances dos elegiveis).
 * Premio esgotado sai da conta antes: os outros dividem a chance dele na mesma proporcao.
 */
export function sortear<T extends { chanceBps: number }>(premios: T[], r: number): T {
  const total = premios.reduce((t, p) => t + p.chanceBps, 0);
  if (!premios.length || total <= 0) throw new Error("Nenhum prêmio disponível.");
  if (!Number.isInteger(r) || r < 0 || r >= total) throw new Error("Sorteio fora da faixa.");
  let acc = 0;
  for (const p of premios) {
    acc += p.chanceBps;
    if (r < acc) return p;
  }
  return premios[premios.length - 1];
}

export type TipoJogoRegra = "ROLETA" | "CAIXA" | "RASPADINHA";
export type PremioConfig = { rotulo: string; tipo: string; chanceBps: number; ativo: boolean; valorCentavos: number; percentual: number; servicoId: string | null };

/** Problemas que impedem publicar a configuracao (lista vazia = pode salvar). */
export function validarPremios(tipo: TipoJogoRegra, premios: PremioConfig[]): string[] {
  const erros: string[] = [];
  const ativos = premios.filter((p) => p.ativo);
  const soma = ativos.reduce((t, p) => t + p.chanceBps, 0);
  if (!ativos.length) erros.push("Deixe pelo menos um prêmio ativo.");
  if (soma !== TOTAL_BPS) erros.push(`A soma das chances dos prêmios ativos precisa dar 100% (está em ${pct(soma)}).`);
  for (const p of premios) {
    if (p.chanceBps < 0 || p.chanceBps > TOTAL_BPS) erros.push(`"${p.rotulo}": chance entre 0% e 100%.`);
    if (p.tipo === "CREDITO" && p.valorCentavos <= 0) erros.push(`"${p.rotulo}": prêmio em dinheiro precisa de valor.`);
    if (p.tipo === "DESCONTO" && (p.percentual < 1 || p.percentual > 100)) erros.push(`"${p.rotulo}": desconto entre 1% e 100%.`);
    if (p.tipo === "SERVICO" && !p.servicoId) erros.push(`"${p.rotulo}": escolha o serviço grátis.`);
  }
  if (tipo === "ROLETA") {
    if (ativos.length < 2) erros.push("A roleta precisa de pelo menos 2 fatias ativas.");
    if (ativos.length > 16) erros.push("No máximo 16 fatias ativas (senão o texto não cabe).");
  }
  if (tipo === "CAIXA" && ativos.some((p) => p.tipo === "NADA")) erros.push("Caixa sempre dá prêmio: tire o \"nada\" dela.");
  if (tipo === "RASPADINHA" && !ativos.some((p) => p.tipo !== "NADA")) erros.push("A raspadinha precisa de pelo menos um prêmio de verdade.");
  return erros;
}

/** "12,5%" a partir de centesimos de %. */
export const pct = (bps: number) => `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/** Raridade sugerida pela chance (quanto mais rara, mais brilho e som na revelacao). */
export function raridadePelaChance(chanceBps: number, tipo: string) {
  if (tipo === "NADA") return "COMUM" as const;
  if (chanceBps < 200) return "LENDARIO" as const;
  if (chanceBps < 600) return "EPICO" as const;
  if (chanceBps < 1500) return "RARO" as const;
  return "COMUM" as const;
}

/** Multiplicador x100 (assinante ganha o bonus nos premios em dinheiro). */
export const multiplicador = (assinante: boolean, bonusPct: number) => (assinante ? 100 + Math.max(0, bonusPct) : 100);
export const comBonus = (valorCentavos: number, mult: number) => Math.round((valorCentavos * mult) / 100);

/** Custo esperado de uma jogada (centavos): soma de chance x custo de cada premio. */
export function custoEsperado(premios: { chanceBps: number; ativo: boolean; tipo: string; valorCentavos: number; custoCentavos: number }[], premiosPorJogada = 1) {
  const porSorteio = premios
    .filter((p) => p.ativo)
    .reduce((t, p) => t + (p.chanceBps / TOTAL_BPS) * (p.tipo === "CREDITO" ? p.valorCentavos : p.tipo === "NADA" ? 0 : p.custoCentavos), 0);
  return Math.round(porSorteio * premiosPorJogada);
}

/**
 * Simulacao antes de publicar: sorteia `n` jogadas com a mesma regra do servidor e conta quantas vezes cada premio sai.
 * `aleatorio(max)` devolve um inteiro em [0, max).
 */
export function simular<T extends PremioSorteio>(premios: T[], n: number, premiosPorJogada: number, aleatorio: (max: number) => number) {
  const conta = new Map<string, number>(premios.map((p) => [p.id, 0]));
  const estoque = new Map(premios.map((p) => [p.id, p.estoque]));
  const noMes = new Map<string, number>();
  let semPremio = 0;
  for (let i = 0; i < n * premiosPorJogada; i++) {
    const pool = elegiveis(premios.map((p) => ({ ...p, estoque: estoque.get(p.id) ?? null })), noMes);
    const total = pool.reduce((t, p) => t + p.chanceBps, 0);
    if (!pool.length || total <= 0) { semPremio++; continue; }
    const p = sortear(pool, aleatorio(total));
    conta.set(p.id, (conta.get(p.id) ?? 0) + 1);
    noMes.set(p.id, (noMes.get(p.id) ?? 0) + 1);
    const e = estoque.get(p.id);
    if (e !== null && e !== undefined) estoque.set(p.id, e - 1);
  }
  return { conta, semPremio };
}

// ---------------- codigo do premio

/** Sem 0/O, 1/I/L: facil de ditar e conferir no balcao. */
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** "BB-7K2Q9M" a partir de 6 bytes aleatorios. */
export function codigoDoPremio(bytes: Uint8Array) {
  if (bytes.length < 6) throw new Error("Bytes insuficientes para o código.");
  return `BB-${Array.from(bytes.slice(0, 6), (b) => ALFABETO[b % ALFABETO.length]).join("")}`;
}

/** Normaliza o que a recepcao digitou ("bb 7k2q9m" -> "BB-7K2Q9M"). */
export function normalizarCodigo(texto: string) {
  const t = texto.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const corpo = t.startsWith("BB") ? t.slice(2) : t;
  return corpo.length === 6 ? `BB-${corpo}` : null;
}

// ---------------- raspadinha

export type Simbolo = { simbolo: string; rotulo: string; icone: string };

/** Simbolos de enfeite (nunca formam premio): completam a cartela quando ha poucos premios. */
export const ENFEITES: Simbolo[] = [
  { simbolo: "enfeite:tesoura", rotulo: "Tesoura", icone: "tesoura" },
  { simbolo: "enfeite:navalha", rotulo: "Navalha", icone: "navalha" },
  { simbolo: "enfeite:pente", rotulo: "Pente", icone: "pente" },
  { simbolo: "enfeite:poste", rotulo: "Poste", icone: "poste" },
  { simbolo: "enfeite:bigode", rotulo: "Bigode", icone: "bigode" },
];

/**
 * Cartela 3x3 montada no servidor. Vitoria: exatamente um trio (o do premio); derrota: nenhum simbolo 3 vezes.
 * `aleatorio(max)` devolve um inteiro em [0, max).
 */
export function montarGrade(vencedor: Simbolo | null, outros: Simbolo[], aleatorio: (max: number) => number): { grade: CelulaRaspadinha[]; vencedoras: number[] } {
  const pool = outros.filter((o, i) => o.simbolo !== vencedor?.simbolo && outros.findIndex((x) => x.simbolo === o.simbolo) === i);
  // Sem trio: cada simbolo no maximo 2x. Vitoria precisa de 3 outros (6 casas); derrota, de 5 (9 casas).
  const precisa = vencedor ? 3 : 5;
  for (const e of ENFEITES) if (pool.length < precisa && !pool.some((p) => p.simbolo === e.simbolo)) pool.push(e);
  embaralhar(pool, aleatorio);
  const casas: Simbolo[] = vencedor ? [vencedor, vencedor, vencedor] : [];
  for (let i = 0; casas.length < 9; i++) {
    const s = pool[i % pool.length];
    if (casas.filter((c) => c.simbolo === s.simbolo).length < 2) casas.push(s);
  }
  const ordem = casas.map((_, i) => i);
  embaralhar(ordem, aleatorio);
  const grade = ordem.map((i) => ({ simbolo: casas[i].simbolo, rotulo: casas[i].rotulo, icone: casas[i].icone }));
  const vencedoras = vencedor ? grade.flatMap((c, i) => (c.simbolo === vencedor.simbolo ? [i] : [])) : [];
  return { grade, vencedoras };
}

/** Trio na cartela (para conferir a grade): o simbolo que aparece 3+ vezes, ou null. */
export function trioDaGrade(grade: { simbolo: string }[]) {
  const n = new Map<string, number>();
  for (const c of grade) n.set(c.simbolo, (n.get(c.simbolo) ?? 0) + 1);
  return [...n.entries()].find(([, q]) => q >= 3)?.[0] ?? null;
}

function embaralhar<T>(xs: T[], aleatorio: (max: number) => number) {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = aleatorio(i + 1);
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
}

// ---------------- jogadas devidas

export type RegrasLiberacao = {
  jogadasPorAtendimento: number;
  valorMinimoAtendimentoCentavos: number;
  jogadasPorIndicacao: number;
  jogadasAniversario: number;
  jogadasRenovacaoPlano: number;
};

/**
 * Referencias das fichas que o cliente ja deveria ter (cada uma vira no maximo uma ficha: o banco nao repete).
 * - atendimento concluido (a partir do valor minimo): "agendamentoId:k";
 * - indicacao convertida: "indicacaoId:k"; mensalidade paga: "cobrancaId:k";
 * - aniversario: "ANO:k" do dia do aniversario ate 30 dias depois.
 */
export function fichasDevidas(r: RegrasLiberacao, d: {
  atendimentos: { id: string; valorCentavos: number }[];
  indicacoes: string[];
  mensalidades: string[];
  /** "AAAA-MM-DD" (data local) */
  nascimento: string | null;
  hoje: string;
  /** "AAAA-MM-DD": aniversario antes disso nao conta (jogo ligado depois). */
  desde: string;
}) {
  const out: { origem: "ATENDIMENTO" | "INDICACAO" | "ASSINATURA" | "ANIVERSARIO"; referencia: string }[] = [];
  const vezes = (n: number, base: string, origem: (typeof out)[number]["origem"]) => {
    for (let k = 1; k <= n; k++) out.push({ origem, referencia: `${base}:${k}` });
  };
  for (const a of d.atendimentos) if (a.valorCentavos >= r.valorMinimoAtendimentoCentavos) vezes(r.jogadasPorAtendimento, a.id, "ATENDIMENTO");
  for (const i of d.indicacoes) vezes(r.jogadasPorIndicacao, i, "INDICACAO");
  for (const c of d.mensalidades) vezes(r.jogadasRenovacaoPlano, c, "ASSINATURA");
  if (r.jogadasAniversario > 0 && d.nascimento) {
    const ano = d.hoje.slice(0, 4);
    let dia = `${ano}${d.nascimento.slice(4)}`;
    if (dia.endsWith("02-29") && !bissexto(Number(ano))) dia = `${ano}-02-28`;
    if (d.hoje >= dia && d.hoje < somarDias(dia, 30) && dia >= d.desde) vezes(r.jogadasAniversario, ano, "ANIVERSARIO");
  }
  return out;
}

const bissexto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
function somarDias(dia: string, n: number) {
  const t = new Date(`${dia}T12:00:00Z`).getTime() + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Jogada gratis do periodo: devida se nunca teve ou se a ultima foi ha N dias ou mais. */
export function gratisDevida(cadaDias: number, ultima: Date | null, agora: number) {
  if (cadaDias <= 0) return { devida: false, proximaEm: null as Date | null };
  const proxima = ultima ? ultima.getTime() + cadaDias * 86_400_000 : 0;
  return proxima <= agora ? { devida: true, proximaEm: null } : { devida: false, proximaEm: new Date(proxima) };
}

// ---------------- resultado (custo x faturamento)

/**
 * Visitas com resgate de premio: comandas fechadas em que o cliente usou credito do jogo, em que um premio foi
 * validado, ou do mesmo dia (data local "AAAA-MM-DD") em que ele retirou um brinde sem comanda.
 */
export function comandasComResgate<C extends { id: string; clienteId: string | null; dia: string }>(
  comandas: C[], comResgate: Set<string>, brindes: { clienteId: string; dia: string }[],
) {
  const retirou = new Set(brindes.map((b) => `${b.clienteId}|${b.dia}`));
  return comandas.filter((c) => comResgate.has(c.id) || (!!c.clienteId && retirou.has(`${c.clienteId}|${c.dia}`)));
}

/** Quanto entrou por real de custo (2 casas; null sem custo). */
export const retornoPorReal = (faturamentoCentavos: number, custoCentavos: number) =>
  custoCentavos > 0 ? Math.round((faturamentoCentavos / custoCentavos) * 100) / 100 : null;

/** Desconto de um premio na comanda (centavos), limitado ao que ainda da para descontar. */
export function descontoDoPremio(p: { tipo: string; percentual: number; valorCentavos: number }, d: { podeDescontar: number; precoServico: number | null }) {
  if (d.podeDescontar <= 0) return 0;
  if (p.tipo === "DESCONTO") return Math.min(d.podeDescontar, Math.round((d.podeDescontar * p.percentual) / 100));
  if (p.tipo === "SERVICO") {
    if (d.precoServico === null) return 0;
    const teto = p.valorCentavos > 0 ? Math.min(p.valorCentavos, d.precoServico) : d.precoServico;
    return Math.min(d.podeDescontar, teto);
  }
  return 0;
}
