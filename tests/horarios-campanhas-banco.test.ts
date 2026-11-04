import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { decidirSemana, solicitarSemana } from "@/lib/agenda/solicitacoes-horario";
import { solicitarPeriodo } from "@/lib/agenda/solicitacoes-periodo";
import { dataLocal, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { POST } from "@/app/api/campanhas-equipe/route";
import { adicionarServico } from "@/lib/comandas/adicional";
import { fecharAgenda } from "@/lib/agenda/expediente";
import { alterarAgendamento, alterarStatus } from "@/lib/agenda/agendamentos";
import { cancelarPeloCliente, confirmarPeloCliente } from "@/lib/agenda/cliente";
import { abrirComanda } from "@/lib/comandas/servico";

const auth = vi.hoisted(() => ({ sessao: null as unknown }));
vi.mock("@/lib/auth/sessao", async importOriginal => {
  const real = await importOriginal<typeof import("@/lib/auth/sessao")>();
  return { ...real, exigirSessao: async () => auth.sessao };
});

const habilitado = process.env.TESTE_HORARIO_CAMPANHA_LOCAL === "1";
if (habilitado) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "55439" || !url.pathname.startsWith("/barberos_camp_hora_integracao_")) throw new Error("Teste exige banco local descartável dedicado.");
}

