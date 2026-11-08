/** Inteiros exatos no rateio; nenhum BigInt atravessa o DTO ou a memória JSON da folha. */
export const ARREDONDAMENTOS_POTE = ["LEGADO", "MAIORES_RESTOS_V1"] as const;
export type ArredondamentoPote = typeof ARREDONDAMENTOS_POTE[number];
export type LinhaAssinaturas = {
  barbeiroId: string; qtd: number; creditos: number; receitaAtribuida: number; percentualBaseBps: number;
  adicionalBps: number; comissaoBase: number; adicionalCentavos: number; comissao: number;
};
export type EntradaRateio = { barbeiroId: string; creditos: number; pontosAdicionais: number };
export type ConciliacaoAssinaturas = {
  metodo: ArredondamentoPote; status: "OK" | "REVISAO" | "SEM_ELEGIVEIS"; pendente: boolean; motivos: string[];
  criterioDesempate: string; ordemDesempate: string[];
  poteBaseAlvoCentavos: number; poteBaseSomaCentavos: number; poteBaseResiduoCentavos: number;
  totalFinalAlvoCentavos: number; totalFinalSomaCentavos: number; totalFinalDiferencaCentavos: number;
  naoRateadoCentavos: number;
  detalhes: {
    barbeiroId: string; creditos: number; baseQuotaNumerador: string; baseQuotaDenominador: string;
    baseRestoNumerador: string; baseCentavoResidual: boolean; finalQuotaNumerador: string;
    finalQuotaDenominador: string; finalPisoCentavos: number; finalTetoCentavos: number; ajusteEfetivo: boolean;
  }[];
};
type Grupo = {
  barbeiroId: string; qtd: number; creditos: bigint; percentual: bigint; pontos: bigint; ajusteEfetivo: boolean;
  base: bigint; baseResto: bigint; residual: boolean; final: bigint;
};
const zero = BigInt(0), um = BigInt(1), dois = BigInt(2), bps = BigInt(10000);
const compararId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const inteiro = (n: number) => {
  if (!Number.isSafeInteger(n)) throw new Error("O rateio exige valores inteiros seguros.");
  return BigInt(n);
};
const numero = (n: bigint) => {
  const v = Number(n);
  if (!Number.isSafeInteger(v)) throw new Error("O resultado do rateio excede o limite inteiro seguro.");
  return v;
};
const piso = (n: bigint, d: bigint) => n >= zero ? n / d : -((-n + d - um) / d);
const arredondar = (n: bigint, d: bigint) => piso(dois * n + d, dois * d);
const teto = (n: bigint, d: bigint) => -piso(-n, d);
const maior = (a: bigint, b: bigint) => a > b ? a : b;
const menor = (a: bigint, b: bigint) => a < b ? a : b;
const somar = (g: Grupo[], campo: "base" | "final" | "creditos" | "percentual") => g.reduce((t, x) => t + x[campo], zero);
const porResto = (resto: (x: Grupo) => bigint) => (a: Grupo, b: Grupo) => {
  const ra = resto(a), rb = resto(b);
  return ra === rb ? compararId(a.barbeiroId, b.barbeiroId) : ra > rb ? -1 : 1;
};

