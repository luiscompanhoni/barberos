import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { Sessao } from "@/lib/auth/sessao";
import { previaRetificacaoTeste, retificarTesteFolha } from "@/lib/rh/retificacao";
import { DECLARACAO_TESTE_FOLHA } from "@/lib/rh/retificacao-contrato";
import { fecharFolha, previaFolha, reabrirFolha } from "@/lib/rh/folha";
import { listarDespesas } from "@/lib/financeiro/despesas";
import { resultadoDoMes } from "@/lib/conciliacao/resultado";

const injecao = vi.hoisted(() => ({ competencia: "2250-01", falharAuditoria: false }));
vi.mock("@/lib/rh/vigencias", async () => ({
  ...await vi.importActual<typeof import("@/lib/rh/vigencias")>("@/lib/rh/vigencias"),
  competenciasRemuneracao: () => ({ atual: injecao.competencia, proxima: injecao.competencia }),
}));
vi.mock("@/lib/auditoria", async () => {
  const real = await vi.importActual<typeof import("@/lib/auditoria")>("@/lib/auditoria");
  return { ...real, auditar: async (...args: Parameters<typeof real.auditar>) => {
    if (injecao.falharAuditoria && args[2] === "rh_folha_retificar_teste") throw Error("Auditoria indisponível na fixture");
    return real.auditar(...args);
  } };
});
const ativo = process.env.TESTE_ESTABILIZACAO_FINANCEIRO_LOCAL === "1";
if (ativo) {
  const u = new URL(process.env.DATABASE_URL ?? "");
  if (u.hostname !== "127.0.0.1" || u.port !== "55439" || !u.pathname.startsWith("/barberos_ci_local_estabilizacao_")) throw Error("Exige banco financeiro local descartável.");
}
let s: Sessao, ano = 2250, indice = 0;
async function fixture() {
  const comp = `${ano + Math.floor(indice / 12)}-${String(indice++ % 12 + 1).padStart(2, "0")}`;
  injecao.competencia = comp;
  const tag = randomUUID(), pagoEm = new Date(`${comp}-03T15:00:00Z`);
  const pessoa = await db.checklistPessoa.create({ data: { nome: "Pessoa fictícia de teste interno", telefone: `retificar-${tag}`, token: tag, funcao: "GERENTE", salarioCentavos: 100 } });
  const despesa = await db.despesa.create({ data: { descricao: "Registro interno fictício", categoria: "FOLHA", valorCentavos: 100, vencimento: pagoEm, status: "PAGA", pagoEm, formaPagamento: "PIX", criadoPorId: s.usuarioId } });
  const folha = await db.folhaPagamento.create({ data: { competencia: comp, pessoaId: pessoa.id, salarioCentavos: 100, comissaoCentavos: 0, adicionaisCentavos: 0, descontosCentavos: 0, liquidoCentavos: 100, status: "PAGA", pagoEm, despesaId: despesa.id } });
  await db.auditoria.create({ data: { usuarioId: s.usuarioId, acao: "rh_folha_paga", entidade: "folha_pagamento", entidadeId: folha.id, dados: { forma: "PIX", despesaId: despesa.id, liquido: 100 } } });
  const previa = () => previaRetificacaoTeste(s, folha.id, 80000);
  const pedido = (revisao: string) => ({ folhaId: folha.id, revisao, idempotencia: randomUUID(), motivo: "Fixture exclusivamente interna sem transferência bancária ou saída de caixa.", salarioSubstitutivoCentavos: 80000, valorOriginalConfirmadoCentavos: 100 as const, declaracao: DECLARACAO_TESTE_FOLHA });
  return { comp, pessoa, despesa, folha, previa, pedido };
}
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
async function eventoDireto(f: Awaited<ReturnType<typeof fixture>>) {
  const p = await f.previa(), d = f.pedido(p.revisao);
  return { idempotencia: d.idempotencia, folhaOriginalId: f.folha.id, despesaOriginalId: f.despesa.id, atorId: s.usuarioId, atorSessaoVersao: 0,
    motivo: d.motivo, declaracao: d.declaracao, revisaoOrigem: p.revisao, hashPedido: "a".repeat(64), salarioSubstitutivoCentavos: d.salarioSubstitutivoCentavos,
    snapshotFolha: json(f.folha), snapshotDespesa: json(f.despesa) };
}

