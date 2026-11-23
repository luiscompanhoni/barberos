import { randomInt, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarAgendamento } from "@/lib/agenda/agendamentos";
import { precificar } from "@/lib/assinaturas/agenda";
import { assinar, cancelar, situacaoDoCliente } from "@/lib/assinaturas/servico";
import { db } from "@/lib/db";
import { indicadoresDeAssinaturas } from "@/lib/indicadores/assinaturas-bar";
import { resolverPeriodo } from "@/lib/indicadores/periodo";
import { consultarContratoDezembro, consultarOfertaPublicaDezembro, consultarPainelDezembro } from "@/lib/oferta-dezembro/consulta";
import { dadosDoPeriodo } from "@/lib/reunioes/dados";
import { carregarMeuDia } from "@/lib/reunioes/meu-dia";
import { relatorioComissoes } from "@/lib/rh/comissoes";
import { encerrarOfertasDezembroAgendadas, solicitarCancelamentoDezembro } from "@/lib/oferta-dezembro/cancelamento";
import { aderirOfertaDezembro } from "@/lib/oferta-dezembro/servico";
import { TERMO_DEZEMBRO } from "@/lib/oferta-dezembro/regras";
import { CARTAO_DEZEMBRO_APROVADO, CARTAO_DEZEMBRO_RECUSADO } from "@/lib/oferta-dezembro/schemas";

const habilitado = process.env.TESTE_OFERTA_DEZEMBRO_LOCAL === "1";
if (habilitado) {
  const banco = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(banco.hostname) || !banco.pathname.includes("teste")) {
    throw new Error("Use um PostgreSQL de testes local e descartável.");
  }
}
const agora = new Date("2026-11-22T18:00:00-03:00");
const telefone = () => `55479${randomInt(10_000_000, 99_999_999)}`;

async function titular() {
  const tel = telefone();
  const u = await db.usuario.create({
    data: {
      nome: "Cliente fictício da oferta", papel: "CLIENTE", telefone: tel,
      cliente: { create: { nome: "Cliente fictício da oferta", telefone: tel, aceitaMensagens: false } },
    },
    include: { cliente: true },
  });
  return { usuarioId: u.id, clienteId: u.cliente!.id, sessaoVersao: u.sessaoVersao };
}

async function plano({ vagasPlano = 4, vagasCampanha = 4 } = {}) {
  const servicos = await Promise.all(["Corte teste", "Barba teste"].map(nome =>
    db.servico.create({ data: { nome, duracaoMin: 20, precoCentavos: 4500 } })));
  const p = await db.plano.create({
    data: {
      nome: "Plano teste Dezembro", precoCentavos: 10001, vagas: vagasPlano, maxAgendamentosAbertos: 5, descontoExtrasPct: 100,
      servicos: { create: servicos.map(({ id }) => ({ servicoId: id })) },
    },
  });
  const existentes = await db.ofertaDezembroAdesao.count();
  vi.stubEnv("OFERTA_DEZEMBRO_PLANO_ID", p.id);
  vi.stubEnv("OFERTA_DEZEMBRO_VAGAS", String(existentes + vagasCampanha));
  return { ...p, servicos, existentes };
}

async function profissional(servicos: { id: string }[]) {
  return db.barbeiro.create({
    data: {
      nome: "Barbeiro fictício", usuario: { create: { nome: "Barbeiro fictício", papel: "BARBEIRO", telefone: telefone() } },
      servicos: { create: servicos.map(({ id }) => ({ servicoId: id })) },
      expediente: { create: { diaSemana: 5, inicioMin: 9 * 60, fimMin: 20 * 60 } },
    },
  });
}

const proposta = (planoId: string) => ({
  chave: randomUUID(), planoId, precoCentavos: 10001, limiteUsos: 1,
  termosVersao: TERMO_DEZEMBRO, forma: "CARTAO", aceitaTermos: true, cartaoToken: CARTAO_DEZEMBRO_APROVADO,
} satisfies Parameters<typeof aderirOfertaDezembro>[1]);