/** O contrato antigo continua calculado em regras.ts; aqui ele só recebe o diagnóstico. */
export function apurarRateioAssinaturas(
  percentualBps: number, distribuivelCentavos: number, entradas: EntradaRateio[], legado?: LinhaAssinaturas[],
) {
  const percentualBase = inteiro(percentualBps), distribuivel = inteiro(distribuivelCentavos);
  if (percentualBase < zero || percentualBase > bps || distribuivel < zero) throw new Error("Configuração inválida para o rateio das assinaturas.");
  const por = new Map<string, Grupo>();
  for (const a of entradas) {
    const c = inteiro(a.creditos);
    if (c <= zero) continue;
    const pontos = inteiro(a.pontosAdicionais);
    const efetivo = menor(bps, maior(zero, percentualBase + pontos));
    const g = por.get(a.barbeiroId) ?? { barbeiroId: a.barbeiroId, qtd: 0, creditos: zero, percentual: zero, pontos: zero, ajusteEfetivo: false, base: zero, baseResto: zero, residual: false, final: zero };
    g.qtd++; g.creditos += c; g.percentual += c * efetivo; g.pontos += c * pontos;
    por.set(a.barbeiroId, g);
  }
  const grupos = [...por.values()].sort((a, b) => compararId(a.barbeiroId, b.barbeiroId));
  for (const g of grupos) g.ajusteEfetivo = g.percentual !== percentualBase * g.creditos;
  const creditos = somar(grupos, "creditos"), denominador = bps * creditos;
  const pote = arredondar(distribuivel * percentualBase, bps);
  const alvoFinal = creditos ? arredondar(distribuivel * somar(grupos, "percentual"), denominador) : zero;
  const motivos: string[] = [];
  if (creditos) {
    for (const g of grupos) { g.base = pote * g.creditos / creditos; g.baseResto = pote * g.creditos % creditos; }
    let sobra = pote - somar(grupos, "base");
    for (const g of [...grupos].sort(porResto(x => x.baseResto))) {
      if (!sobra) break;
      g.base++; g.residual = true; sobra--;
    }
    for (const g of grupos) g.final = g.base;
    if (!legado) ajustarFinais(grupos, distribuivel, percentualBase, denominador, alvoFinal, motivos);
  } else if (pote > zero) {
    motivos.push("Não há atendimentos elegíveis com créditos. O pote está não rateado; não é uma sobra de arredondamento.");
  }
  const barbeiros = legado ?? grupos.map(g => ({
    barbeiroId: g.barbeiroId, qtd: g.qtd, creditos: numero(g.creditos),
    receitaAtribuida: numero(arredondar(distribuivel * g.creditos, creditos)), percentualBaseBps: percentualBps,
    adicionalBps: numero(arredondar(g.pontos, g.creditos)), comissaoBase: numero(g.base),
    adicionalCentavos: numero(g.final - g.base), comissao: numero(g.final),
  }));
  const somaBase = barbeiros.reduce((t, x) => t + inteiro(x.comissaoBase), zero);
  const somaFinal = barbeiros.reduce((t, x) => t + inteiro(x.comissao), zero);
  if (legado && creditos && (somaBase !== pote || somaFinal !== alvoFinal)) {
    motivos.push("O arredondamento legado deixa diferença no pote ou no total com adicionais. Os valores individuais foram preservados. Confira a competência e a política de rateio antes de fechar.");
  }
  const conciliacao: ConciliacaoAssinaturas = {
    metodo: legado ? "LEGADO" : "MAIORES_RESTOS_V1", status: !creditos ? "SEM_ELEGIVEIS" : motivos.length ? "REVISAO" : "OK",
    pendente: motivos.length > 0, motivos,
    criterioDesempate: legado ? "ARREDONDAMENTO_INDIVIDUAL_LEGADO" : "RESTO_DECRESCENTE_ID_CADEIRA_LEXICOGRAFICO_ASC_V1",
    ordemDesempate: grupos.map(g => g.barbeiroId),
    poteBaseAlvoCentavos: numero(pote), poteBaseSomaCentavos: numero(somaBase), poteBaseResiduoCentavos: creditos ? numero(pote - somaBase) : 0,
    totalFinalAlvoCentavos: numero(alvoFinal), totalFinalSomaCentavos: numero(somaFinal), totalFinalDiferencaCentavos: numero(alvoFinal - somaFinal),
    naoRateadoCentavos: creditos ? 0 : numero(pote),
    detalhes: grupos.map(g => ({
      barbeiroId: g.barbeiroId, creditos: numero(g.creditos), baseQuotaNumerador: String(pote * g.creditos),
      baseQuotaDenominador: String(creditos), baseRestoNumerador: String(g.baseResto), baseCentavoResidual: !legado && g.residual,
      finalQuotaNumerador: String(distribuivel * g.percentual), finalQuotaDenominador: String(denominador),
      finalPisoCentavos: numero(distribuivel * g.percentual / denominador), finalTetoCentavos: numero(teto(distribuivel * g.percentual, denominador)),
      ajusteEfetivo: g.ajusteEfetivo,
    })),
  };
  return { barbeiros, creditosTotal: numero(creditos), valorCreditoCentavos: creditos ? numero(arredondar(distribuivel, creditos)) : 0, conciliacao };
}

/** Só ajusta os afetados, dentro da quota final e do sinal efetivo; inviável mantém a prévia base bloqueada. */
function ajustarFinais(grupos: Grupo[], receita: bigint, baseBps: bigint, d: bigint, alvo: bigint, motivos: string[]) {
  const afetados = grupos.filter(g => g.ajusteEfetivo);
  if (!afetados.length) return;
  const limites = afetados.map(g => {
    const n = receita * g.percentual, delta = g.percentual - baseBps * g.creditos;
    let minimo = n / d, maximo = teto(n, d);
    if (delta >= zero) minimo = maior(minimo, g.base);
    if (delta <= zero) maximo = menor(maximo, g.base);
    return { g, minimo, maximo };
  });
  const fixos = grupos.filter(g => !g.ajusteEfetivo).reduce((t, g) => t + g.base, zero);
  const minimoTotal = limites.reduce((t, x) => t + x.minimo, zero);
  const maximoTotal = limites.reduce((t, x) => t + x.maximo, zero);
  const esperado = alvo - fixos;
  if (limites.some(x => x.minimo > x.maximo) || esperado < minimoTotal || esperado > maximoTotal) {
    motivos.push("Os adicionais não admitem rateio que preserve terceiros, o sinal e os limites das quotas finais. A prévia mostra somente o pote base; confira as regras antes de fechar. Nenhuma diferença foi absorvida.");
    return;
  }
  let faltam = esperado - minimoTotal;
  const ordem = [...afetados].sort(porResto(g => receita * g.percentual % d));
  const porId = new Map(limites.map(x => [x.g.barbeiroId, x]));
  for (const { g, minimo } of limites) g.final = minimo;
  for (const g of ordem) {
    const limite = porId.get(g.barbeiroId)!;
    if (faltam && g.final < limite.maximo) { g.final++; faltam--; }
  }
}
