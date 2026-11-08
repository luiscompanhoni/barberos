import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { adicionarServico } from "@/lib/comandas/adicional";
import { abrirComanda, alterarItem, cancelarComanda, fecharComanda } from "@/lib/comandas/servico";
import { alterarAgendamento, alterarStatus, criarAgendamento } from "@/lib/agenda/agendamentos";
import { carregarDia } from "@/lib/agenda/carregar";
import { agendaDoPeriodo, horariosDisponiveis } from "@/lib/agenda/consultas";
import { instanteLocal, dataLocal, diaSemana, somarDias } from "@/lib/agenda/tempo";
import { candidatoEntrevista, criarConviteEntrevista } from "@/lib/recrutamento/entrevistas";
import { tokenEntrevista } from "@/lib/recrutamento/entrevistas-token";
import { fecharAgenda, removerExcecao, salvarExcecao } from "@/lib/agenda/expediente";
import type { Sessao } from "@/lib/auth/sessao";

vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));
vi.mock("@/lib/whatsapp/avisos", () => ({ avisarMudanca: vi.fn() }));
vi.mock("@/lib/links/servico", () => ({ cancelarLinksDaComanda: vi.fn() }));
const habilitado = process.env.TESTE_ESTABILIZACAO_AGENDA_LOCAL === "1";
if (habilitado) {
  const u = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(u.hostname) || u.port !== "55439" || !u.pathname.startsWith("/barberos_estabilizacao_agenda_")) throw Error("Exige banco PostgreSQL local descartável dedicado à agenda.");
}
const FUSO = "America/Sao_Paulo";
let segunda = somarDias(dataLocal(Date.now(), FUSO), 7);
while (diaSemana(segunda) !== 1) segunda = somarDias(segunda, 1);
const horario = (minutos: number) => new Date(instanteLocal(segunda, minutos, FUSO));

