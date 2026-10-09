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

/** Agrupa por barbeiro: avulso, plano, total e o detalhe de cada atendimento. */
export function resumirComissoes<A extends Atendimento>(atendimentos: A[], regras: RegraSalva[]) {
  const porBarbeiro = new Map<string, { barbeiroId: string; avulso: Soma; plano: Soma; total: number; semRegra: number; detalhe: (A & { modalidade: Modalidade; base: number; comissao: number; regra: string })[] }>();
  for (const a of atendimentos) {
    const modalidade: Modalidade = a.plano ? "PLANO" : "AVULSO";
    const regra = escolherRegra(regras, a.servicoId, a.barbeiroId);
    const c = calcularComissao(regra, { modalidade, preco: a.preco, precoTabela: a.precoTabela });
    const g = porBarbeiro.get(a.barbeiroId) ?? { barbeiroId: a.barbeiroId, avulso: soma(), plano: soma(), total: 0, semRegra: 0, detalhe: [] };
    const s = a.plano ? g.plano : g.avulso;
    s.qtd++;
    s.base += c.base;
    s.comissao += c.comissao;
    g.total += c.comissao;
    if (!regra) g.semRegra++;
    g.detalhe.push({ ...a, modalidade, ...c });
    porBarbeiro.set(a.barbeiroId, g);
  }
  return [...porBarbeiro.values()];
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
