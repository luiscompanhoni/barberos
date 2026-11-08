import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { responderAvaliacao } from "@/lib/avaliacoes/respostas";
import { resumoAvaliacaoBarbeiro, resumoPublicado } from "@/lib/avaliacoes/resumos";

/** Complemento chamado exclusivamente pelo fluxo guardado de qualidade, com dados fictícios. */
export async function testarLotesEntreMeses(donoId: string, servicoId: string, sufixo: string) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.pathname, "/barberos_test_qualidade");
  assert(["localhost", "127.0.0.1"].includes(url.hostname));
  async function criarBarbeiro(nome: string) {
    const u = await db.usuario.create({ data: { nome, telefone: `teste-barbeiro-lote-${randomUUID()}`, papel: "BARBEIRO" } });
    return db.barbeiro.create({ data: { nome, usuarioId: u.id } });
  }
  const barbeiro = await criarBarbeiro(`Lotes entre meses ${sufixo}`);
  const pessoa = await db.checklistPessoa.create({ data: { nome: "Profissional fictício", telefone: `teste-lotes-${sufixo}`, funcao: "BARBEIRO", token: randomUUID(), barbeiroId: barbeiro.id } });
  const ponto = await db.checklistPonto.create({ data: { pessoaId: pessoa.id, pontos: 10, descricao: "Pontos aprovados antes do novo lote" } });
  const regra = await db.desempenhoRegra.upsert({ where: { competenciaInicio: "2026-10" }, create: { competenciaInicio: "2026-10", config: {}, criadoPorId: donoId }, update: {} });
  const lancamento = await db.folhaLancamento.create({ data: { pessoaId: pessoa.id, competencia: "2026-10", tipo: "BONUS", valorCentavos: 1234, descricao: "Bônus histórico fictício", porId: donoId } });
  const bonus = await db.desempenhoBonus.create({ data: {
    pessoaId: pessoa.id, competencia: "2026-10", regraId: regra.id, valorCentavos: 1234, porId: donoId,
    folhaLancamentoId: lancamento.id, checklistPontoId: ponto.id,
    snapshot: { clientes: { media: null, quantidade: 0, periodo: "2026-10" }, resultado: { pontos: 10, bonusCentavos: 1234 } },
  } });
  const folha = await db.folhaPagamento.create({ data: { pessoaId: pessoa.id, competencia: "2026-10", salarioCentavos: 0, comissaoCentavos: 0, adicionaisCentavos: 1234, descontosCentavos: 0, liquidoCentavos: 1234 } });
  let numero = 0;
  async function convite(barbeiroId: string, data: string, publicada = false) {
    const instante = new Date(data), n = ++numero;
    const c = await db.cliente.create({ data: { nome: `Cliente lote ${n}`, telefone: `teste-lote-${sufixo}-${n}`, aceitaMensagens: false } });
    const a = await db.agendamento.create({ data: {
      clienteId: c.id, barbeiroId, servicoId, status: "CONCLUIDO", origem: "RECEPCAO", precoCentavos: 1000,
      inicio: new Date(+instante - 60 * 60_000), fim: new Date(+instante - 30 * 60_000),
    } });
    const i = await db.conviteAvaliacao.create({ data: { clienteId: c.id, barbeiroId, agendamentoId: a.id, expiraEm: new Date("2026-12-31T23:00:00Z") } });
    if (publicada) await db.avaliacaoCliente.create({ data: { conviteId: i.id, nota: 5, criadoEm: instante, publicada: true } });
    return { c, i, instante };
  }
  const datas = ["2026-10-20", "2026-10-21", "2026-11-01", "2026-11-02", "2026-11-03"];
  for (const data of datas.slice(0, 4)) {
    const x = await convite(barbeiro.id, `${data}T15:00:00Z`);
    await responderAvaliacao(x.c.id, { conviteId: x.i.id, nota: 5 }, x.instante);
    assert.equal((await resumoPublicado(barbeiro.id)).quantidade, 0, "Quatro notas em dois meses permanecem privadas");
  }
  const quinta = await convite(barbeiro.id, `${datas[4]}T15:00:00Z`);
  const concorrentes = await Promise.all(Array.from({ length: 4 }, () => responderAvaliacao(quinta.c.id, { conviteId: quinta.i.id, nota: 5 }, quinta.instante)));
  assert.equal(concorrentes.filter(r => !r.repetida).length, 1);
  assert.equal((await resumoPublicado(barbeiro.id)).quantidade, 5);
  assert.deepEqual(await resumoAvaliacaoBarbeiro(barbeiro.id, "2026-11"), { quantidade: 5, media: 5, periodo: "2026-11" });
  assert.equal((await resumoAvaliacaoBarbeiro(barbeiro.id, "2026-10")).quantidade, 0, "Não atribui nota individual ao mês anterior");
  assert.equal(await db.avaliacaoCliente.count({ where: { convite: { barbeiroId: barbeiro.id }, publicada: true } }), 5);
  assert.deepEqual(await db.desempenhoBonus.findUniqueOrThrow({ where: { id: bonus.id } }), bonus, "Não recalcula bônus aprovado");
  assert.deepEqual(await db.folhaPagamento.findUniqueOrThrow({ where: { id: folha.id } }), folha, "Não reabre folha fechada");
  assert.deepEqual(await db.checklistPonto.findUniqueOrThrow({ where: { id: ponto.id } }), ponto, "Não redistribui pontos históricos");
  assert.equal(await db.folhaLancamento.count({ where: { pessoaId: pessoa.id } }), 1, "Publicar nota não cria lançamento financeiro");

  const legado = await criarBarbeiro(`Legado publicado ${sufixo}`);
  for (let n = 0; n < 5; n++) await convite(legado.id, `2026-${n < 2 ? "09" : "10"}-${String(20 + n).padStart(2, "0")}T15:00:00Z`, true);
  await db.avaliacaoResumo.create({ data: { barbeiroId: legado.id, quantidade: 5, soma: 25, categorias: {}, periodos: {} } });
  for (let n = 0; n < 5; n++) {
    const x = await convite(legado.id, `2026-11-${String(n + 1).padStart(2, "0")}T15:00:00Z`);
    await responderAvaliacao(x.c.id, { conviteId: x.i.id, nota: 5 }, x.instante);
  }
  assert.equal((await resumoPublicado(legado.id)).quantidade, 10);
  assert.deepEqual((await db.avaliacaoResumo.findUniqueOrThrow({ where: { barbeiroId: legado.id } })).periodos, { "2026-11": { quantidade: 5, soma: 25 } }, "Legado sem competência não é reclassificado retroativamente");
}
