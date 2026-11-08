import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { vincularDespesaExterna, anularVinculoDespesa, confirmarDespesasDistintas } from "@/lib/conciliacao/despesas-vinculos";
import { conferirExtratoMes, dadosConferenciaMes } from "@/lib/conciliacao/despesas-conferencia";
import { classificarMovimento, resultadoDoMes } from "@/lib/conciliacao/resultado";
import { taxas } from "@/lib/financeiro/conciliacao";
import { excluirDespesa } from "@/lib/financeiro/despesas";
import type { Sessao } from "@/lib/auth/sessao";

const habilitado = process.env.TESTE_ESTABILIZACAO_DESPESAS_LOCAL === "1";
if (habilitado) {
  const u = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(u.hostname) || u.port !== "55439" || !u.pathname.startsWith("/barberos_estabilizacao_despesas_")) throw Error("Exige banco PostgreSQL local descartável dedicado às despesas.");
}
const mes = "2026-10", data = new Date("2026-10-10T15:00Z");
describe.skipIf(!habilitado)("estabilização: conciliação auditável de despesas no banco descartável", () => {
  let dono: Sessao;
  beforeAll(async () => {
    vi.stubGlobal("fetch", async () => { throw Error("Rede externa proibida no teste de despesas"); });
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, botAtivo: false }, update: { botAtivo: false } });
    const u = await db.usuario.create({ data: { nome: "Dono fictício", telefone: `dono-despesas-${randomUUID()}`, papel: "DONO" } });
    dono = { usuarioId: u.id, papel: "DONO", nome: u.nome, barbeiroId: null, clienteId: null };
    await taxas();
  });
  afterAll(async () => { await db.$disconnect(); vi.unstubAllGlobals(); });
  async function fixture(valor = 23045) {
    const tag = randomUUID();
    const movimento = await db.movimentoExterno.create({ data: { fonte: "STONE", idExterno: tag, data, valorCentavos: -valor, tipo: "PAGAMENTO", forma: "PIX", descricao: `Fornecedor fictício ${tag}`, categoria: "FORNECEDOR" } });
    const despesa = await db.despesa.create({ data: { descricao: `Despesa fictícia ${tag}`, categoria: "FORNECEDOR", valorCentavos: valor, vencimento: new Date("2026-10-10"), status: "PAGA", pagoEm: data, formaPagamento: "PIX", criadoPorId: dono.usuarioId } });
    return { movimento, despesa, vincular: () => vincularDespesaExterna(dono, movimento.id, despesa.id, "Comprovante fictício conferido no banco local") };
  }
  const snapshot = () => db.$transaction(tx => dadosConferenciaMes(tx, mes));

  it("não deduplica pela coincidência de valores; vínculo explícito deduz uma única vez", async () => {
    const f = await fixture(31001), antes = await resultadoDoMes(mes);
    expect(antes.status).toBe("PREVIA");
    expect(antes.conciliacaoDespesas.possiveisDuplicatas.some(x => x.movimentoId === f.movimento.id && x.despesas.some(d => d.id === f.despesa.id))).toBe(true);
    const vinculo = await f.vincular(), repetido = await f.vincular();
    expect(repetido.id).toBe(vinculo.id);
    const depois = await resultadoDoMes(mes);
    expect(antes.despesas.total - depois.despesas.total).toBe(31001);
    expect(depois.conciliacaoDespesas.possiveisDuplicatas.some(x => x.movimentoId === f.movimento.id)).toBe(false);
    expect(await db.auditoria.count({ where: { entidadeId: vinculo.id, acao: "despesa_vincular_extrato" } })).toBe(1);
    expect((await db.movimentoExterno.findUniqueOrThrow({ where: { id: f.movimento.id } })).valorCentavos).toBe(-31001);
    expect((await db.despesa.findUniqueOrThrow({ where: { id: f.despesa.id } })).status).toBe("PAGA");
  });

  it("corrida por uma despesa e por um movimento permite apenas um vínculo ativo", async () => {
    const f = await fixture(31002), outro = await fixture(31002);
    const corrida = await Promise.allSettled([f.vincular(), vincularDespesaExterna(dono, outro.movimento.id, f.despesa.id, "Comprovante fictício")]);
    expect(corrida.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.vinculoDespesaExterna.count({ where: { despesaId: f.despesa.id, anuladoEm: null } })).toBe(1);
    const g = await fixture(31003), h = await fixture(31003);
    const disputa = await Promise.allSettled([g.vincular(), vincularDespesaExterna(dono, g.movimento.id, h.despesa.id, "Comprovante fictício")]);
    expect(disputa.filter(x => x.status === "fulfilled")).toHaveLength(1);
  });

  it("pagamentos diferentes de mesmo valor são revisados sem suprimir nenhum custo", async () => {
    const f = await fixture(31111), antes = await resultadoDoMes(mes);
    const decidir = () => confirmarDespesasDistintas(dono, f.movimento.id, f.despesa.id, "Dois comprovantes fictícios com referências diferentes");
    await decidir(); await decidir();
    expect(await db.auditoria.count({ where: { acao: "despesa_coincidencia_distinta", dados: { path: ["movimentoId"], equals: f.movimento.id } } })).toBe(1);
    const depois = await resultadoDoMes(mes);
    expect(depois.despesas.total).toBe(antes.despesas.total);
    expect(depois.conciliacaoDespesas.possiveisDuplicatas.some(x => x.movimentoId === f.movimento.id && x.despesas.some(d => d.id === f.despesa.id))).toBe(false);
    expect(depois.conciliacaoDespesas.coincidenciasDistintas).toBeGreaterThan(0);
    await db.movimentoExterno.update({ where: { id: f.movimento.id }, data: { observacao: "Comprovante revisado em teste" } });
    const revisado = await resultadoDoMes(mes);
    expect(revisado.conciliacaoDespesas.possiveisDuplicatas.some(x => x.movimentoId === f.movimento.id && x.despesas.some(d => d.id === f.despesa.id))).toBe(true);
    expect(await db.vinculoDespesaExterna.count({ where: { movimentoId: f.movimento.id } })).toBe(0);
  });

  it("nega valor ou status incompatíveis e usuário sem papel de dono", async () => {
    const f = await fixture(31004);
    await expect(vincularDespesaExterna({ ...dono, papel: "GERENTE" }, f.movimento.id, f.despesa.id, "Teste sintético")).rejects.toMatchObject({ status: 403 });
    await db.despesa.update({ where: { id: f.despesa.id }, data: { valorCentavos: 31005 } });
    await expect(f.vincular()).rejects.toMatchObject({ codigo: "despesa_divergente" });
    await db.despesa.update({ where: { id: f.despesa.id }, data: { valorCentavos: 31004, status: "PENDENTE" } });
    await expect(f.vincular()).rejects.toMatchObject({ codigo: "despesa_divergente" });
    expect(await db.vinculoDespesaExterna.count({ where: { movimentoId: f.movimento.id } })).toBe(0);
  });

  it("anula com razão, preserva o histórico e permite corrigir com novo vínculo", async () => {
    const f = await fixture(31006), original = await f.vincular();
    await anularVinculoDespesa(dono, original.id, "Vínculo fictício revisado");
    await anularVinculoDespesa(dono, original.id, "Repetição da anulação");
    const novo = await f.vincular();
    expect(novo.id).not.toBe(original.id);
    expect(await db.vinculoDespesaExterna.count({ where: { movimentoId: f.movimento.id } })).toBe(2);
    expect(await db.vinculoDespesaExterna.count({ where: { movimentoId: f.movimento.id, anuladoEm: null } })).toBe(1);
    expect(await db.auditoria.count({ where: { entidadeId: original.id, acao: "despesa_anular_vinculo" } })).toBe(1);
    await expect(db.vinculoDespesaExterna.delete({ where: { id: original.id } })).rejects.toThrow();
    await expect(db.vinculoDespesaExterna.update({ where: { id: novo.id }, data: { criadoPorId: "outro" } })).rejects.toThrow();
  });

  it("mudar despesa após vincular invalida a deduplicação e exige revisão", async () => {
    const f = await fixture(31007), v = await f.vincular();
    await db.despesa.update({ where: { id: f.despesa.id }, data: { status: "PENDENTE", pagoEm: null } });
    const resultado = await resultadoDoMes(mes);
    expect(resultado.conciliacaoDespesas.vinculos.find(x => x.id === v.id)?.valido).toBe(false);
    expect(resultado.status).toBe("PREVIA");
    expect(resultado.alertas.some(x => x.includes("vínculo(s)"))).toBe(true);
    await expect(classificarMovimento(dono, f.movimento.id, { tipo: "TRANSFERENCIA", categoria: null })).rejects.toMatchObject({ codigo: "despesa_vinculada" });
  });

  it("exclusão de despesa com histórico de vínculo devolve orientação e preserva o registro", async () => {
    const f = await fixture(31009), v = await f.vincular();
    await anularVinculoDespesa(dono, v.id, "Revisão de teste com histórico preservado");
    await db.despesa.update({ where: { id: f.despesa.id }, data: { status: "PENDENTE", pagoEm: null } });
    await expect(excluirDespesa(dono, f.despesa.id)).rejects.toMatchObject({ codigo: "despesa_conciliada", status: 409 });
    expect(await db.despesa.findUnique({ where: { id: f.despesa.id } })).not.toBeNull();
    expect(await db.vinculoDespesaExterna.count({ where: { despesaId: f.despesa.id } })).toBe(1);
  });

  it("cobertura exige hash atual e fica inválida após mudança de movimento ou despesa", async () => {
    const f = await fixture(31008), dados = await snapshot();
    const c = await conferirExtratoMes(dono, mes, "STONE", dados.porFonte.STONE.hashDados, "Extrato fictício completo de 1 a 31 de outubro");
    expect((await resultadoDoMes(mes)).conferencias.find(x => x.fonte === "STONE")?.conferida).toBe(true);
    await db.movimentoExterno.update({ where: { id: f.movimento.id }, data: { observacao: "Nova classificação em teste" } });
    expect((await resultadoDoMes(mes)).conferencias.find(x => x.fonte === "STONE")?.conferida).toBe(false);
    await expect(conferirExtratoMes(dono, mes, "STONE", dados.porFonte.STONE.hashDados, "Conferência desatualizada")).rejects.toMatchObject({ codigo: "conferencia_desatualizada" });
    const atual = await snapshot();
    await conferirExtratoMes(dono, mes, "STONE", atual.porFonte.STONE.hashDados, "Novo extrato fictício completo");
    await db.despesa.update({ where: { id: f.despesa.id }, data: { observacao: "Outra evidência fictícia" } });
    expect((await resultadoDoMes(mes)).conferencias.find(x => x.fonte === "STONE")?.conferida).toBe(false);
    await expect(db.conferenciaExtrato.delete({ where: { id: c.id } })).rejects.toThrow();
    await expect(db.conferenciaExtrato.update({ where: { id: c.id }, data: { hashDados: "0".repeat(64) } })).rejects.toThrow();
  });

  it("conferência de mês ainda aberto é recusada e não grava cobertura", async () => {
    const atual = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
    const d = await db.$transaction(tx => dadosConferenciaMes(tx, atual));
    await expect(conferirExtratoMes(dono, atual, "STONE", d.porFonte.STONE.hashDados, "Teste de mês em andamento")).rejects.toMatchObject({ codigo: "mes_em_andamento" });
    expect(await db.conferenciaExtrato.count({ where: { competencia: atual } })).toBe(0);
  });

  it("mês encerrado sem movimento exige cobertura explícita das duas fontes", async () => {
    let vazio = "2020-01";
    // O banco dedicado pode ser reutilizado; conferências antigas são imutáveis.
    while (await db.conferenciaExtrato.count({ where: { competencia: vazio } })) {
      const [ano, numero] = vazio.split("-").map(Number);
      vazio = numero === 12 ? `${ano + 1}-01` : `${ano}-${String(numero + 1).padStart(2, "0")}`;
    }
    expect((await resultadoDoMes(vazio)).status).toBe("PREVIA");
    const d = await db.$transaction(tx => dadosConferenciaMes(tx, vazio));
    for (const fonte of ["CELCASH", "STONE"] as const) await conferirExtratoMes(dono, vazio, fonte, d.porFonte[fonte].hashDados, "Extrato fictício completo, sem movimentação nessa competência");
    const r = await resultadoDoMes(vazio);
    expect(r.conferencias.every(x => x.conferida)).toBe(true);
    expect(r.status).toBe("CONFERIDO");
  });

  it("taxa real e estimativa da maquininha não somam no mesmo total", async () => {
    await db.movimentoExterno.create({ data: { fonte: "STONE", idExterno: randomUUID(), data, valorCentavos: -1001, tipo: "TAXA", descricao: "Taxa fictícia" } });
    await db.comanda.create({ data: { status: "FECHADA", fechadaEm: data, itens: { create: { descricao: "Avulso fictício", quantidade: 1, precoUnitCentavos: 100000 } }, pagamentos: { create: { forma: "CREDITO", valorCentavos: 100000, status: "PAGO", pagoEm: data } } } });
    const r = await resultadoDoMes(mes);
    expect(r.custos.maquininhaEstimada).toBeGreaterThan(0);
    expect(r.custos.total).toBe(r.celcash.custoGateway + r.stone.custoGateway);
    expect(r.custos.total).not.toBe(r.celcash.custoGateway + r.stone.custoGateway + r.custos.maquininhaEstimada);
    expect(r.status).toBe("PREVIA");
  });

  it("snapshot inclui pendência com vencimento @DATE no primeiro dia e invalida a cobertura ao mudar", async () => {
    const tag = randomUUID();
    const cliente = await db.cliente.create({ data: { nome: "Cliente fictício dia um", telefone: `dia-um-${tag}` } });
    const plano = await db.plano.create({ data: { nome: "Plano fictício dia um", precoCentavos: 10000 } });
    const assinatura = await db.assinatura.create({ data: { clienteId: cliente.id, planoId: plano.id, precoCentavos: 10000, formaPagamento: "PIX", origem: "PAINEL" } });
    const cobranca = await db.cobranca.create({ data: { assinaturaId: assinatura.id, gatewayId: `dia-um-${tag}`, valorCentavos: 10000, vencimento: new Date("2026-10-01T00:00:00Z"), status: "PAGA" } });
    const antes = await snapshot();
    expect(JSON.stringify(antes.porFonte.STONE.snapshot)).toContain(cobranca.id);
    await conferirExtratoMes(dono, mes, "STONE", antes.porFonte.STONE.hashDados, "Snapshot fictício incluindo pendência vencida no dia um");
    await db.cobranca.update({ where: { id: cobranca.id }, data: { valorCentavos: 10001 } });
    const depois = await snapshot();
    expect(depois.porFonte.STONE.hashDados).not.toBe(antes.porFonte.STONE.hashDados);
    expect((await resultadoDoMes(mes)).conferencias.find(x => x.fonte === "STONE")?.conferida).toBe(false);
  });
});
