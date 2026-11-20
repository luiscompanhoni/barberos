import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listarCampanhas } from "@/lib/campanhas/servico";
import { funilCampanha } from "@/lib/campanhas/funil";
import { indicadoresDeAssinaturas, indicadoresDoBar } from "@/lib/indicadores/assinaturas-bar";
import { resolverPeriodo } from "@/lib/indicadores/periodo";
import { resultadoDoMes } from "@/lib/conciliacao/resultado";
import { conferirExtratoMes } from "@/lib/conciliacao/despesas-conferencia";
import { PATCH } from "@/app/api/configuracao/route";

const dono = { usuarioId: "dono", papel: "DONO", nome: "Dono", clienteId: null, barbeiroId: null } as const;
vi.mock("@/lib/auth/sessao", async original => ({ ...await original<typeof import("@/lib/auth/sessao")>(), exigirSessao: async () => dono }));
const habilitado = process.env.TESTE_GESTAO_LOCAL === "1";
if (habilitado) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.startsWith("/gestao_t3_")) throw Error("Exige banco local vazio e dedicado à gestão.");
}
const dia = (n: number) => new Date(Date.UTC(2020, 5, n, 12));
const periodo = resolverPeriodo("mes", "America/Sao_Paulo", +dia(29));

describe.skipIf(!habilitado)("gestão em PostgreSQL descartável", () => {
  beforeAll(async () => {
    await db.usuario.create({ data: { id: dono.usuarioId, nome: "Dono", telefone: "teste-dono", papel: "DONO" } });
    await db.barbeiro.create({ data: { id: "bar", nome: "Barbeiro", usuarioId: dono.usuarioId } });
    await db.servico.create({ data: { id: "corte", nome: "Corte", precoCentavos: 5000, duracaoMin: 30 } });
    await db.cliente.create({ data: { id: "cliente", nome: "Cliente", telefone: "teste-cliente" } });
    await db.configuracao.create({ data: { id: 1 } });
  });
  afterAll(async () => { await db.$disconnect(); });
  function reserva(criadoEm: Date, inicio: Date, assinaturaId?: string) {
    return db.agendamento.create({ data: { clienteId: "cliente", criadoEm, inicio, fim: new Date(+inicio + 1800000),
      origem: "PAINEL", servicoId: "corte", barbeiroId: "bar", precoCentavos: 5000, status: "CONCLUIDO", assinaturaId } });
  }

  it("atribui reserva e receita uma vez, conserva clique e mostra o aceite atual", async () => {
    const conversa = await db.conversa.create({ data: { telefone: "teste-cliente", clienteId: "cliente" } });
    for (const [id, data] of [["A", 1], ["B", 4], ["Z", 4], ["F", 5], ["interrompido", 5]] as const) {
      const mensagem = await db.mensagem.create({ data: { conversaId: conversa.id, texto: "teste", autor: "SISTEMA", criadoEm: dia(data) } });
      await db.campanha.create({ data: { id, nome: id, segmentos: [], mensagem: "teste", limiteDiario: 1, envios: { create: {
        id, lote: 1, clienteId: "cliente", enviadoEm: dia(data), status: id === "F" ? "FALHOU" : id === "Z" ? "PULADO" : "ENVIADO",
        mensagemId: id === "interrompido" ? null : mensagem.id, clicouEm: id === "A" ? dia(2) : null,
      } } } });
    }
    const primeira = await reserva(dia(5), dia(9));
    const segunda = await reserva(dia(6), dia(10));
    const comanda = await db.comanda.create({ data: { status: "FECHADA", fechadaEm: dia(11), itens: {
      create: { descricao: "Corte", precoUnitCentavos: 12000, agendamentoId: primeira.id },
    }, pagamentos: { create: { forma: "DINHEIRO", valorCentavos: 12000, estornadoCentavos: 2000, status: "PAGO" } } } });
    async function metricas(id: string) {
      const f = await funilCampanha(id);
      return [f.etapas.find(e => e.chave === "agendaram")?.qtd, f.comandas, f.faturadoCentavos, f.etapas.find(e => e.chave === "clicaram")?.qtd];
    }
    expect(await metricas("A")).toEqual([0, 0, 0, 1]);
    expect(await metricas("B")).toEqual([1, 1, 10000, 0]);
    const antes = await listarCampanhas();
    expect(antes.find(c => c.id === "A")?.marcaram).toBe(0);
    expect(antes.find(c => c.id === "B")?.marcaram).toBe(1);
    // O mesmo cliente marcou antes de B. A também tem conversão, mas não recebe a mesma comanda.
    const antiga = await reserva(dia(3), dia(11));
    await db.itemComanda.create({ data: { comandaId: comanda.id, descricao: "Adicional incluído", precoUnitCentavos: 0, agendamentoId: antiga.id } });
    await db.campanhaEnvio.update({ where: { id: "Z" }, data: { status: "ENVIADO" } });
    expect(await metricas("A")).toEqual([1, 0, 0, 1]);
    expect(await metricas("Z")).toEqual([1, 1, 10000, 0]);
    for (const id of ["B", "F", "interrompido"]) expect(await metricas(id)).toEqual([0, 0, 0, 0]);
    await db.campanhaEnvio.update({ where: { id: "Z" }, data: { status: "PULADO" } });
    expect(await metricas("B")).toEqual([1, 1, 10000, 0]);
    // B reservou a fila no dia 4, mas seu canal só respondeu após as duas reservas.
    const b = await db.campanhaEnvio.findUniqueOrThrow({ where: { id: "B" } });
    await db.mensagem.update({ where: { id: b.mensagemId! }, data: { criadoEm: dia(7) } });
    const usuario = await db.usuario.create({ data: { nome: "Cliente", telefone: "usuario-teste", papel: "CLIENTE", criadoEm: dia(6) } });
    await db.cliente.update({ where: { id: "cliente" }, data: { usuarioId: usuario.id } });
    const antesDoEnvio = await funilCampanha("B");
    expect(antesDoEnvio.etapas.find(e => e.chave === "conta")).toMatchObject({ qtd: 1, detalhe: "0 criada(s) depois da mensagem" });
    expect((await listarCampanhas(+dia(4))).find(c => c.id === "B")).toMatchObject({ enviados: 1, enviadosHoje: 0 });
    expect((await listarCampanhas(+dia(7))).find(c => c.id === "B")).toMatchObject({ enviados: 1, enviadosHoje: 1 });
    expect((await listarCampanhas(+dia(5))).find(c => c.id === "interrompido")).toMatchObject({ enviados: 0, enviadosHoje: 0, marcaram: 0 });
    expect((await funilCampanha("interrompido")).etapas.find(e => e.chave === "enviadas")).toMatchObject({ qtd: 0, doTotal: null });
    expect(await metricas("B")).toEqual([0, 0, 0, 0]);
    expect(await metricas("A")).toEqual([1, 1, 10000, 1]);
    expect((await listarCampanhas()).find(c => c.id === "B")?.marcaram).toBe(0);
    await db.mensagem.update({ where: { id: b.mensagemId! }, data: { criadoEm: dia(4) } });
    expect((await funilCampanha("B")).etapas.find(e => e.chave === "conta")).toMatchObject({ qtd: 1, detalhe: "1 criada(s) depois da mensagem" });
    const lista = await listarCampanhas();
    expect(lista.find(c => c.id === "B")?.marcaram).toBe(1);
    for (const aceitaMensagens of [false, true]) {
      await db.cliente.update({ where: { id: "cliente" }, data: { aceitaMensagens } });
      const campanhas = (await listarCampanhas()).filter(c => ["A", "B"].includes(c.id));
      expect(campanhas.map(c => c.pararam)).toEqual([+!aceitaMensagens, +!aceitaMensagens]);
    }
    await db.agendamento.update({ where: { id: primeira.id }, data: { criadoEm: new Date(+dia(18) + 1) } });
    await db.agendamento.update({ where: { id: segunda.id }, data: { criadoEm: dia(4) } });
    expect(await metricas("B")).toEqual([0, 0, 0, 0]);
    await db.agendamento.update({ where: { id: primeira.id }, data: { criadoEm: dia(18) } });
    expect(await metricas("B")).toEqual([1, 1, 10000, 0]);
    // A comanda também tem um atendimento de outro cliente e outro envio mais recente.
    const outro = await db.cliente.create({ data: { nome: "Outro", telefone: "teste-outro" } });
    const conversaOutro = await db.conversa.create({ data: { clienteId: outro.id, telefone: outro.telefone } });
    const recebida = await db.mensagem.create({ data: { conversaId: conversaOutro.id, texto: "teste", autor: "SISTEMA", criadoEm: dia(8) } });
    await db.campanha.create({ data: { id: "outra", nome: "Outra", segmentos: [], mensagem: "teste", limiteDiario: 1,
      envios: { create: { lote: 1, clienteId: outro.id, enviadoEm: dia(8), status: "ENVIADO", mensagemId: recebida.id } } } });
    const adicional = await reserva(dia(9), dia(23));
    await db.agendamento.update({ where: { id: adicional.id }, data: { clienteId: outro.id } });
    await db.itemComanda.create({ data: { comandaId: comanda.id, descricao: "Incluído", precoUnitCentavos: 0, agendamentoId: adicional.id } });
    expect(await metricas("B")).toEqual([1, 0, 0, 0]);
    expect(await metricas("outra")).toEqual([1, 1, 10000, 0]);

    // Um clique histórico persiste, mas não aumenta o denominador da campanha.
    await db.campanhaEnvio.create({ data: { campanhaId: "B", clienteId: outro.id, lote: 1, status: "ENVIADO", enviadoEm: dia(4), clicouEm: dia(5) } });
    expect((await listarCampanhas(+dia(4))).find(c => c.id === "B")).toMatchObject({ enviados: 1, enviadosHoje: 1, marcaram: 1 });
    const misto = await funilCampanha("B");
    expect(misto.etapas.find(e => e.chave === "enviadas")).toMatchObject({ qtd: 1 });
    expect(misto.etapas.find(e => e.chave === "agendaram")).toMatchObject({ qtd: 1, doTotal: 1 });
    expect(misto.etapas.find(e => e.chave === "clicaram")).toMatchObject({ qtd: 1, doTotal: null });
    // Venda de R$ 60 com nota de R$ 100, seguida de estorno de R$ 10.
    await db.itemComanda.update({ where: { agendamentoId: primeira.id }, data: { precoUnitCentavos: 6000 } });
    await db.pagamentoComanda.updateMany({ where: { comandaId: comanda.id }, data: { valorCentavos: 10000, estornadoCentavos: 0 } });
    expect(await funilCampanha("outra")).toMatchObject({ faturadoCentavos: 6000, ticketMedioCentavos: 6000, comandas: 1 });
    await db.pagamentoComanda.updateMany({ where: { comandaId: comanda.id }, data: { estornadoCentavos: 1000, estornadoEm: dia(24) } });
    expect(await funilCampanha("outra")).toMatchObject({ faturadoCentavos: 5000, ticketMedioCentavos: 5000, comandas: 1 });
    expect(await metricas("B")).toEqual([1, 0, 0, 1]);
  });

  it("conta contratos ativos sem uso e identifica margem recalculada pelo custo atual", async () => {
    const plano = await db.plano.create({ data: { nome: "Plano", precoCentavos: 5000 } });
    for (const status of ["ATIVA", "CANCELADA"] as const) {
      const a = await db.assinatura.create({ data: { clienteId: "cliente", planoId: plano.id, formaPagamento: "PIX", precoCentavos: 5000, origem: "PAINEL", status } });
      if (status === "CANCELADA") await reserva(dia(20), dia(21), a.id);
    }
    expect((await indicadoresDeAssinaturas(periodo)).assinantesSemUso).toBe(1);
    const produto = await db.produto.create({ data: { nome: "Produto", categoria: "BAR", custoCentavos: 400 } });
    await db.comanda.create({ data: { status: "FECHADA", fechadaEm: dia(22), itens: { create: { produtoId: produto.id, descricao: "Produto", precoUnitCentavos: 1000 } } } });
    expect((await indicadoresDoBar(periodo, 1)).margemBrutaPct).toBe(0.6);
    await db.produto.update({ where: { id: produto.id }, data: { custoCentavos: 700 } });
    expect(await indicadoresDoBar(periodo, 1)).toMatchObject({ margemBrutaPct: 0.3, baseDaMargem: "Custo de reposição atual", topProdutos: [{ margemPct: 0.3 }] });
  });

  it("audita duas escritas concorrentes pela ordem da linha bloqueada", async () => {
    const patch = (granularidadeMin: number) => PATCH(new Request("http://localhost/api/configuracao", { method: "PATCH", body: JSON.stringify({ granularidadeMin }) }));
    async function aguardarBloqueios(quantidade: number) {
      await vi.waitFor(async () => {
        const [r] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%configuracao%'`;
        expect(r.n).toBeGreaterThanOrEqual(quantidade);
      }, { timeout: 3000, interval: 15 });
    }
    const requisicoes: Promise<Response>[] = [];
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM configuracao WHERE id = 1 FOR UPDATE`;
      requisicoes.push(patch(10));
      await aguardarBloqueios(1);
      requisicoes.push(patch(15));
      await aguardarBloqueios(2);
    });
    expect((await Promise.all(requisicoes)).map(r => r.status)).toEqual([200, 200]);
    const historico = await db.auditoria.findMany({ where: { acao: "configurar" }, orderBy: { criadoEm: "asc" } });
    expect(historico.map(r => r.dados)).toEqual([
      { antes: { granularidadeMin: 15 }, depois: { granularidadeMin: 10 } },
      { antes: { granularidadeMin: 10 }, depois: { granularidadeMin: 15 } },
    ]);
    expect((await db.configuracao.findUniqueOrThrow({ where: { id: 1 } })).granularidadeMin).toBe(15);
  });

  it("confere cobertura sem vendas e mantém prévia com venda presencial sem vínculo, mesmo após tarifa observada", async () => {
    const mes = "2020-03", data = new Date("2020-03-08T12:00Z");
    async function conferir() {
      const r = await resultadoDoMes(mes);
      for (const c of r.conferencias) await conferirExtratoMes(dono, mes, c.fonte, c.hashDados, "Extrato sintético completo");
    }
    expect((await resultadoDoMes(mes)).status).toBe("PREVIA");
    await conferir();
    expect((await resultadoDoMes(mes)).status).toBe("CONFERIDO");
    await db.comanda.create({ data: { status: "FECHADA", fechadaEm: data, itens: { create: { descricao: "Venda", precoUnitCentavos: 10000 } },
      pagamentos: { create: { forma: "PIX", status: "PAGO", pagoEm: data, valorCentavos: 10000 } } } });
    await db.movimentoExterno.createMany({ data: [
      { fonte: "STONE", idExterno: "deposito", data, valorCentavos: 10000, tipo: "RECEBIMENTO", forma: "PIX", descricao: "Recebimento" },
      { fonte: "STONE", idExterno: "tarifa", data, valorCentavos: -150, tipo: "TAXA", descricao: "Tarifa" },
    ] });
    await conferir();
    const r = await resultadoDoMes(mes);
    expect(r.conferencias.every(c => c.conferida)).toBe(true);
    expect(r.custos).toMatchObject({ total: 150, maquininhaEstimada: 0 });
    expect(r.status).toBe("PREVIA");
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0]).toContain("créditos de liquidação");
  });
});
