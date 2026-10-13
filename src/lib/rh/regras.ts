/**
 * Regras puras do RH: comissao por servico (avulso x plano), totais da folha e CSV.
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

/**
 * Comissao de um atendimento. Avulso: % do preco cobrado (ou fixo).
 * Plano: % do preco de tabela do servico (o cobrado costuma ser 0) ou fixo por corte.
 */
export function calcularComissao(regra: Regra | null, a: { modalidade: Modalidade; preco: number; precoTabela: number }) {
  const base = a.modalidade === "AVULSO" ? a.preco : a.precoTabela;
  if (!regra) return { base, comissao: 0, regra: "Sem regra" };
  const [tipo, valor] = a.modalidade === "AVULSO" ? [regra.avulsoTipo, regra.avulsoValor] : [regra.planoTipo, regra.planoValor];
  const comissao = tipo === "FIXO" ? valor : Math.round((base * valor) / 10000);
  return { base, comissao, regra: descreverRegra(tipo, valor, a.modalidade) };
}

export type Atendimento = { id: string; barbeiroId: string; servicoId: string; preco: number; precoTabela: number; plano: boolean };
type Soma = { qtd: number; base: number; comissao: number };
const soma = (): Soma => ({ qtd: 0, base: 0, comissao: 0 });

/**
 * Agrupa por barbeiro: avulso, plano, total e o detalhe de cada atendimento.
 * `planoPeloPote`: o atendimento pelo plano e pago pelo pote de assinaturas (aqui fica zero).
 */
export function resumirComissoes<A extends Atendimento>(atendimentos: A[], regras: RegraSalva[], opts: { planoPeloPote?: boolean } = {}) {
  const porBarbeiro = new Map<string, { barbeiroId: string; avulso: Soma; plano: Soma; total: number; semRegra: number; detalhe: (A & { modalidade: Modalidade; base: number; comissao: number; regra: string })[] }>();
  for (const a of atendimentos) {
    const modalidade: Modalidade = a.plano ? "PLANO" : "AVULSO";
    const pote = a.plano && !!opts.planoPeloPote;
    const regra = pote ? null : escolherRegra(regras, a.servicoId, a.barbeiroId);
    const c = pote ? { base: a.precoTabela, comissao: 0, regra: "Pote de assinaturas" } : calcularComissao(regra, { modalidade, preco: a.preco, precoTabela: a.precoTabela });
    const g = porBarbeiro.get(a.barbeiroId) ?? { barbeiroId: a.barbeiroId, avulso: soma(), plano: soma(), total: 0, semRegra: 0, detalhe: [] };
    const s = a.plano ? g.plano : g.avulso;
    s.qtd++;
    s.base += c.base;
    s.comissao += c.comissao;
    g.total += c.comissao;
    if (!regra && !pote) g.semRegra++;
    g.detalhe.push({ ...a, modalidade, ...c });
    porBarbeiro.set(a.barbeiroId, g);
  }
  return [...porBarbeiro.values()];
}

// ---------------- pote de assinaturas

export type AjustePote = { adicionalBps: number; diferenciadaBps: number | null };
export type ConfigPote = { ativo: boolean; percentualBps: number; fichas: Record<string, number>; ajustes: Record<string, AjustePote> };

/** % do barbeiro: o diferenciado substitui o do pote; senao, o do pote + adicional. */
export function percentualDoBarbeiro(cfg: Pick<ConfigPote, "percentualBps" | "ajustes">, barbeiroId: string) {
  const a = cfg.ajustes[barbeiroId];
  return a?.diferenciadaBps ?? cfg.percentualBps + (a?.adicionalBps ?? 0);
}

/**
 * Divide o pote pelos atendimentos de plano: cada barbeiro recebe receita x seu % x (fichas dele / fichas de todos).
 * Servico sem fichas nao entra. Sem atendimentos, ninguem recebe.
 */
export function calcularPote(cfg: ConfigPote, receitaCentavos: number, atendimentos: { barbeiroId: string; servicoId: string }[]) {
  const por = new Map<string, { qtd: number; fichas: number }>();
  let fichasTotal = 0;
  for (const a of atendimentos) {
    const f = cfg.fichas[a.servicoId] ?? 0;
    if (f <= 0) continue;
    const x = por.get(a.barbeiroId) ?? { qtd: 0, fichas: 0 };
    por.set(a.barbeiroId, { qtd: x.qtd + 1, fichas: x.fichas + f });
    fichasTotal += f;
  }
  const barbeiros = [...por].map(([barbeiroId, x]) => {
    const percentualBps = percentualDoBarbeiro(cfg, barbeiroId);
    return { barbeiroId, ...x, percentualBps, comissao: Math.round((receitaCentavos * percentualBps * x.fichas) / (10000 * fichasTotal)) };
  });
  return { receitaCentavos, percentualBps: cfg.percentualBps, valorPote: Math.round((receitaCentavos * cfg.percentualBps) / 10000), fichasTotal, barbeiros };
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