describe.skipIf(!habilitado)("estabilização: agenda, adicionais e entrevistas no PostgreSQL descartável", () => {
  beforeAll(async () => {
    vi.stubEnv("SESSION_SECRET", "estabilizacao-local-sem-integracao-20261108-chave");
    vi.stubGlobal("fetch", async () => { throw Error("Rede externa proibida neste teste local"); });
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    await db.configuracao.update({ where: { id: 1 }, data: { botAtivo: false, cashbackAtivo: false, intervaloEntreClientes: 0, antecedenciaMinimaMin: 0, janelaAgendamentoDias: 60 } });
  });
  afterAll(async () => { await db.$disconnect(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  async function fixture(precoCentavos = 5000, usuarioDono = false) {
    const tag = randomUUID();
    const u = await db.usuario.create({ data: { nome: "Dono fictício", telefone: `dono-${tag}`, papel: "DONO" } });
    const profissional = usuarioDono ? u : await db.usuario.create({ data: { nome: "Profissional fictício", telefone: `profissional-${tag}`, papel: "BARBEIRO" } });
    const segundoUsuario = await db.usuario.create({ data: { nome: "Outro profissional fictício", telefone: `segundo-profissional-${tag}`, papel: "BARBEIRO" } });
    const cadeira = await db.cadeira.create({ data: { nome: `Cadeira fictícia ${tag}` } });
    const barbeiro = await db.barbeiro.create({ data: { nome: "Barbeiro fictício", usuarioId: profissional.id, cadeiraId: cadeira.id, expediente: { create: { diaSemana: 1, inicioMin: 540, fimMin: 1080 } } } });
    const outro = await db.barbeiro.create({ data: { nome: "Outro fictício", usuarioId: segundoUsuario.id, expediente: { create: { diaSemana: 1, inicioMin: 540, fimMin: 1080 } } } });
    const cliente = await db.cliente.create({ data: { nome: "Cliente fictício", telefone: `cliente-${tag}` } });
    const terceiro = await db.cliente.create({ data: { nome: "Outro cliente fictício", telefone: `outro-cliente-${tag}` } });
    const servico = await db.servico.create({ data: { nome: "Serviço fictício", duracaoMin: 30, minimoDuracaoMin: 10, precoCentavos } });
    await db.barbeiroServico.createMany({ data: [barbeiro.id, outro.id].map(barbeiroId => ({ barbeiroId, servicoId: servico.id })) });
    const principal = await db.agendamento.create({ data: { barbeiroId: barbeiro.id, cadeiraId: cadeira.id, clienteId: cliente.id, servicoId: servico.id, inicio: horario(600), fim: horario(630), origem: "RECEPCAO", precoCentavos } });
    const comanda = await db.comanda.create({ data: { clienteId: cliente.id, abertaPorId: u.id, itens: { create: { agendamentoId: principal.id, descricao: "Principal fictício", quantidade: 1, precoUnitCentavos: precoCentavos, barbeiroId: barbeiro.id } } } });
    const dono: Sessao = { usuarioId: u.id, papel: "DONO", nome: u.nome, barbeiroId: usuarioDono ? barbeiro.id : null, clienteId: null };
    const reservar = (barbeiroId: string, clienteId: string, inicio = horario(630), cadeiraId?: string) => criarAgendamento({ barbeiroId, cliente: { id: clienteId }, servicoId: servico.id, inicio, origem: "RECEPCAO", ...(cadeiraId ? { cadeiraId } : {}) }, dono);
    return { dono, barbeiro, outro, cadeira, cliente, terceiro, servico, principal, comanda, reservar, adicionar: () => adicionarServico(dono, comanda.id, servico.id, barbeiro.id) };
  }

  it("reserva profissional, cliente e cadeira; aparece separadamente sem duplicar o total do principal", async () => {
    const f = await fixture(), adicional = await f.adicionar();
    expect(adicional).toMatchObject({ ocupaAgenda: true, status: "MARCADO", cadeiraId: f.cadeira.id, adicionalDeId: f.principal.id });
    expect(+adicional.inicio).toBe(+f.principal.fim);
    await expect(f.reservar(f.barbeiro.id, f.terceiro.id)).rejects.toMatchObject({ status: 409 });
    await expect(f.reservar(f.outro.id, f.cliente.id)).rejects.toMatchObject({ codigo: "choque_cliente" });
    await expect(f.reservar(f.outro.id, f.terceiro.id, adicional.inicio, f.cadeira.id)).rejects.toMatchObject({ codigo: "conflito_cadeira" });
    const tela = await agendaDoPeriodo(segunda, 1, f.barbeiro.id);
    expect(tela.agendamentos.find(a => a.id === f.principal.id)?.totalServicosCentavos).toBe(5000);
    expect(tela.agendamentos.find(a => a.id === adicional.id)).toMatchObject({ ocupaAgenda: true, totalServicosCentavos: 5000 });
    const [opcoes] = await horariosDisponiveis({ data: segunda, servicoId: f.servico.id, barbeiroId: f.barbeiro.id, paraCliente: false });
    expect(opcoes.horarios).not.toContain(adicional.inicio.toISOString());
  });

  it("dois adicionais simultâneos são sequenciais e ficam pendentes até sua própria conclusão", async () => {
    const f = await fixture();
    const [a, b] = (await Promise.all([f.adicionar(), f.adicionar()])).sort((x, y) => +x.inicio - +y.inicio);
    expect(+a.fim).toBe(+b.inicio); expect(a.status).toBe("MARCADO"); expect(b.status).toBe("MARCADO");
    await alterarStatus(f.principal.id, "CONCLUIDO", f.dono);
    expect((await db.agendamento.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("MARCADO");
    await expect(fecharComanda(f.dono, f.comanda.id)).rejects.toMatchObject({ codigo: "adicional_pendente" });
    await expect(alterarAgendamento(f.principal.id, { inicio: horario(660) }, f.dono)).rejects.toMatchObject({ status: 422 });
  });

  it("cancelar comanda libera reserva e reconfirmar principal não ressuscita adicional nem cria cobrança", async () => {
    const f = await fixture(), a = await f.adicionar();
    await cancelarComanda(f.dono, f.comanda.id, "Teste de cancelamento local");
    await cancelarComanda(f.dono, f.comanda.id, "Repetição idempotente");
    expect((await db.agendamento.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CANCELADO");
    await alterarStatus(f.principal.id, "CONFIRMADO", f.dono);
    expect((await db.agendamento.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CANCELADO");
    await expect(alterarStatus(a.id, "CONFIRMADO", f.dono)).rejects.toMatchObject({ codigo: "adicional_cancelado" });
    await expect(abrirComanda(f.dono, { agendamentoId: f.principal.id })).rejects.toMatchObject({ codigo: "comanda_cancelada" });
    expect(await db.pagamentoComanda.count({ where: { comandaId: f.comanda.id } })).toBe(0);
    expect(await db.itemComanda.count({ where: { agendamentoId: f.principal.id } })).toBe(1);
    expect(await db.auditoria.count({ where: { entidadeId: f.comanda.id, acao: "cancelar" } })).toBe(1);
    await expect(f.reservar(f.barbeiro.id, f.terceiro.id)).resolves.toBeTruthy();
  });

  it("remover adicional pendente cancela a reserva, mas não permite remover o principal antes dele", async () => {
    const f = await fixture(), a = await f.adicionar();
    const principal = await db.itemComanda.findUniqueOrThrow({ where: { agendamentoId: f.principal.id } });
    await expect(alterarItem(f.dono, principal.id, 0)).rejects.toMatchObject({ codigo: "adicional_reservado" });
    const item = await db.itemComanda.findUniqueOrThrow({ where: { agendamentoId: a.id } });
    await alterarItem(f.dono, item.id, 0);
    expect((await db.agendamento.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CANCELADO");
    await expect(f.reservar(f.barbeiro.id, f.terceiro.id)).resolves.toBeTruthy();
  });

  it("movimento do grupo e cancelamento com adicional iniciado exigem revisão, sem alterar os registros", async () => {
    const f = await fixture(), a = await f.adicionar();
    await expect(alterarAgendamento(f.principal.id, { inicio: horario(660) }, f.dono)).rejects.toMatchObject({ codigo: "adicional_reservado" });
    await expect(alterarStatus(a.id, "CANCELADO", f.dono)).rejects.toMatchObject({ codigo: "adicional_na_comanda" });
    await alterarStatus(a.id, "CHEGOU", f.dono);
    await expect(cancelarComanda(f.dono, f.comanda.id, "Teste")).rejects.toMatchObject({ codigo: "adicional_iniciado" });
    expect((await db.comanda.findUniqueOrThrow({ where: { id: f.comanda.id } })).status).toBe("ABERTA");
    expect((await db.agendamento.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CHEGOU");
  });

  it("conclui adicional próprio, preserva histórico ao cancelar comanda fechada e impede reabertura isolada", async () => {
    const f = await fixture(0), a = await f.adicionar();
    await alterarStatus(a.id, "CONCLUIDO", f.dono);
    await fecharComanda(f.dono, f.comanda.id);
    await expect(alterarStatus(a.id, "EM_ATENDIMENTO", f.dono)).rejects.toMatchObject({ codigo: "comanda_encerrada" });
    await cancelarComanda(f.dono, f.comanda.id, "Teste de preservação de histórico");
    expect((await db.agendamento.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CONCLUIDO");
    expect(await db.itemComanda.count({ where: { agendamentoId: a.id } })).toBe(1);
  });

  it("filhos legados mantêm false e o grupo SITE continua concluindo em conjunto", async () => {
    const f = await fixture();
    await db.agendamento.update({ where: { id: f.principal.id }, data: { origem: "SITE", fim: horario(660) } });
    const legado = await db.agendamento.create({ data: { barbeiroId: f.barbeiro.id, clienteId: f.cliente.id, servicoId: f.servico.id, inicio: horario(630), fim: horario(660), origem: "SITE", adicionalDeId: f.principal.id, precoCentavos: 5000 } });
    expect(legado.ocupaAgenda).toBe(false);
    await alterarStatus(f.principal.id, "CONCLUIDO", f.dono);
    expect((await db.agendamento.findUniqueOrThrow({ where: { id: legado.id } }))).toMatchObject({ ocupaAgenda: false, status: "CONCLUIDO" });
    const dia = (await carregarDia(segunda, [f.barbeiro.id], { fuso: FUSO })).get(f.barbeiro.id)!;
    expect(dia.agendamentos.map(a => a.id)).toEqual([f.principal.id]);
  });

  it("nega acesso de outro barbeiro, sem criar reserva nem item", async () => {
    const f = await fixture();
    const estranho = { ...f.dono, papel: "BARBEIRO", barbeiroId: f.outro.id } as Sessao;
    await expect(adicionarServico(estranho, f.comanda.id, f.servico.id, f.barbeiro.id)).rejects.toMatchObject({ status: 403 });
    expect(await db.agendamento.count({ where: { adicionalDeId: f.principal.id } })).toBe(0);
    expect(await db.itemComanda.count({ where: { comandaId: f.comanda.id } })).toBe(1);
  });

  it("repetições concorrentes da mesma solicitação criam apenas um adicional e um item", async () => {
    const f = await fixture(), chave = randomUUID();
    const incluir = () => adicionarServico(f.dono, f.comanda.id, f.servico.id, f.barbeiro.id, chave);
    const [a, b] = await Promise.all([incluir(), incluir()]);
    expect(a.id).toBe(chave); expect(b.id).toBe(chave);
    expect(await db.agendamento.count({ where: { adicionalDeId: f.principal.id } })).toBe(1);
    expect(await db.itemComanda.count({ where: { agendamentoId: chave } })).toBe(1);
    expect(await db.auditoria.count({ where: { entidade: "solicitacao_adicional", entidadeId: chave } })).toBe(1);
    await expect(adicionarServico(f.dono, f.comanda.id, f.servico.id, f.outro.id, chave)).rejects.toMatchObject({ codigo: "solicitacao_reutilizada" });
    const outroUsuario = await db.usuario.create({ data: { nome: "Outro dono fictício", telefone: `outro-dono-${randomUUID()}`, papel: "DONO" } });
    await expect(adicionarServico({ ...f.dono, usuarioId: outroUsuario.id }, f.comanda.id, f.servico.id, f.barbeiro.id, chave)).rejects.toMatchObject({ codigo: "solicitacao_reutilizada" });
  });

  it("auditoria impede ressuscitar tentativa removida, cancelada ou apagada", async () => {
    const f = await fixture(), chave = randomUUID();
    await adicionarServico(f.dono, f.comanda.id, f.servico.id, f.barbeiro.id, chave);
    const item = await db.itemComanda.findUniqueOrThrow({ where: { agendamentoId: chave } });
    await alterarItem(f.dono, item.id, 0);
    const repetir = () => adicionarServico(f.dono, f.comanda.id, f.servico.id, f.barbeiro.id, chave);
    await expect(repetir()).rejects.toMatchObject({ codigo: "solicitacao_encerrada" });
    await db.agendamento.delete({ where: { id: chave } });
    await expect(repetir()).rejects.toMatchObject({ codigo: "solicitacao_encerrada" });
    expect(await db.agendamento.count({ where: { adicionalDeId: f.principal.id } })).toBe(0);
    expect(await db.itemComanda.count({ where: { comandaId: f.comanda.id } })).toBe(1);
    expect(await db.pagamentoComanda.count({ where: { comandaId: f.comanda.id } })).toBe(0);
  });

  async function convite(f: Awaited<ReturnType<typeof fixture>>, inicio = horario(840)) {
    const tag = randomUUID(), agora = Date.now();
    const vaga = await db.vagaRecrutamento.create({ data: { titulo: "Seleção fictícia", cidade: "Rio do Sul", descricao: "Teste", privacidade: "Teste local", criadoPorId: f.dono.usuarioId } });
    const candidato = await db.candidatoRecrutamento.create({ data: { nome: "Candidato fictício", cidade: "Rio do Sul", telefone: `candidato-${tag}` } });
    const candidatura = await db.candidaturaRecrutamento.create({ data: { envioId: tag, conteudoHash: tag, vagaId: vaga.id, candidatoId: candidato.id, experienciaMeses: 0, servicos: [], disponibilidade: "Segunda", portfolio: "", instagram: "", futurasOportunidades: false, formularioVersao: "fixture", avisoPrivacidade: "Local", origem: {} } });
    const entrevista = await criarConviteEntrevista(f.dono.usuarioId, candidatura.id, { chave: randomUUID(), versao: 0, duracaoMin: 30, local: "Unidade fictícia" }, agora);
    const token = tokenEntrevista(entrevista);
    const escolha = await candidatoEntrevista(token, { acao: "ESCOLHER", inicio: inicio.toISOString(), versao: 0 }, agora);
    return { token, escolha, agora, entrevista };
  }

  it("confirmação de entrevista e reserva do dono simultâneas têm um único vencedor", async () => {
    const f = await fixture(5000, true), c = await convite(f);
    const corrida = await Promise.allSettled([candidatoEntrevista(c.token, { acao: "CONFIRMAR", versao: c.escolha.versao }, c.agora), f.reservar(f.barbeiro.id, f.terceiro.id, horario(840))]);
    expect(corrida.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const entrevistas = await db.entrevistaRecrutamento.count({ where: { id: c.entrevista.id, estado: "CONFIRMADA" } });
    const reservas = await db.agendamento.count({ where: { barbeiroId: f.barbeiro.id, inicio: horario(840), status: { not: "CANCELADO" } } });
    expect(entrevistas + reservas).toBe(1);
  });

  it("entrevista confirmada bloqueia oferta e fechamento da agenda sem expor o candidato", async () => {
    const f = await fixture(5000, true), c = await convite(f);
    await candidatoEntrevista(c.token, { acao: "CONFIRMAR", versao: c.escolha.versao }, c.agora);
    const dia = (await carregarDia(segunda, [f.barbeiro.id], { fuso: FUSO })).get(f.barbeiro.id)!;
    expect(dia.bloqueios).toContainEqual({ id: `entrevista:${c.entrevista.id}`, motivo: "Indisponível", inicio: +horario(840), fim: +horario(870) });
    expect(JSON.stringify(dia)).not.toContain("Candidato fictício");
    await expect(fecharAgenda(f.barbeiro.id, { inicio: horario(840), fim: horario(870), confirmar: true }, f.dono)).rejects.toMatchObject({ codigo: "conflito_entrevista" });
    await expect(f.reservar(f.barbeiro.id, f.terceiro.id, horario(840))).rejects.toMatchObject({ codigo: "conflito_entrevista" });
  });

  it("nova ocupação ou bloqueio antes de confirmar invalida a escolha sem forçar outra reserva", async () => {
    const f = await fixture(5000, true), c = await convite(f);
    await f.reservar(f.barbeiro.id, f.terceiro.id, horario(840));
    await expect(candidatoEntrevista(c.token, { acao: "CONFIRMAR", versao: c.escolha.versao }, c.agora)).rejects.toMatchObject({ status: 409 });
    const novos = await candidatoEntrevista(c.token, { acao: "CONSULTAR" }, c.agora);
    expect(novos.horarios).not.toContain(horario(840).toISOString());
    expect((await db.entrevistaRecrutamento.findUniqueOrThrow({ where: { id: c.entrevista.id } })).estado).toBe("AGUARDA_CONFIRMACAO");
  });

  it("folga explícita do dono bloqueia entrevista e não é criada sobre entrevista confirmada", async () => {
    const f = await fixture(5000, true), c = await convite(f);
    await salvarExcecao(f.barbeiro.id, { data: segunda, tipo: "FOLGA", motivo: "Folga fictícia" }, f.dono);
    const oferta = await candidatoEntrevista(c.token, { acao: "CONSULTAR" }, c.agora);
    expect(oferta.horarios).not.toContain(horario(840).toISOString());
    await expect(candidatoEntrevista(c.token, { acao: "CONFIRMAR", versao: c.escolha.versao }, c.agora)).rejects.toMatchObject({ status: 409 });
    await removerExcecao(f.barbeiro.id, segunda, f.dono);
    await candidatoEntrevista(c.token, { acao: "CONFIRMAR", versao: c.escolha.versao }, c.agora);
    await expect(salvarExcecao(f.barbeiro.id, { data: segunda, tipo: "FOLGA" }, f.dono)).rejects.toMatchObject({ codigo: "conflito_entrevista" });
    expect(await db.excecaoAgenda.count({ where: { barbeiroId: f.barbeiro.id } })).toBe(0);
  });
});