describe.skipIf(!habilitado)("oferta de dezembro com PostgreSQL", () => {
  beforeEach(async () => {
    vi.stubEnv("AMBIENTE", "homologacao");
    vi.stubEnv("OFERTA_DEZEMBRO_MODO", "homologacao");
    vi.stubEnv("OFERTA_DEZEMBRO_LIMITE_USOS", "1");
    vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true");
    vi.stubEnv("PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS", "true");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(agora);
    await db.configuracao.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  afterAll(() => db.$disconnect());

  it("concede só a última vaga com dois clientes em simultâneo e mantém o resultado na repetição", async () => {
    const p = await plano({ vagasCampanha: 1 });
    const titulares = await Promise.all([titular(), titular()]);
    // Quem usa a mesma chave em cadastros diferentes disputa a vaga normalmente.
    const pedido = proposta(p.id);
    const resultados = await Promise.allSettled(titulares.map(t => aderirOfertaDezembro(t, pedido, agora)));
    const ganhou = resultados.findIndex(r => r.status === "fulfilled");
    expect(ganhou).toBeGreaterThanOrEqual(0);
    expect(resultados[1 - ganhou]).toMatchObject({ status: "rejected", reason: { codigo: "sem_vagas" } });
    const r = resultados[ganhou];
    if (r.status !== "fulfilled") throw r.reason;
    expect(await aderirOfertaDezembro(titulares[ganhou], pedido, agora)).toEqual({ ...r.value, repetida: true });
    expect(await db.ofertaDezembroAdesao.count()).toBe(p.existentes + 1);
    expect(await db.cobranca.count({ where: { assinaturaId: r.value.assinaturaId } })).toBe(0);
  });

  it("serializa duas abas e a adesão pela trilha regular para o mesmo titular", async () => {
    const p = await plano();
    const t = await titular();
    const resultados = await Promise.allSettled([
      aderirOfertaDezembro(t, proposta(p.id), agora),
      aderirOfertaDezembro(t, proposta(p.id), agora),
      assinar({ ...t, titular: t, planoId: p.id, forma: "CARTAO", origem: "SITE", cpf: "52998224725" }),
    ]);
    expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.assinatura.count({ where: { clienteId: t.clienteId, status: { not: "CANCELADA" } } })).toBe(1);
  });

  it("recusa cartão simulado e respeita a lotação do plano-base", async () => {
    const p = await plano({ vagasPlano: 1 });
    const [cliente, outro] = await Promise.all([titular(), titular()]);
    const pedido = proposta(p.id);
    await expect(aderirOfertaDezembro(cliente, { ...pedido, cartaoToken: CARTAO_DEZEMBRO_RECUSADO }, agora)).rejects.toMatchObject({ codigo: "cartao_recusado" });
    expect(await db.ofertaDezembroAdesao.count()).toBe(p.existentes);
    await assinar({ ...outro, titular: outro, planoId: p.id, forma: "CARTAO", origem: "SITE", cpf: "52998224725" });
    await expect(aderirOfertaDezembro(cliente, pedido, agora)).rejects.toMatchObject({ codigo: "sem_vagas" });
  });

  it.each([{ vendaSomenteEquipe: true }, { visivel: false }])("oculta a oferta e bloqueia a adesão para plano %j", async (restricao) => {
    const p = await plano();
    const t = await titular();
    await db.plano.update({ where: { id: p.id }, data: restricao });
    expect(await consultarOfertaPublicaDezembro(agora)).toBeNull();
    await expect(aderirOfertaDezembro(t, proposta(p.id), agora)).rejects.toMatchObject({ codigo: "oferta_indisponivel" });
    expect(await db.ofertaDezembroAdesao.count()).toBe(p.existentes);
  });

  it("serializa a última vaga do plano-base entre contratação regular e oferta", async () => {
    const p = await plano({ vagasPlano: 1 });
    const [oferta, regular] = await Promise.all([titular(), titular()]);
    const resultados = await Promise.allSettled([
      aderirOfertaDezembro(oferta, proposta(p.id), agora),
      assinar({ ...regular, titular: regular, planoId: p.id, forma: "CARTAO", origem: "SITE", cpf: "52998224725" }),
    ]);
    expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.find(r => r.status === "rejected")).toMatchObject({ reason: { codigo: "sem_vagas" } });
    expect(await db.assinatura.count({ where: { planoId: p.id } })).toBe(1);
  });

  it("preserva a vaga de link regular antigo que ainda pode ser pago", async () => {
    const p = await plano({ vagasPlano: 1 });
    const [regular, oferta] = await Promise.all([titular(), titular()]);
    const a = await assinar({ ...regular, titular: regular, planoId: p.id, forma: "CARTAO", origem: "SITE", cpf: "52998224725" });
    await db.assinatura.update({
      where: { id: a.assinatura.id },
      data: { criadaEm: new Date(+agora - 4 * 86_400_000) },
    });
    await expect(aderirOfertaDezembro(oferta, proposta(p.id), agora)).rejects.toMatchObject({ codigo: "sem_vagas" });
  });

  it("bloqueia a reentrada imediata e aceita um ex-assinante após 90 dias", async () => {
    const p = await plano();
    const t = await titular();
    const canceladaEm = new Date(+agora - 90 * 86_400_000);
    const anterior = await db.assinatura.create({
      data: {
        clienteId: t.clienteId, planoId: p.id, status: "CANCELADA", formaPagamento: "CARTAO",
        origem: "PAINEL", precoCentavos: 10001, canceladaEm, criadaEm: new Date("2026-08-01T12:00:00-03:00"),
      },
    });
    await expect(aderirOfertaDezembro(t, proposta(p.id), agora)).rejects.toMatchObject({ codigo: "cancelamento_recente" });
    await db.assinatura.update({ where: { id: anterior.id }, data: { canceladaEm: new Date(+canceladaEm - 1) } });
    await expect(aderirOfertaDezembro(t, proposta(p.id), agora)).resolves.toMatchObject({ repetida: false });
  });

  it("compartilha o teto entre os itens de uma reserva e reprifica a reserva após o cancelamento", async () => {
    const p = await plano();
    const t = await titular();
    const { assinaturaId } = await aderirOfertaDezembro(t, proposta(p.id), agora);
    const barbeiro = await profissional(p.servicos);
    const entrada = {
      cliente: { id: t.clienteId }, titular: t, barbeiroId: barbeiro.id, servicoId: p.servicos[0].id,
      servicosAdicionais: [p.servicos[1].id], inicio: new Date("2026-12-04T15:00:00-03:00"), origem: "SITE" as const,
    };
    await expect(criarAgendamento(entrada, null)).rejects.toMatchObject({ detalhes: { codigoRegra: "limite_oferta" } });
    expect(await db.agendamento.count({ where: { clienteId: t.clienteId } })).toBe(0);
    const principal = await criarAgendamento({ ...entrada, forcarAvulso: true, precoEsperadoCentavos: 4500 }, null);
    expect(principal.assinaturaId).toBe(assinaturaId);
    const extra = await db.agendamento.findFirstOrThrow({ where: { adicionalDeId: principal.id } });
    expect(extra).toMatchObject({ precoCentavos: 4500, assinaturaId: null });
    await expect(cancelar(assinaturaId, "trilha regular", null)).rejects.toMatchObject({ codigo: "oferta_dezembro_contrato" });
    await expect(solicitarCancelamentoDezembro(t, "agora", agora)).resolves.toMatchObject({ status: "CANCELADA", multaSimuladaCentavos: 0 });
    expect(await db.agendamento.findUniqueOrThrow({ where: { id: principal.id } })).toMatchObject({ precoCentavos: 4500, assinaturaId: null });
    expect(await db.ofertaDezembroAdesao.count()).toBe(p.existentes + 1);
  });

  it("fecha novas vendas e preserva os contratos da homologação com a chave desligada", async () => {
    const p = await plano();
    const [t, outro] = await Promise.all([titular(), titular()]);
    const propostaAceita = proposta(p.id);
    const { assinaturaId } = await aderirOfertaDezembro(t, propostaAceita, agora);
    const barbeiro = await profissional(p.servicos);
    const inicio = new Date("2026-12-04T15:00:00-03:00");
    const entrada = {
      clienteId: t.clienteId, servicoId: p.servicos[0].id, barbeiroId: barbeiro.id,
      inicio: +inicio, precoBase: 4500, fuso: "America/Sao_Paulo",
    };
    vi.setSystemTime(inicio);
    vi.stubEnv("OFERTA_DEZEMBRO_MODO", "");
    expect(await consultarOfertaPublicaDezembro(inicio)).toBeNull();
    await expect(aderirOfertaDezembro(outro, proposta(p.id), inicio)).rejects.toMatchObject({ codigo: "oferta_indisponivel" });
    await expect(aderirOfertaDezembro(t, propostaAceita, inicio)).resolves.toEqual({ assinaturaId, repetida: true });
    expect(await consultarContratoDezembro(t.clienteId, inicio)).toMatchObject({ status: "ATIVA" });
    expect(await consultarPainelDezembro()).toMatchObject({ usadas: p.existentes + 1, recebendoAdesoes: false });
    expect(await situacaoDoCliente(t.clienteId)).toMatchObject({ valida: true });
    expect(await precificar(entrada)).toMatchObject({ assinaturaId, precoCentavos: 0 });

    await expect(solicitarCancelamentoDezembro({ ...outro, clienteId: t.clienteId }, "agora", inicio)).rejects.toMatchObject({ codigo: "sessao_invalida" });
    await expect(solicitarCancelamentoDezembro(t, "fim_fidelidade", inicio)).resolves.toMatchObject({ multaSimuladaCentavos: 0 });
    const fim = new Date("2027-07-01T03:00:00Z");
    vi.stubEnv("AMBIENTE", "producao");
    expect(await consultarContratoDezembro(t.clienteId, inicio)).toBeNull();
    expect(await precificar(entrada)).toMatchObject({ assinaturaId: null, precoCentavos: 4500 });
    await expect(solicitarCancelamentoDezembro(t, "agora", inicio)).rejects.toMatchObject({ status: 404 });
    expect(await encerrarOfertasDezembroAgendadas(fim)).toBe(0);
    vi.stubEnv("AMBIENTE", "homologacao");
    await encerrarOfertasDezembroAgendadas(fim);
    expect(await consultarContratoDezembro(t.clienteId, fim)).toMatchObject({ status: "CANCELADA" });
  });

  it("exclui contrato e atendimento simulados dos indicadores reais e dos créditos de comissão", async () => {
    const p = await plano();
    const t = await titular();
    const barbeiro = await profissional(p.servicos);
    const inicio = new Date("2026-12-04T15:00:00-03:00");
    const periodo = resolverPeriodo("mes", "America/Sao_Paulo", +inicio);
    const antes = await indicadoresDeAssinaturas(periodo);
    const { assinaturaId } = await aderirOfertaDezembro(t, proposta(p.id), agora);
    const atendimento = await db.agendamento.create({
      data: {
        assinaturaId, barbeiroId: barbeiro.id, clienteId: t.clienteId, servicoId: p.servicos[0].id, inicio,
        fim: new Date(+inicio + 20 * 60_000), origem: "SITE", precoCentavos: 0, status: "CONCLUIDO",
      },
    });
    expect.soft(await indicadoresDeAssinaturas(periodo)).toEqual(antes);
    await db.comissaoServico.create({
      data: { servicoId: atendimento.servicoId, avulsoTipo: "PERCENTUAL", avulsoValor: 4000, planoTipo: "FIXO", planoValor: 1500 },
    });
    const reuniao = await dadosDoPeriodo("2026-12-04", "2026-12-04");
    expect.soft(reuniao.barbeiros.find(b => b.id === barbeiro.id)).toMatchObject({
      atendimentos: 1, receitaAssinaturasCentavos: 0, comissaoCentavos: 0, custosPendentes: 0, margemCentavos: 0,
    });
    const meuDia = await carregarMeuDia({
      usuarioId: barbeiro.usuarioId, papel: "BARBEIRO", nome: barbeiro.nome, barbeiroId: barbeiro.id, clienteId: null,
    }, { data: "2026-12-04" });
    expect.soft(meuDia.atendimentos).toMatchObject([{ id: atendimento.id, receitaCentavos: 0, comissaoCentavos: null }]);
    expect.soft(meuDia.resumo).toMatchObject({ servicos: 1, comissaoPlanoCentavos: 0, planoPendente: false, semRegra: 0 });
    const fimDaSimulacao = Symbol("reverter regras da fixture");
    await expect(db.$transaction(async tx => {
      await tx.poteConfig.upsert({ where: { id: "pote" }, create: { id: "pote", ativo: true }, update: { ativo: true } });
      await tx.poteFicha.create({ data: { servicoId: p.servicos[0].id, fichas: 42 } });
      const relatorio = await relatorioComissoes("2026-12-04", "2026-12-04", barbeiro.id, tx);
      expect(relatorio.assinaturas?.creditosTotal).toBe(0);
      expect(relatorio.barbeiros).toEqual([]);
      throw fimDaSimulacao;
    })).rejects.toBe(fimDaSimulacao);
  });

  it("mantém a opção ao fim da fidelidade e encerra apenas no dia combinado", async () => {
    const p = await plano();
    const t = await titular();
    const { assinaturaId } = await aderirOfertaDezembro(t, proposta(p.id), agora);
    const pedido = await solicitarCancelamentoDezembro(t, "fim_fidelidade", agora);
    expect(pedido).toMatchObject({ status: "ATIVA", encerraEm: new Date("2027-07-01"), multaSimuladaCentavos: 0 });
    expect(await encerrarOfertasDezembroAgendadas(new Date("2027-07-01T02:59:59.999Z"))).toBe(0);
    await encerrarOfertasDezembroAgendadas(new Date("2027-07-01T03:00:00Z"));
    expect(await db.assinatura.findUniqueOrThrow({ where: { id: assinaturaId } })).toMatchObject({ status: "CANCELADA" });
    expect(await db.cobranca.count({ where: { assinaturaId } })).toBe(0);
  });
});