describe.skipIf(!habilitado)("horários e campanhas no PostgreSQL descartável", () => {
  const tag = randomUUID();
  let donoId = "", barbeiroId = "", barbeiroUsuarioId = "", clienteId = "", servicoId = "";
  const dono = () => ({ usuarioId: donoId, papel: "DONO", nome: "Dono teste", barbeiroId: null, clienteId: null } as const);
  const barber = () => ({ usuarioId: barbeiroUsuarioId, papel: "BARBEIRO", nome: "Barbeiro teste", barbeiroId, clienteId: null } as const);

  beforeAll(async () => {
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, botAtivo: false }, update: { botAtivo: false } });
    donoId = (await db.usuario.create({ data: { nome: "Dono teste", telefone: `dono-${tag}`, papel: "DONO" } })).id;
    const user = await db.usuario.create({ data: { nome: "Barbeiro teste", telefone: `barbeiro-${tag}`, papel: "BARBEIRO" } }); barbeiroUsuarioId = user.id;
    barbeiroId = (await db.barbeiro.create({ data: { nome: "Barbeiro teste", usuarioId: user.id, expediente: { create: { diaSemana: 1, inicioMin: 540, fimMin: 1080 } } } })).id;
    clienteId = (await db.cliente.create({ data: { nome: "Cliente teste", telefone: `cliente-${tag}` } })).id;
    servicoId = (await db.servico.create({ data: { nome: "Corte teste", duracaoMin: 30, precoCentavos: 5000 } })).id;
    await db.barbeiroServico.create({ data: { barbeiroId, servicoId } });
    await db.checklistPessoa.create({ data: { nome: "Profissional teste", telefone: `pessoa-${tag}`, funcao: "BARBEIRO", token: tag, barbeiroId } });
  }, 30000);
  afterAll(async () => { await db.$disconnect(); });

  it("duas solicitações e duas decisões concorrentes têm um único vencedor", async () => {
    const proposta = [{ diaSemana: 1, inicioMin: 600, fimMin: 1080 }];
    const solicita = await Promise.allSettled([solicitarSemana(barbeiroId, proposta, barber()), solicitarSemana(barbeiroId, proposta, barber())]);
    expect(solicita.filter(x => x.status === "fulfilled")).toHaveLength(1);
    const pedido = await db.solicitacaoHorario.findFirstOrThrow({ where: { barbeiroId, status: "PENDENTE" } });
    const decide = await Promise.allSettled([decidirSemana(barbeiroId, pedido.id, "aprovar", undefined, dono()), decidirSemana(barbeiroId, pedido.id, "aprovar", undefined, dono())]);
    expect(decide.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditoria.count({ where: { entidadeId: pedido.id, acao: "aprovar_horario" } })).toBe(1);
    expect(await db.expedientePadrao.findMany({ where: { barbeiroId }, select: { diaSemana: true, inicioMin: true, fimMin: true } })).toEqual(proposta);
  }, 30000);

  it("folga com conflito não altera agendamento; depois aprova uma única vez", async () => {
    const data = somarDias(dataLocal(Date.now(), "America/Sao_Paulo"), 4);
    const inicio = new Date(instanteLocal(data, 780, "America/Sao_Paulo"));
    const ag = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio, fim: new Date(+inicio + 1800000), status: "MARCADO", origem: "PAINEL", precoCentavos: 5000 } });
    const pedido = await solicitarPeriodo(barbeiroId, "FOLGA", { data, inicioMin: 0, fimMin: 1440, motivo: "Teste" }, barber());
    expect(pedido.conflitos.map(x => x.id)).toContain(ag.id);
    await expect(decidirSemana(barbeiroId, pedido.id, "aprovar", undefined, dono())).rejects.toMatchObject({ codigo: "conflitos_pendentes" });
    expect((await db.agendamento.findUniqueOrThrow({ where: { id: ag.id } })).status).toBe("MARCADO");
    expect(await db.bloqueio.count({ where: { barbeiroId } })).toBe(0);
    await db.agendamento.update({ where: { id: ag.id }, data: { status: "CANCELADO" } });
    const decide = await Promise.allSettled([decidirSemana(barbeiroId, pedido.id, "aprovar", undefined, dono()), decidirSemana(barbeiroId, pedido.id, "aprovar", undefined, dono())]);
    expect(decide.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.bloqueio.count({ where: { barbeiroId } })).toBe(1);
  }, 30000);

  it("adicional de comanda e aprovação de bloqueio simultâneos não coexistem no mesmo horário", async () => {
    const data = somarDias(dataLocal(Date.now(), "America/Sao_Paulo"), 8);
    const inicio = new Date(instanteLocal(data, 810, "America/Sao_Paulo"));
    const ag = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio, fim: new Date(+inicio + 1800000), status: "MARCADO", origem: "PAINEL", precoCentavos: 5000 } });
    const comanda = await db.comanda.create({ data: { clienteId, itens: { create: { agendamentoId: ag.id, descricao: "Corte", quantidade: 1, precoUnitCentavos: 5000, barbeiroId } } } });
    const pedido = await solicitarPeriodo(barbeiroId, "BLOQUEIO", { data, inicioMin: 840, fimMin: 870, motivo: "Teste" }, barber());
    const resultados = await Promise.allSettled([decidirSemana(barbeiroId, pedido.id, "aprovar", undefined, dono()), adicionarServico(dono(), comanda.id, servicoId, barbeiroId)]);
    expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const adicional = await db.agendamento.count({ where: { adicionalDeId: ag.id } });
    const bloqueio = await db.bloqueio.count({ where: { barbeiroId, inicio: new Date(instanteLocal(data, 840, "America/Sao_Paulo")) } });
    expect(adicional + bloqueio).toBe(1);
    expect((await db.agendamento.findUniqueOrThrow({ where: { id: ag.id } })).status).toBe("MARCADO");
  }, 30000);

  it("fechamento que atinge um grupo não transfere nem cancela nenhum serviço", async () => {
    const data = somarDias(dataLocal(Date.now(), "America/Sao_Paulo"), 12);
    const inicio = new Date(instanteLocal(data, 600, "America/Sao_Paulo"));
    const pai = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio, fim: new Date(+inicio + 1800000), status: "MARCADO", origem: "PAINEL", precoCentavos: 5000 } });
    const filho = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio: pai.fim, fim: new Date(+pai.fim + 1800000), status: "MARCADO", origem: "PAINEL", precoCentavos: 5000, adicionalDeId: pai.id } });
    await expect(fecharAgenda(barbeiroId, { inicio, fim: new Date(+inicio + 3600000), confirmar: true, resolucoes: [{ agendamentoId: pai.id, acao: "cancelar" }, { agendamentoId: filho.id, acao: "cancelar" }] }, dono())).rejects.toMatchObject({ codigo: "grupo_nao_suportado", status: 409 });
    const ambos = await db.agendamento.findMany({ where: { id: { in: [pai.id, filho.id] } }, select: { status: true } });
    expect(ambos).toHaveLength(2); expect(ambos.every(a => a.status === "MARCADO")).toBe(true);
  }, 30000);

  it("filho SITE não sofre alteração isolada e cancelado não volta ao mudar status do pai", async () => {
    const data = somarDias(dataLocal(Date.now(), "America/Sao_Paulo"), 16);
    const inicio = new Date(instanteLocal(data, 600, "America/Sao_Paulo"));
    const pai = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio, fim: new Date(+inicio + 3600000), status: "MARCADO", origem: "SITE", precoCentavos: 5000 } });
    const filho = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio: new Date(+inicio + 1800000), fim: new Date(+inicio + 3600000), status: "MARCADO", origem: "SITE", precoCentavos: 5000, adicionalDeId: pai.id } });
    await expect(alterarAgendamento(filho.id, { inicio: new Date(+inicio + 7200000) }, dono())).rejects.toMatchObject({ codigo: "alteracao_multiplos" });
    await expect(alterarStatus(filho.id, "CONCLUIDO", dono())).rejects.toMatchObject({ codigo: "alteracao_multiplos" });
    await db.agendamento.update({ where: { id: filho.id }, data: { status: "CANCELADO" } });
    await alterarStatus(pai.id, "CONFIRMADO", dono());
    expect((await db.agendamento.findUniqueOrThrow({ where: { id: filho.id } })).status).toBe("CANCELADO");
  }, 30000);

  it("confirmação e cancelamento concorrentes preservam o mesmo estado do grupo", async () => {
    const data = somarDias(dataLocal(Date.now(), "America/Sao_Paulo"), 20);
    const inicio = new Date(instanteLocal(data, 600, "America/Sao_Paulo"));
    const pai = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio, fim: new Date(+inicio + 3600000), status: "MARCADO", origem: "SITE", precoCentavos: 5000 } });
    const filho = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio: new Date(+inicio + 1800000), fim: new Date(+inicio + 3600000), status: "MARCADO", origem: "SITE", precoCentavos: 5000, adicionalDeId: pai.id } });
    await Promise.allSettled([confirmarPeloCliente(clienteId, pai.id), cancelarPeloCliente(clienteId, pai.id)]);
    const p = await db.agendamento.findUniqueOrThrow({ where: { id: pai.id } }), f = await db.agendamento.findUniqueOrThrow({ where: { id: filho.id } });
    expect(["CONFIRMADO", "CANCELADO"]).toContain(p.status); expect(f.status).toBe(p.status);
  }, 30000);

  it("abrir comanda e cancelar grupo em paralelo não geram comanda com serviços cancelados", async () => {
    const data = somarDias(dataLocal(Date.now(), "America/Sao_Paulo"), 24);
    const inicio = new Date(instanteLocal(data, 600, "America/Sao_Paulo"));
    const pai = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio, fim: new Date(+inicio + 3600000), status: "MARCADO", origem: "SITE", precoCentavos: 5000 } });
    const filho = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio: new Date(+inicio + 1800000), fim: new Date(+inicio + 3600000), status: "MARCADO", origem: "SITE", precoCentavos: 5000, adicionalDeId: pai.id } });
    const resultados = await Promise.allSettled([abrirComanda(dono(), { agendamentoId: pai.id }), cancelarPeloCliente(clienteId, pai.id)]);
    expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const p = await db.agendamento.findUniqueOrThrow({ where: { id: pai.id } }), f = await db.agendamento.findUniqueOrThrow({ where: { id: filho.id } });
    const itens = await db.itemComanda.count({ where: { agendamentoId: { in: [pai.id, filho.id] } } });
    expect(f.status).toBe(p.status);
    if (p.status === "CANCELADO") expect(itens).toBe(0); else { expect(p.status).toBe("MARCADO"); expect(itens).toBe(2); }
  }, 30000);

  it("equipe não cancela grupo que já possui itens na comanda", async () => {
    const data = somarDias(dataLocal(Date.now(), "America/Sao_Paulo"), 27);
    const inicio = new Date(instanteLocal(data, 600, "America/Sao_Paulo"));
    const pai = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio, fim: new Date(+inicio + 3600000), status: "MARCADO", origem: "SITE", precoCentavos: 5000 } });
    const filho = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio: new Date(+inicio + 1800000), fim: new Date(+inicio + 3600000), status: "MARCADO", origem: "SITE", precoCentavos: 5000, adicionalDeId: pai.id } });
    await abrirComanda(dono(), { agendamentoId: pai.id });
    await expect(alterarStatus(pai.id, "CANCELADO", dono())).rejects.toMatchObject({ codigo: "comanda_existente", status: 409 });
    const ambos = await db.agendamento.findMany({ where: { id: { in: [pai.id, filho.id] } }, select: { status: true } });
    expect(ambos.every(a => a.status === "MARCADO")).toBe(true);
    expect(await db.itemComanda.count({ where: { agendamentoId: { in: [pai.id, filho.id] } } })).toBe(2);
  }, 30000);

  it("abrir comanda e cancelamento pela equipe em paralelo preservam o grupo", async () => {
    const data = somarDias(dataLocal(Date.now(), "America/Sao_Paulo"), 28);
    const inicio = new Date(instanteLocal(data, 600, "America/Sao_Paulo"));
    const pai = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio, fim: new Date(+inicio + 3600000), status: "MARCADO", origem: "SITE", precoCentavos: 5000 } });
    const filho = await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio: new Date(+inicio + 1800000), fim: new Date(+inicio + 3600000), status: "MARCADO", origem: "SITE", precoCentavos: 5000, adicionalDeId: pai.id } });
    const resultados = await Promise.allSettled([abrirComanda(dono(), { agendamentoId: pai.id }), alterarStatus(pai.id, "CANCELADO", dono())]);
    expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const p = await db.agendamento.findUniqueOrThrow({ where: { id: pai.id } }), f = await db.agendamento.findUniqueOrThrow({ where: { id: filho.id } });
    const itens = await db.itemComanda.count({ where: { agendamentoId: { in: [pai.id, filho.id] } } });
    expect(f.status).toBe(p.status);
    if (p.status === "CANCELADO") expect(itens).toBe(0); else { expect(p.status).toBe("MARCADO"); expect(itens).toBe(2); }
  }, 30000);

  it("giros de serviço permanecem bloqueados enquanto estornos não são conciliados", async () => {
    const inicio = new Date(Date.now() - 3600000);
    await db.agendamento.create({ data: { barbeiroId, clienteId, servicoId, inicio, fim: new Date(+inicio + 1800000), status: "CONCLUIDO", origem: "PAINEL", precoCentavos: 0 } });
    const campanha = await db.campanhaEquipe.create({ data: { nome: "Campanha teste", tipo: "SERVICOS", servicoIds: [servicoId], inicio: new Date(Date.now() - 86400000), fim: new Date(Date.now() + 86400000), metaQuantidade: 1, metaCentavos: 0, premios: [500], criadoPorId: donoId } });
    auth.sessao = barber();
    const request = () => new Request("http://localhost/api/campanhas-equipe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "girar", campanhaId: campanha.id }) });
    const respostas = await Promise.all([POST(request()), POST(request())]);
    expect(respostas.map(r => r.status).sort()).toEqual([409, 409]);
    const bonus = await db.bonusEquipe.findMany({ where: { campanhaId: campanha.id } });
    expect(bonus).toHaveLength(0);
  }, 30000);

  it("dois giros de produto concorrentes pela mesma meta geram apenas um bônus", async () => {
    const produto = await db.produto.create({ data: { nome: `Produto ${tag}`, categoria: "LOJA", precoCentavos: 5000 } });
    await db.comanda.create({ data: { clienteId, status: "FECHADA", fechadaEm: new Date(), itens: { create: { produtoId: produto.id, descricao: "Produto", quantidade: 1, precoUnitCentavos: 5000, barbeiroId } }, pagamentos: { create: { forma: "DINHEIRO", valorCentavos: 5000, status: "PAGO" } } } });
    const campanha = await db.campanhaEquipe.create({ data: { nome: "Produtos teste", inicio: new Date(Date.now() - 86400000), fim: new Date(Date.now() + 86400000), metaQuantidade: 1, metaCentavos: 0, premios: [500], criadoPorId: donoId } });
    auth.sessao = barber();
    const request = () => new Request("http://localhost/api/campanhas-equipe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "girar", campanhaId: campanha.id }) });
    const respostas = await Promise.all([POST(request()), POST(request())]);
    expect(respostas.map(r => r.status).sort()).toEqual([200, 422]);
    const bonus = await db.bonusEquipe.findMany({ where: { campanhaId: campanha.id } });
    expect(bonus).toHaveLength(1);
    expect(await db.folhaLancamento.count({ where: { id: bonus[0].folhaLancamentoId!, tipo: "BONUS" } })).toBe(1);
  }, 30000);
});
