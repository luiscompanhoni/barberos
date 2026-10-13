// Teste de integracao das despesas, do extrato do caixa e do resumo do mes, contra o banco de
// DESENVOLVIMENTO. Cria e apaga os proprios dados. Rodar: npm run teste:despesas
import { configuracao } from "@/lib/agenda/carregar";
import { colunaParaData, dataLocal } from "@/lib/agenda/tempo";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { abrirCaixa, caixaAberto, fecharCaixa, resumoCaixa } from "@/lib/financeiro/caixa";
import { criarDespesa, editarDespesa, estornarDespesa, excluirDespesa, listarDespesas, pagarDespesa } from "@/lib/financeiro/despesas";
import { extratoCaixa } from "@/lib/financeiro/extrato";
import { proximoVencimento } from "@/lib/financeiro/regras";
import { resumoMes } from "@/lib/financeiro/resumo";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string }; } };
const TAG = "[teste despesas]";

async function main() {
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  const s: Sessao = { usuarioId: dono.id, papel: "DONO", nome: dono.nome, barbeiroId: null, clienteId: null };
  const hoje = dataLocal(Date.now(), (await configuracao()).fuso);
  const mes = hoje.slice(0, 7);
  // Nao mexe em caixa de verdade aberto no banco de desenvolvimento.
  const jaAberto = await caixaAberto();
  if (jaAberto) await db.caixa.update({ where: { id: jaAberto.id }, data: { status: "FECHADO", fechadoEm: new Date(), observacao: "fechado pelo teste" } });
  const comandas: string[] = [];
  const caixas: string[] = [];
  try {
    const antes = await resumoMes(mes);
    const base = { descricao: `${TAG} Água`, categoria: "AGUA", valorCentavos: 3000, vencimento: hoje, recorrente: true };

    // ================= DESPESA PAGA COM DINHEIRO DO CAIXA
    const a = await criarDespesa(s, base);
    ok((await falha(() => pagarDespesa(s, a.id, { forma: "DINHEIRO_CAIXA", data: hoje })))?.codigo === "fechado", "sem caixa aberto não paga com dinheiro do caixa");
    const c = await abrirCaixa(s, 10000);
    caixas.push(c.id);
    // Comanda de R$ 40 paga com R$ 50 em dinheiro (troco R$ 10)
    const cm = await db.comanda.create({
      data: {
        nomeAvulso: TAG, status: "FECHADA", fechadaEm: new Date(Date.now() + 1000), itens: { create: [{ descricao: "Corte", precoUnitCentavos: 4000 }] },
        pagamentos: { create: [{ forma: "DINHEIRO", valorCentavos: 5000, status: "PAGO", pagoEm: new Date(Date.now() + 500) }] },
      },
    });
    comandas.push(cm.id);
    await new Promise((r) => setTimeout(r, 1200));
    const grande = await criarDespesa(s, { ...base, descricao: `${TAG} Grande`, valorCentavos: 999_999, recorrente: false });
    ok((await falha(() => pagarDespesa(s, grande.id, { forma: "DINHEIRO_CAIXA", data: hoje })))?.codigo === "sem_dinheiro", "não paga com o caixa mais do que tem na gaveta");
    await excluirDespesa(s, grande.id);
    ok(!(await db.despesa.findUnique({ where: { id: grande.id } })), "exclui despesa pendente");

    const esperadoAntes = (await resumoCaixa((await caixaAberto())!)).esperado;
    ok(esperadoAntes === 14000, `esperado antes = 100 + 50 - 10 (${esperadoAntes})`);
    const pg = await pagarDespesa(s, a.id, { forma: "DINHEIRO_CAIXA", data: hoje });
    const mov = await db.movimentoCaixa.findUnique({ where: { id: pg.movimentoCaixaId ?? "" } });
    ok(!!mov && mov.tipo === "SANGRIA" && mov.valorCentavos === 3000 && mov.motivo === `Despesa: ${TAG} Água` && mov.caixaId === c.id, "vira sangria no caixa com o motivo da despesa");
    ok((await db.despesa.findUniqueOrThrow({ where: { id: a.id } })).movimentoCaixaId === mov?.id, "guarda o movimentoCaixaId");
    ok((await resumoCaixa((await caixaAberto())!)).esperado === 11000, "reduz o esperado do caixa");
    ok((await falha(() => pagarDespesa(s, a.id, { forma: "PIX", data: hoje })))?.codigo === "paga", "não paga duas vezes");
    ok((await falha(() => editarDespesa(s, a.id, base)))?.codigo === "paga", "não edita despesa paga");
    ok((await falha(() => excluirDespesa(s, a.id)))?.codigo === "paga", "não exclui despesa paga");

    // ================= RECORRENTE
    const prox = proximoVencimento(hoje);
    const proximas = () => db.despesa.findMany({ where: { descricao: base.descricao, status: "PENDENTE" } });
    let ps = await proximas();
    ok(ps.length === 1 && colunaParaData(ps[0].vencimento) === prox && ps[0].recorrente && ps[0].valorCentavos === 3000, `recorrente cria a do mês seguinte (${prox})`);

    // ================= ESTORNO
    await estornarDespesa(s, a.id);
    const est = await db.despesa.findUniqueOrThrow({ where: { id: a.id } });
    ok(est.status === "PENDENTE" && !est.pagoEm && !est.movimentoCaixaId, "estorno volta para pendente");
    ok(!(await db.movimentoCaixa.findUnique({ where: { id: mov!.id } })), "estorno remove a sangria do caixa");
    ok((await resumoCaixa((await caixaAberto())!)).esperado === 14000, "esperado volta ao valor de antes");
    await pagarDespesa(s, a.id, { forma: "DINHEIRO_CAIXA", data: hoje });
    ps = await proximas();
    ok(ps.length === 1, "pagar de novo não duplica a do mês seguinte");

    // Outra despesa paga por Pix: nao mexe no caixa
    const b = await criarDespesa(s, { descricao: `${TAG} Internet`, categoria: "INTERNET", valorCentavos: 2000, vencimento: hoje, recorrente: false, fornecedor: "Provedor" });
    const pb = await pagarDespesa(s, b.id, { forma: "PIX", data: hoje });
    ok(pb.movimentoCaixaId === null && (await resumoCaixa((await caixaAberto())!)).esperado === 11000, "despesa no Pix não mexe no caixa");
    ok((await falha(() => pagarDespesa(s, ps[0].id, { forma: "PIX", data: "2999-01-01" }))) !== null, "data de pagamento no futuro é recusada");

    const lista = await listarDespesas(mes);
    ok(lista.despesas.some((d) => d.id === b.id && d.situacao === "PAGA") && lista.totais.pagasNoMes >= 5000, "lista traz as pagas no mês com os totais");

    // ================= EXTRATO
    const ex = await extratoCaixa(c.id);
    ok(ex.linhas.map((l) => l.tipo).join() === "ABERTURA,PAGAMENTO,TROCO,DESPESA", `extrato em ordem (${ex.linhas.map((l) => l.tipo).join()})`);
    ok(ex.linhas.map((l) => l.saldoCentavos).join() === "10000,15000,14000,11000", `saldo da gaveta linha a linha (${ex.linhas.map((l) => l.saldoCentavos).join()})`);
    ok(ex.linhas[1].comanda === cm.numero && ex.linhas[1].cliente === TAG && ex.linhas[3].descricao.includes("Água"), "linha com comanda, cliente e descrição da despesa");
    ok(ex.saldoDinheiro === (await resumoCaixa((await caixaAberto())!)).esperado, "saldo final do extrato = esperado do caixa");
    await fecharCaixa(s, 11000);
    const exf = await extratoCaixa(c.id);
    const fim = exf.linhas.at(-1)!;
    ok(fim.tipo === "FECHAMENTO" && fim.contado === 11000 && fim.esperado === 11000 && fim.diferenca === 0 && fim.saldoCentavos === 11000, "fechamento no fim, com contado/esperado/diferença");
    ok((await falha(() => estornarDespesa(s, a.id)))?.codigo === "caixa_fechado", "não estorna despesa que saiu de caixa já fechado");

    // ================= RESUMO DO MES
    const depois = await resumoMes(mes);
    ok(depois.receitas.comandas.total - antes.receitas.comandas.total === 4000, "receita das comandas soma o total da comanda (sem o troco)");
    ok(depois.receitas.comandas.porForma.DINHEIRO - antes.receitas.comandas.porForma.DINHEIRO === 4000, "dinheiro por forma já sem o troco");
    ok(depois.despesas.total - antes.despesas.total === 5000, "despesas pagas do mês somam as duas");
    ok((depois.despesas.porCategoria.AGUA ?? 0) - (antes.despesas.porCategoria.AGUA ?? 0) === 3000 && (depois.despesas.porCategoria.INTERNET ?? 0) - (antes.despesas.porCategoria.INTERNET ?? 0) === 2000, "despesas por categoria");
    ok(depois.resultado - antes.resultado === -1000, "resultado = receitas - despesas");
    ok(depois.receitas.total === depois.receitas.comandas.total + depois.receitas.mensalidades.total + depois.receitas.antecipados.total, "total de receitas bate com as partes");
    const dia = depois.serie.find((x) => x.dia === hoje)!;
    const diaAntes = antes.serie.find((x) => x.dia === hoje)!;
    ok(dia.receita - diaAntes.receita === 4000 && dia.despesa - diaAntes.despesa === 5000, "gráfico do dia com receita e despesa");
  } finally {
    const minhas = await db.despesa.findMany({ where: { descricao: { startsWith: TAG } } });
    await db.despesa.deleteMany({ where: { id: { in: minhas.map((d) => d.id) } } });
    await db.auditoria.deleteMany({ where: { entidade: "despesa", entidadeId: { in: minhas.map((d) => d.id) } } });
    await db.pagamentoComanda.deleteMany({ where: { comandaId: { in: comandas } } });
    await db.itemComanda.deleteMany({ where: { comandaId: { in: comandas } } });
    await db.comanda.deleteMany({ where: { id: { in: comandas } } });
    await db.caixa.deleteMany({ where: { id: { in: caixas } } });
    if (jaAberto) await db.caixa.update({ where: { id: jaAberto.id }, data: { status: "ABERTO", fechadoEm: null, observacao: null } });
  }
  console.log(process.exitCode ? "\nAlgum teste FALHOU." : "\nTodos os testes passaram.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
