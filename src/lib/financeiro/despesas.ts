/**
 * Contas a pagar. Despesa paga com dinheiro do caixa vira uma SANGRIA no caixa aberto (motivo "Despesa: ...").
 * Despesa recorrente, ao ser paga, cria a do mes seguinte (uma vez so).
 */
import { configuracao } from "@/lib/agenda/carregar";
import { colunaParaData, dataLocal, dataParaColuna, instanteLocal } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import { exigirPermissao } from "@/lib/auth/permissoes";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { caixaAberto, resumoCaixa } from "./caixa";
import { proximoVencimento, situacaoDespesa, totaisDespesas, type FormaDespesa } from "./regras";

export type DadosDespesa = {
  descricao: string; categoria: string; valorCentavos: number; vencimento: string;
  fornecedor?: string | null; observacao?: string | null; recorrente: boolean;
};

const limpo = (s?: string | null) => s?.trim() || null;

/** Inicio e fim (exclusivo) do mes AAAA-MM no fuso da barbearia. */
export async function janelaMes(mes: string) {
  const { fuso } = await configuracao();
  const [a, m] = mes.split("-").map(Number);
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  return { gte: new Date(instanteLocal(`${mes}-01`, 0, fuso)), lt: new Date(instanteLocal(`${prox}-01`, 0, fuso)), fuso };
}

/** Todas as pendentes + as pagas no mes (AAAA-MM), com os totais. */
export async function listarDespesas(mes: string) {
  const { gte, lt, fuso } = await janelaMes(mes);
  const hoje = dataLocal(Date.now(), fuso);
  const lista = await db.despesa.findMany({
    where: { OR: [{ status: "PENDENTE" }, { status: "PAGA", pagoEm: { gte, lt } }] },
    orderBy: [{ status: "asc" }, { vencimento: "asc" }, { criadoEm: "asc" }],
  });
  const despesas = lista.map((d) => {
    const x = { ...d, vencimento: colunaParaData(d.vencimento), pagoEmLocal: d.pagoEm ? dataLocal(d.pagoEm, fuso) : null };
    return { ...x, situacao: situacaoDespesa(x, hoje) };
  });
  const totais = totaisDespesas(despesas.map((d) => ({ ...d, pagoEm: d.pagoEmLocal })), hoje, mes);
  return { hoje, mes, despesas, totais };
}

async function buscar(id: string) {
  const d = await db.despesa.findUnique({ where: { id } });
  if (!d) throw naoEncontrado("Despesa");
  return d;
}

export async function criarDespesa(s: Sessao, p: DadosDespesa) {
  return db.$transaction(async (tx) => {
    const d = await tx.despesa.create({
      data: {
        descricao: p.descricao.trim(), categoria: p.categoria, valorCentavos: p.valorCentavos, vencimento: dataParaColuna(p.vencimento),
        fornecedor: limpo(p.fornecedor), observacao: limpo(p.observacao), recorrente: p.recorrente, criadoPorId: s.usuarioId,
      },
    });
    await auditar(tx, s.usuarioId, "despesa_criar", "despesa", d.id, { descricao: d.descricao, valorCentavos: d.valorCentavos, vencimento: p.vencimento });
    return d;
  });
}

export async function editarDespesa(s: Sessao, id: string, p: DadosDespesa) {
  const antes = await buscar(id);
  if (antes.status !== "PENDENTE") throw new ErroNegocio("Despesa já paga não pode ser editada. Estorne o pagamento antes.", 409, "paga");
  return db.$transaction(async (tx) => {
    const ok = await tx.despesa.updateMany({
      where: { id, status: "PENDENTE" },
      data: {
        descricao: p.descricao.trim(), categoria: p.categoria, valorCentavos: p.valorCentavos, vencimento: dataParaColuna(p.vencimento),
        fornecedor: limpo(p.fornecedor), observacao: limpo(p.observacao), recorrente: p.recorrente,
      },
    });
    if (!ok.count) throw new ErroNegocio("Essa despesa acabou de ser paga.", 409, "paga");
    await auditar(tx, s.usuarioId, "despesa_editar", "despesa", id, {
      antes: { descricao: antes.descricao, valorCentavos: antes.valorCentavos, vencimento: colunaParaData(antes.vencimento), categoria: antes.categoria },
      depois: { descricao: p.descricao, valorCentavos: p.valorCentavos, vencimento: p.vencimento, categoria: p.categoria },
    });
  });
}

export async function excluirDespesa(s: Sessao, id: string) {
  await exigirPermissao(s, "excluir");
  const d = await buscar(id);
  if (d.status !== "PENDENTE") throw new ErroNegocio("Despesa já paga não pode ser excluída. Estorne o pagamento antes.", 409, "paga");
  await db.$transaction(async (tx) => {
    const ok = await tx.despesa.deleteMany({ where: { id, status: "PENDENTE" } });
    if (!ok.count) throw new ErroNegocio("Essa despesa acabou de ser paga.", 409, "paga");
    await auditar(tx, s.usuarioId, "despesa_excluir", "despesa", id, { descricao: d.descricao, valorCentavos: d.valorCentavos, vencimento: colunaParaData(d.vencimento) });
  });
}