describe.skipIf(!ativo)("retificação de teste no PostgreSQL descartável", () => {
  beforeAll(async () => {
    vi.stubGlobal("fetch", async () => { throw Error("Rede externa bloqueada na retificação sintética"); });
    const u = await db.usuario.create({ data: { nome: "Dono fictício da retificação", telefone: `dono-retificar-${randomUUID()}`, papel: "DONO" } });
    s = { usuarioId: u.id, papel: "DONO", nome: u.nome, sessaoVersao: 0, barbeiroId: null, clienteId: null };
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    while (await db.folhaPagamento.count({ where: { competencia: { startsWith: `${ano}-` } } })) ano += 10;
  });
  afterAll(async () => { await db.$disconnect(); vi.unstubAllGlobals(); });

  it("preserva o original, anula somente o estado da despesa e registra prova e salário na mesma transação", async () => {
    const f = await fixture(), p = await f.previa();
    expect(p.podeRetificar).toBe(true);
    const r = await retificarTesteFolha(s, f.pedido(p.revisao));
    expect(await db.folhaPagamento.findUniqueOrThrow({ where: { id: f.folha.id } })).toEqual({ ...f.folha, ativa: false });
    expect(await db.despesa.findUniqueOrThrow({ where: { id: f.despesa.id } })).toEqual({ ...f.despesa, status: "ANULADA_TESTE" });
    const evento = await db.folhaRetificacaoTeste.findUniqueOrThrow({ where: { id: r.retificacaoId } });
    expect(evento.snapshotFolha).toEqual(json(f.folha)); expect(evento.snapshotDespesa).toEqual(json(f.despesa));
    expect(await db.auditoria.count({ where: { entidadeId: r.retificacaoId, acao: "rh_folha_retificar_teste" } })).toBe(1);
    expect(await db.remuneracaoVersao.count({ where: { escopo: `salario:${f.pessoa.id}`, competencia: f.comp } })).toBe(1);
    expect((await previaFolha(f.comp)).linhas.find(l => l.pessoaId === f.pessoa.id)).toMatchObject({ status: "ABERTA", salario: 80000, liquido: 80000 });
  });
  it("pedidos simultâneos da mesma chave têm um efeito, e repetição reaproveita a confirmação", async () => {
    const f = await fixture(), p = await f.previa(), d = f.pedido(p.revisao);
    const resultados = await Promise.allSettled([retificarTesteFolha(s, d), retificarTesteFolha(s, d)]);
    expect(resultados.some(r => r.status === "fulfilled")).toBe(true);
    for (const r of resultados) if (r.status === "rejected") expect(r.reason.status).toBe(409);
    expect((await retificarTesteFolha(s, d)).jaRegistrada).toBe(true);
    expect(await db.folhaRetificacaoTeste.count({ where: { folhaOriginalId: f.folha.id } })).toBe(1);
    const evento = await db.folhaRetificacaoTeste.findUniqueOrThrow({ where: { folhaOriginalId: f.folha.id } });
    expect(await db.auditoria.count({ where: { entidadeId: evento.id, acao: "rh_folha_retificar_teste" } })).toBe(1);
    await expect(retificarTesteFolha(s, { ...d, motivo: `${d.motivo} Outra decisão.` })).rejects.toMatchObject({ codigo: "retificacao_idempotencia" });
  });
  it("duas chaves disputando o mesmo original não criam duas retificações", async () => {
    const f = await fixture(), p = await f.previa();
    const resultados = await Promise.allSettled([retificarTesteFolha(s, f.pedido(p.revisao)), retificarTesteFolha(s, f.pedido(p.revisao))]);
    expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.folhaRetificacaoTeste.count({ where: { folhaOriginalId: f.folha.id } })).toBe(1);
    expect(await db.folhaPagamento.count({ where: { competencia: f.comp, pessoaId: f.pessoa.id, ativa: true } })).toBe(0);
  });
  it("sucessora usa versão dois sem deduzir o teste, pode ser reaberta e refechada uma única vez", async () => {
    const f = await fixture(), p = await f.previa(); await retificarTesteFolha(s, f.pedido(p.revisao));
    let previa = await previaFolha(f.comp); await fecharFolha(s, f.comp, f.pessoa.id, previa.revisao);
    const segunda = await db.folhaPagamento.findFirstOrThrow({ where: { competencia: f.comp, pessoaId: f.pessoa.id, ativa: true } });
    expect(segunda).toMatchObject({ versao: 2, substituiId: f.folha.id, salarioCentavos: 80000, liquidoCentavos: 80000, status: "FECHADA" });
    await reabrirFolha(s, f.comp, f.pessoa.id);
    previa = await previaFolha(f.comp); await fecharFolha(s, f.comp, f.pessoa.id, previa.revisao);
    expect(await db.folhaPagamento.count({ where: { competencia: f.comp, pessoaId: f.pessoa.id, ativa: true } })).toBe(1);
    expect(await db.folhaPagamento.findFirst({ where: { competencia: f.comp, pessoaId: f.pessoa.id, ativa: true } })).toMatchObject({ versao: 2, substituiId: f.folha.id });
    expect((await previaFolha(f.comp)).historicoRetificado).toContainEqual(expect.objectContaining({ folhaId: f.folha.id, versao: 1 }));
  });
  it("triggers preservam evento, original, despesa e auditoria inclusive diante de SQL direto", async () => {
    const f = await fixture(), p = await f.previa(), r = await retificarTesteFolha(s, f.pedido(p.revisao));
    await expect(db.folhaRetificacaoTeste.update({ where: { id: r.retificacaoId }, data: { motivo: "Tentativa fictícia de trocar motivo" } })).rejects.toThrow("Retificacao interna e imutavel");
    await expect(db.folhaRetificacaoTeste.delete({ where: { id: r.retificacaoId } })).rejects.toThrow("Retificacao interna e imutavel");
    await expect(db.$executeRaw`TRUNCATE folha_retificacoes_teste`).rejects.toThrow("Retificacao interna e imutavel");
    await expect(db.folhaPagamento.update({ where: { id: f.folha.id }, data: { ativa: true } })).rejects.toThrow("Folha retificada e historica");
    await expect(db.folhaPagamento.delete({ where: { id: f.folha.id } })).rejects.toThrow("Folha retificada e historica");
    await expect(db.despesa.update({ where: { id: f.despesa.id }, data: { status: "PENDENTE" } })).rejects.toThrow("Despesa anulada de teste e imutavel");
    await expect(db.despesa.delete({ where: { id: f.despesa.id } })).rejects.toThrow("Despesa anulada de teste e imutavel");
    await expect(db.auditoria.deleteMany({ where: { entidadeId: r.retificacaoId } })).rejects.toThrow();
    await expect(db.despesa.create({ data: { descricao: "Anulação fictícia sem original", categoria: "FOLHA", valorCentavos: 100, vencimento: new Date(), status: "ANULADA_TESTE" } })).rejects.toThrow("Despesa anulada exige original");
  });
  it("snapshot incompleto e evento isolado sem mudanças e auditoria são recusados no commit", async () => {
    const f = await fixture(), data = await eventoDireto(f);
    await expect(db.$transaction(tx => tx.folhaRetificacaoTeste.create({ data: { ...data, snapshotFolha: { id: f.folha.id } } }))).rejects.toThrow("Snapshots nao correspondem aos originais");
    await expect(db.$transaction(tx => tx.folhaRetificacaoTeste.create({ data }))).rejects.toThrow("Retificacao deve preservar original");
    expect(await db.folhaRetificacaoTeste.count({ where: { folhaOriginalId: f.folha.id } })).toBe(0);
    expect(await db.folhaPagamento.findUniqueOrThrow({ where: { id: f.folha.id } })).toEqual(f.folha);
    expect(await db.despesa.findUniqueOrThrow({ where: { id: f.despesa.id } })).toEqual(f.despesa);
  });
  it("falha da auditoria desfaz evento, salário, original, despesa e invalidação local", async () => {
    const f = await fixture();
    const lote = await db.folhaLotePix.create({ data: { competencia: f.comp, revisao: "f".repeat(64), totalCentavos: 100, snapshot: { envioHabilitado: false, itens: [] }, criadoPorId: s.usuarioId } });
    const p = await f.previa(); injecao.falharAuditoria = true;
    try { await expect(retificarTesteFolha(s, f.pedido(p.revisao))).rejects.toThrow("Auditoria indisponível na fixture"); }
    finally { injecao.falharAuditoria = false; }
    expect(await db.folhaRetificacaoTeste.count({ where: { folhaOriginalId: f.folha.id } })).toBe(0);
    expect(await db.folhaPagamento.findUniqueOrThrow({ where: { id: f.folha.id } })).toEqual(f.folha);
    expect(await db.despesa.findUniqueOrThrow({ where: { id: f.despesa.id } })).toEqual(f.despesa);
    expect(await db.folhaLotePix.findUniqueOrThrow({ where: { id: lote.id } })).toEqual(lote);
    expect(await db.remuneracaoVersao.count({ where: { escopo: `salario:${f.pessoa.id}` } })).toBe(0);
  });
  it("anulação permanece consultável e não entra nos totais de pagamentos ou custos", async () => {
    const f = await fixture(), p = await f.previa(); await retificarTesteFolha(s, f.pedido(p.revisao));
    const despesas = await listarDespesas(f.comp);
    expect(despesas.despesas.find(d => d.id === f.despesa.id)).toMatchObject({ status: "ANULADA_TESTE", valorCentavos: 100 });
    expect(despesas.totais.pagasNoMes).toBe(0); expect(despesas.totais.aPagar).toBe(0);
    expect((await resultadoDoMes(f.comp)).despesas.total).toBe(0);
  });
  it("qualquer vínculo de extrato, mesmo depois anulado, ou saída do caixa bloqueia a retificação", async () => {
    const f = await fixture();
    const movimento = await db.movimentoExterno.create({ data: { fonte: "STONE", idExterno: randomUUID(), data: f.folha.pagoEm!, valorCentavos: -100, tipo: "PAGAMENTO", forma: "PIX", descricao: "Movimento fictício" } });
    const vinculo = await db.vinculoDespesaExterna.create({ data: { movimentoId: movimento.id, despesaId: f.despesa.id, criadoPorId: s.usuarioId } });
    const previa = await f.previa(); expect(previa.podeRetificar).toBe(false);
    await expect(retificarTesteFolha(s, f.pedido(previa.revisao))).rejects.toMatchObject({ codigo: "retificacao_bloqueada" });
    await db.vinculoDespesaExterna.update({ where: { id: vinculo.id }, data: { anuladoEm: new Date(), anuladoPorId: s.usuarioId, motivoAnulacao: "Evidência fictícia preservada após revisão" } });
    expect((await f.previa()).podeRetificar).toBe(false);
    const g = await fixture();
    const caixa = await db.caixa.create({ data: { abertoPorId: s.usuarioId, fundoCentavos: 100 } });
    const saida = await db.movimentoCaixa.create({ data: { caixaId: caixa.id, usuarioId: s.usuarioId, tipo: "SANGRIA", valorCentavos: 100, motivo: "Fixture sem transação real" } });
    await db.despesa.update({ where: { id: g.despesa.id }, data: { movimentoCaixaId: saida.id } });
    const atual = await g.previa(); expect(atual.podeRetificar).toBe(false);
    await expect(retificarTesteFolha(s, g.pedido(atual.revisao))).rejects.toMatchObject({ codigo: "retificacao_bloqueada" });
  });
  it("lotes locais são invalidados; estado bancário ou snapshot desconhecido impede qualquer correção", async () => {
    const f = await fixture();
    const lote = await db.folhaLotePix.create({ data: { competencia: f.comp, revisao: "e".repeat(64), totalCentavos: 100, snapshot: { envioHabilitado: false, itens: [] }, criadoPorId: s.usuarioId } });
    const p = await f.previa(); await retificarTesteFolha(s, f.pedido(p.revisao));
    expect(await db.folhaLotePix.findUniqueOrThrow({ where: { id: lote.id } })).toMatchObject({ estado: "INVALIDADO" });
    for (const estado of ["PREPARADO", "ENVIADO", "PAGO", "INCERTO"] as const) {
      const g = await fixture();
      await db.folhaLotePix.create({ data: { competencia: g.comp, revisao: "d".repeat(64), totalCentavos: 100, estado, snapshot: estado === "PREPARADO" ? {} : { envioHabilitado: false, itens: [] }, criadoPorId: s.usuarioId } });
      const atual = await g.previa(); expect(atual.podeRetificar).toBe(false);
      await expect(retificarTesteFolha(s, g.pedido(atual.revisao))).rejects.toMatchObject({ codigo: "retificacao_bloqueada" });
      expect(await db.folhaRetificacaoTeste.count({ where: { folhaOriginalId: g.folha.id } })).toBe(0);
    }
  });
});
