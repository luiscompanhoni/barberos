/**
 * Regras puras do RH: comissao por servico (avulso x plano), comissao das assinaturas, comissao diferenciada,
 * totais da folha e CSV.
 */

export type TipoComissao = "PERCENTUAL" | "FIXO";
export type Regra = { avulsoTipo: TipoComissao; avulsoValor: number; planoTipo: TipoComissao; planoValor: number };
export type RegraSalva = Regra & { servicoId: string; barbeiroId: string | null };
export type Modalidade = "AVULSO" | "PLANO";

/** Sugestao inicial (o dono muda): avulso 40% e plano R$ 15,00 fixo por corte. */
export const REGRA_SUGERIDA: Regra = { avulsoTipo: "PERCENTUAL", avulsoValor: 4000, planoTipo: "FIXO", planoValor: 1500 };

/** Excecao do barbeiro no servico; senao a regra geral do servico; senao null (sem regra). */
export function escolherRegra<R extends RegraSalva>(regras: R[], servicoId: string, barbeiroId: string): R | null {
  return regras.find((r) => r.servicoId === servicoId && r.barbeiroId === barbeiroId)
    ?? regras.find((r) => r.servicoId === servicoId && r.barbeiroId === null)
    ?? null;
}

const valorTexto = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
const pctTexto = (bps: number) => `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

export function descreverRegra(tipo: TipoComissao, valor: number, modalidade: Modalidade) {
  if (tipo === "FIXO") return `${valorTexto(valor)} fixo`;
  return `${pctTexto(valor)} ${modalidade === "PLANO" ? "da tabela" : "do valor"}`;
}

/** Percentual final entre 0% e 100%. */
const limitar = (bps: number) => Math.min(10000, Math.max(0, bps));
const pontosTexto = (bps: number) => `${bps < 0 ? "−" : "+"} ${(Math.abs(bps) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} pts`;

/**
 * Comissao de um atendimento. Avulso: % do valor efetivamente cobrado (ou fixo).
 * Plano: % do preco de tabela do servico (o cobrado costuma ser 0) ou fixo por corte.
 * `adicionalBps`: comissao diferenciada do barbeiro no dia (so vale em regra percentual).
 */
export function calcularComissao(regra: Regra | null, a: { modalidade: Modalidade; preco: number; precoTabela: number }, adicionalBps = 0) {
  const base = a.modalidade === "AVULSO" ? a.preco : a.precoTabela;
  if (!regra) return { base, comissao: 0, adicional: 0, regra: "Sem regra" };
  const [tipo, valor] = a.modalidade === "AVULSO" ? [regra.avulsoTipo, regra.avulsoValor] : [regra.planoTipo, regra.planoValor];
  if (tipo === "FIXO") return { base, comissao: valor, adicional: 0, regra: descreverRegra(tipo, valor, a.modalidade) };
  const semAdicional = Math.round((base * valor) / 10000);
  const comissao = Math.round((base * limitar(valor + adicionalBps)) / 10000);
  const texto = descreverRegra(tipo, valor, a.modalidade);
  return { base, comissao, adicional: comissao - semAdicional, regra: adicionalBps ? `${texto} ${pontosTexto(adicionalBps)}` : texto };
}

export type Atendimento = { id: string; barbeiroId: string; servicoId: string; preco: number; precoTabela: number; plano: boolean; dia: string };
type Soma = { qtd: number; base: number; comissao: number; adicional: number };
const soma = (): Soma => ({ qtd: 0, base: 0, comissao: 0, adicional: 0 });

/**
 * Agrupa por barbeiro: avulso, plano, total e o detalhe de cada atendimento.
 * `planoPeloPote`: o atendimento pelo plano e pago pela comissao das assinaturas (aqui fica zero).
 * `adicionais`: comissao diferenciada de cada barbeiro (pelo dia do atendimento).
 */
export function resumirComissoes<A extends Atendimento>(atendimentos: A[], regras: RegraSalva[], opts: { planoPeloPote?: boolean; adicionais?: Adicional[] } = {}) {
  const porBarbeiro = new Map<string, { barbeiroId: string; avulso: Soma; plano: Soma; total: number; semRegra: number; detalhe: (A & { modalidade: Modalidade; base: number; comissao: number; adicional: number; regra: string })[] }>();
  for (const a of atendimentos) {
    const modalidade: Modalidade = a.plano ? "PLANO" : "AVULSO";
    const pote = a.plano && !!opts.planoPeloPote;
    const regra = pote ? null : escolherRegra(regras, a.servicoId, a.barbeiroId);
    const adicionalBps = adicionalNoDia(opts.adicionais ?? [], a.barbeiroId, a.plano ? "ASSINATURA" : "AVULSO", a.dia);
    const c = pote
      ? { base: a.precoTabela, comissao: 0, adicional: 0, regra: "Comissão das assinaturas" }
      : calcularComissao(regra, { modalidade, preco: a.preco, precoTabela: a.precoTabela }, adicionalBps);
    const g = porBarbeiro.get(a.barbeiroId) ?? { barbeiroId: a.barbeiroId, avulso: soma(), plano: soma(), total: 0, semRegra: 0, detalhe: [] };
    const s = a.plano ? g.plano : g.avulso;
    s.qtd++;
    s.base += c.base;
    s.comissao += c.comissao;
    s.adicional += c.adicional;
    g.total += c.comissao;
    if (!regra && !pote) g.semRegra++;
    g.detalhe.push({ ...a, modalidade, ...c });
    porBarbeiro.set(a.barbeiroId, g);
  }
  return [...porBarbeiro.values()];
}

/**
 * Parte do servico que ficou com a barbearia: o desconto da comanda (inclui saldo usado) e os estornos saem
 * na proporcao do valor do item. `item` e `subtotal` em centavos; produtos de outros itens nao entram.
 */
export function valorCobradoItem(item: number, comanda: { subtotal: number; desconto: number; estornado: number }) {
  if (item <= 0 || comanda.subtotal <= 0) return 0;
  const total = comanda.subtotal - Math.min(Math.max(0, comanda.desconto), comanda.subtotal);
  const liquido = Math.max(0, total - Math.max(0, comanda.estornado));
  return Math.round((item * liquido) / comanda.subtotal);
}

// ---------------- comissao diferenciada (adicionais com vigencia)

export type ModalidadeAdicional = "ASSINATURA" | "AVULSO";
/** Datas "AAAA-MM-DD" (inclusive); fim null = sem fim. */
export type Adicional = { barbeiroId: string; modalidade: ModalidadeAdicional; pontosBps: number; inicio: string; fim: string | null };

const vale = (a: Pick<Adicional, "inicio" | "fim">, dia: string) => a.inicio <= dia && (a.fim === null || dia <= a.fim);

/** Pontos a mais (ou a menos) do barbeiro na modalidade, no dia do atendimento. */
export function adicionalNoDia(adicionais: Adicional[], barbeiroId: string, modalidade: ModalidadeAdicional, dia: string) {
  return adicionais.filter((a) => a.barbeiroId === barbeiroId && a.modalidade === modalidade && vale(a, dia)).reduce((t, a) => t + a.pontosBps, 0);
}

/** Dois periodos [inicio, fim] (fim null = sem fim) tem algum dia em comum? */
export function periodosSeCruzam(a: { inicio: string; fim: string | null }, b: { inicio: string; fim: string | null }) {
  return a.inicio <= (b.fim ?? "9999-12-31") && b.inicio <= (a.fim ?? "9999-12-31");
}

/** Primeira folha fechada (competencia "AAAA-MM") que o periodo alcanca, ou null. */
export function competenciaFechadaNoPeriodo(fechadas: string[], periodo: { inicio: string; fim: string | null }) {
  return [...fechadas].sort().find((c) => { const i = intervaloCompetencia(c); return periodosSeCruzam(periodo, { inicio: i.inicio, fim: i.fim }); }) ?? null;
}

// ---------------- comissao das assinaturas (o "pote" do CashBarber)

/** Percentual base (3500 = 35%) e Creditos de Atendimento por servico. */
export type ConfigAssinaturas = { ativo: boolean; percentualBps: number; creditos: Record<string, number> };

/**
 * Comissao das assinaturas no periodo:
 * - Receita de Assinaturas: mensalidades pagas; Receita Distribuivel: ela menos os estornos do periodo
 *   (taxas do meio de pagamento ficam com a barbearia e nao entram);
 * - cada atendimento pelo plano gera os Creditos de Atendimento do servico (sem credito, nao entra);
 * - valor do credito = distribuivel / creditos de todos; receita atribuida = creditos do barbeiro x valor do credito;
 * - comissao = receita atribuida x (percentual base + adicional do barbeiro no dia do atendimento).
 * O adicional e pago pela barbearia: nao muda a parte dos outros.
 */
export function calcularAssinaturas(
  cfg: Pick<ConfigAssinaturas, "percentualBps" | "creditos">,
  receita: { recebidoCentavos: number; estornosCentavos: number },
  atendimentos: { barbeiroId: string; servicoId: string; dia: string }[],
  adicionais: Adicional[] = [],
) {
  const distribuivel = Math.max(0, receita.recebidoCentavos - receita.estornosCentavos);
  const por = new Map<string, { qtd: number; creditos: number; creditosPct: number; creditosAdic: number }>();
  let creditosTotal = 0;
  for (const a of atendimentos) {
    const c = cfg.creditos[a.servicoId] ?? 0;
    if (c <= 0) continue;
    const adic = adicionalNoDia(adicionais, a.barbeiroId, "ASSINATURA", a.dia);
    const x = por.get(a.barbeiroId) ?? { qtd: 0, creditos: 0, creditosPct: 0, creditosAdic: 0 };
    por.set(a.barbeiroId, { qtd: x.qtd + 1, creditos: x.creditos + c, creditosPct: x.creditosPct + c * limitar(cfg.percentualBps + adic), creditosAdic: x.creditosAdic + c * adic });
    creditosTotal += c;
  }
  const barbeiros = [...por].map(([barbeiroId, x]) => {
    const comissaoBase = Math.round((distribuivel * x.creditos * cfg.percentualBps) / (10000 * creditosTotal));
    const comissao = Math.round((distribuivel * x.creditosPct) / (10000 * creditosTotal));
    return {
      barbeiroId, qtd: x.qtd, creditos: x.creditos,
      receitaAtribuida: Math.round((distribuivel * x.creditos) / creditosTotal),
      percentualBaseBps: cfg.percentualBps,
      // Media pelos creditos (o adicional pode ter mudado no meio do periodo).
      adicionalBps: Math.round(x.creditosAdic / x.creditos),
      comissaoBase, adicionalCentavos: comissao - comissaoBase, comissao,
    };
  });
  return {
    recebidoCentavos: receita.recebidoCentavos, estornosCentavos: receita.estornosCentavos, distribuivelCentavos: distribuivel,
    creditosTotal, valorCreditoCentavos: creditosTotal ? Math.round(distribuivel / creditosTotal) : 0, percentualBaseBps: cfg.percentualBps, barbeiros,
  };
}

// ---------------- comissao de produtos

export type CategoriaComissao = "BAR" | "LOJA";
export type FaixaProduto = { categoria: CategoriaComissao; minimoCentavos: number; percentualBps: number };

/** Maior faixa alcancada na categoria (null = nao chegou na primeira). */
export function faixaAlcancada(faixas: FaixaProduto[], categoria: CategoriaComissao, vendido: number) {
  return faixas.filter((f) => f.categoria === categoria && vendido >= f.minimoCentavos).sort((a, b) => b.minimoCentavos - a.minimoCentavos)[0] ?? null;
}

/** Por barbeiro e categoria: total vendido no periodo e a comissao da faixa alcancada (sobre o total). */
export function comissaoProdutos(vendas: { barbeiroId: string; categoria: CategoriaComissao; valorCentavos: number }[], faixas: FaixaProduto[]) {
  const soma = new Map<string, number>();
  for (const v of vendas) soma.set(`${v.barbeiroId}|${v.categoria}`, (soma.get(`${v.barbeiroId}|${v.categoria}`) ?? 0) + v.valorCentavos);
  const por = new Map<string, { vendido: number; comissao: number; categorias: { categoria: CategoriaComissao; vendido: number; percentualBps: number; comissao: number }[] }>();
  for (const [k, vendido] of soma) {
    const [barbeiroId, categoria] = k.split("|") as [string, CategoriaComissao];
    const percentualBps = faixaAlcancada(faixas, categoria, vendido)?.percentualBps ?? 0;
    const comissao = Math.round((vendido * percentualBps) / 10000);
    const x = por.get(barbeiroId) ?? { vendido: 0, comissao: 0, categorias: [] };
    x.vendido += vendido;
    x.comissao += comissao;
    x.categorias.push({ categoria, vendido, percentualBps, comissao });
    por.set(barbeiroId, x);
  }
  return por;
}

// ---------------- folha

export type TipoLancamento = "ADICIONAL" | "BONUS" | "VALE" | "DESCONTO";
export const SOMA: TipoLancamento[] = ["ADICIONAL", "BONUS"];

/** salario + comissao + adicionais/bonus - vales/descontos = liquido. */
export function totaisFolha(p: { salario: number; comissao: number; lancamentos: { tipo: TipoLancamento; valorCentavos: number }[] }) {
  const adicionais = p.lancamentos.filter((l) => SOMA.includes(l.tipo)).reduce((t, l) => t + l.valorCentavos, 0);
  const descontos = p.lancamentos.filter((l) => !SOMA.includes(l.tipo)).reduce((t, l) => t + l.valorCentavos, 0);
  return { salario: p.salario, comissao: p.comissao, adicionais, descontos, liquido: p.salario + p.comissao + adicionais - descontos };
}

/** "AAAA-MM" -> primeiro e ultimo dia ("AAAA-MM-DD"). */
export function intervaloCompetencia(comp: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(comp);
  if (!m || +m[2] < 1 || +m[2] > 12) throw new Error(`Competência inválida: ${comp}`);
  const ultimo = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
  return { inicio: `${comp}-01`, fim: `${comp}-${String(ultimo).padStart(2, "0")}` };
}

const celula = (v: string | number) => {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dinheiro = (c: number) => (c / 100).toFixed(2).replace(".", ",");

/** CSV (separador ;, padrao do Excel em portugues) da folha do mes. */
export function csvFolha(comp: string, linhas: { nome: string; cargo: string | null; salario: number; comissao: number; adicionais: number; descontos: number; liquido: number; status: string; chavePix: string | null }[]) {
  const cab = ["Competência", "Funcionário", "Cargo", "Salário", "Comissão", "Adicionais", "Descontos", "Líquido", "Situação", "Chave Pix"];
  const corpo = linhas.map((l) => [comp, l.nome, l.cargo ?? "", dinheiro(l.salario), dinheiro(l.comissao), dinheiro(l.adicionais), dinheiro(l.descontos), dinheiro(l.liquido), l.status, l.chavePix ?? ""]);
  const t = totaisLinhas(linhas);
  corpo.push([comp, "TOTAL", "", dinheiro(t.salario), dinheiro(t.comissao), dinheiro(t.adicionais), dinheiro(t.descontos), dinheiro(t.liquido), "", ""]);
  return [cab, ...corpo].map((r) => r.map(celula).join(";")).join("\r\n");
}

export function totaisLinhas(ls: { salario: number; comissao: number; adicionais: number; descontos: number; liquido: number }[]) {
  return ls.reduce((t, l) => ({ salario: t.salario + l.salario, comissao: t.comissao + l.comissao, adicionais: t.adicionais + l.adicionais, descontos: t.descontos + l.descontos, liquido: t.liquido + l.liquido }), { salario: 0, comissao: 0, adicionais: 0, descontos: 0, liquido: 0 });
}