/** Paga a despesa. Dinheiro do caixa exige caixa aberto e sai como sangria (sempre com a hora de agora). */
export async function pagarDespesa(s: Sessao, id: string, p: { forma: FormaDespesa; data: string }) {
  const d = await buscar(id);
  if (d.status !== "PENDENTE") throw new ErroNegocio("Essa despesa já está paga.", 409, "paga");
  const { fuso } = await configuracao();
  const hoje = dataLocal(Date.now(), fuso);
  if (p.data > hoje) throw new ErroNegocio("A data do pagamento não pode ser no futuro.");
  let caixaId: string | null = null;
  let pagoEm = p.data === hoje ? new Date() : new Date(instanteLocal(p.data, 12 * 60, fuso));
  if (p.forma === "DINHEIRO_CAIXA") {
    const c = await caixaAberto();
    if (!c) throw new ErroNegocio("Para pagar com dinheiro do caixa, abra o caixa primeiro.", 409, "fechado");
    if (d.valorCentavos > (await resumoCaixa(c)).esperado) throw new ErroNegocio("A despesa é maior do que o dinheiro que deveria estar no caixa.", 422, "sem_dinheiro");
    caixaId = c.id;
    pagoEm = new Date();
  }
  return db.$transaction(async (tx) => {
    const ok = await tx.despesa.updateMany({ where: { id, status: "PENDENTE" }, data: { status: "PAGA", pagoEm, formaPagamento: p.forma } });
    if (!ok.count) throw new ErroNegocio("Essa despesa já está paga.", 409, "paga");
    let movimentoId: string | null = null;
    if (caixaId) {
      // O caixa pode ter sido fechado entre a conferencia e aqui.
      if ((await tx.caixa.findUnique({ where: { id: caixaId } }))?.status !== "ABERTO") throw new ErroNegocio("O caixa foi fechado. Abra o caixa de novo.", 409, "fechado");
      const m = await tx.movimentoCaixa.create({
        data: { caixaId, tipo: "SANGRIA", valorCentavos: d.valorCentavos, motivo: `Despesa: ${d.descricao}`.slice(0, 200), usuarioId: s.usuarioId },
      });
      movimentoId = m.id;
      await tx.despesa.update({ where: { id }, data: { movimentoCaixaId: m.id } });
      await auditar(tx, s.usuarioId, "sangria", "caixa", caixaId, { valorCentavos: d.valorCentavos, motivo: m.motivo, despesaId: id });
    }
    // Recorrente: cria a do mes seguinte so se ainda nao existir (pagar, estornar e pagar de novo nao duplica).
    let proximaId: string | null = null;
    if (d.recorrente) {
      const venc = dataParaColuna(proximoVencimento(colunaParaData(d.vencimento)));
      const ja = await tx.despesa.findFirst({ where: { descricao: d.descricao, categoria: d.categoria, recorrente: true, vencimento: venc } });
      if (!ja) {
        const n = await tx.despesa.create({
          data: {
            descricao: d.descricao, categoria: d.categoria, valorCentavos: d.valorCentavos, vencimento: venc, fornecedor: d.fornecedor,
            observacao: d.observacao, recorrente: true, criadoPorId: s.usuarioId,
          },
        });
        proximaId = n.id;
      }
    }
    await auditar(tx, s.usuarioId, "despesa_pagar", "despesa", id, { forma: p.forma, data: p.data, valorCentavos: d.valorCentavos, movimentoCaixaId: movimentoId, proximaId });
    return { id, movimentoCaixaId: movimentoId, proximaId };
  });
}

/** Volta a despesa para pendente. Se saiu do caixa, so com aquele caixa ainda aberto (o movimento e removido). */
export async function estornarDespesa(s: Sessao, id: string) {
  await exigirPermissao(s, "excluir");
  const d = await buscar(id);
  if (d.status !== "PAGA") throw new ErroNegocio("Essa despesa não está paga.", 409, "pendente");
  const mov = d.movimentoCaixaId ? await db.movimentoCaixa.findUnique({ where: { id: d.movimentoCaixaId }, include: { caixa: true } }) : null;
  if (mov && mov.caixa.status !== "ABERTO") {
    throw new ErroNegocio("O dinheiro saiu de um caixa que já foi fechado. Não dá para estornar: registre um suprimento no caixa atual se o dinheiro voltou.", 409, "caixa_fechado");
  }
  await db.$transaction(async (tx) => {
    const ok = await tx.despesa.updateMany({ where: { id, status: "PAGA" }, data: { status: "PENDENTE", pagoEm: null, formaPagamento: null, movimentoCaixaId: null } });
    if (!ok.count) throw new ErroNegocio("Essa despesa não está paga.", 409, "pendente");
    if (mov) {
      await tx.movimentoCaixa.delete({ where: { id: mov.id } });
      await auditar(tx, s.usuarioId, "sangria_estornada", "caixa", mov.caixaId, { valorCentavos: mov.valorCentavos, motivo: mov.motivo, despesaId: id });
    }
    await auditar(tx, s.usuarioId, "despesa_estornar", "despesa", id, { forma: d.formaPagamento, pagoEm: d.pagoEm?.toISOString() ?? null, valorCentavos: d.valorCentavos });
  });
}
