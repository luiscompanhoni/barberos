import { beforeEach, expect, it, vi } from "vitest";
import { conflitosSemana, decidirSemana, solicitarSemana } from "@/lib/agenda/solicitacoes-horario";
import { solicitarPeriodo } from "@/lib/agenda/solicitacoes-periodo";

const m = vi.hoisted(() => ({ pedido: vi.fn(), pendente: vi.fn(), criar: vi.fn(), atualizar: vi.fn(), semana: vi.fn(), apagar: vi.fn(), inserir: vi.fn(), bloquear: vi.fn(), agendamentos: vi.fn(), excecoes: vi.fn(), lock: vi.fn(), auditar: vi.fn(), permissao: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = { $queryRaw: vi.fn(), expedientePadrao: { findMany: m.semana, deleteMany: m.apagar, createMany: m.inserir }, solicitacaoHorario: { findUnique: m.pedido, findFirst: m.pendente, create: m.criar, update: m.atualizar }, agendamento: { findMany: m.agendamentos }, excecaoAgenda: { findMany: m.excecoes }, bloqueio: { create: m.bloquear } };
  return { db: { ...tx, $transaction: (f: (t: typeof tx) => unknown) => f(tx) } };
});
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirPermissao: m.permissao }));
vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));
vi.mock("@/lib/agenda/agendamentos", () => ({ travarBarbeiro: m.lock }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }), excecaoParaDia: (e: { tipo: string; intervalos: unknown } | null) => e ? { tipo: e.tipo, intervalos: e.intervalos } : null }));
vi.mock("@/lib/agenda/expediente", () => ({ validarIntervalos: vi.fn() }));

const barber = { usuarioId: "u", papel: "BARBEIRO", barbeiroId: "b" } as never;
const dono = { usuarioId: "d", papel: "DONO", barbeiroId: null } as never;
const original = [{ diaSemana: 1, inicioMin: 540, fimMin: 1080 }];
const proposto = [{ diaSemana: 1, inicioMin: 600, fimMin: 1080 }];
beforeEach(() => { vi.clearAllMocks(); m.semana.mockResolvedValue(original); m.pendente.mockResolvedValue(null); m.agendamentos.mockResolvedValue([]); m.excecoes.mockResolvedValue([]); m.criar.mockResolvedValue({ id: "p" }); m.atualizar.mockResolvedValue({ id: "p", status: "APROVADA" }); m.pedido.mockResolvedValue({ id: "p", barbeiroId: "b", tipo: "SEMANA", status: "PENDENTE", original, proposto }); });
it("barbeiro só solicita para si, sem aplicar a alteração", async () => {
  await expect(solicitarSemana("outro", proposto, barber)).rejects.toMatchObject({ status: 403 });
  await solicitarSemana("b", proposto, barber);
  expect(m.criar).toHaveBeenCalledOnce(); expect(m.apagar).not.toHaveBeenCalled(); expect(m.inserir).not.toHaveBeenCalled(); expect(m.auditar).toHaveBeenCalledOnce();
});
it("só dono ou gerente decide, e uma semana alterada não é sobrescrita", async () => {
  await expect(decidirSemana("b", "p", "aprovar", undefined, barber)).rejects.toMatchObject({ status: 403 });
  m.semana.mockResolvedValue([]);
  await expect(decidirSemana("b", "p", "aprovar", undefined, dono)).rejects.toMatchObject({ status: 409 });
  expect(m.apagar).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled();
});
it("gerente sem permissão da agenda não pode decidir", async () => {
  const { ErroNegocio } = await import("@/lib/erros");
  m.permissao.mockRejectedValueOnce(new ErroNegocio("sem permissão", 403));
  await expect(decidirSemana("b", "p", "aprovar", undefined, { usuarioId: "g", papel: "GERENTE" } as never)).rejects.toMatchObject({ status: 403 });
  expect(m.atualizar).not.toHaveBeenCalled();
});
it("aprova uma única vez, com registros e sem cancelar atendimentos", async () => {
  await decidirSemana("b", "p", "aprovar", "Combinado", dono);
  expect(m.lock).toHaveBeenCalledOnce(); expect(m.apagar).toHaveBeenCalledOnce(); expect(m.inserir).toHaveBeenCalledOnce(); expect(m.atualizar).toHaveBeenCalledOnce(); expect(m.auditar).toHaveBeenCalledOnce();
  m.pedido.mockResolvedValue({ id: "p", barbeiroId: "b", status: "APROVADA", original, proposto });
  await expect(decidirSemana("b", "p", "aprovar", undefined, dono)).rejects.toMatchObject({ status: 409 });
});
it("detecta conflito pela semana proposta e respeita exceção especial", async () => {
  const { db } = await import("@/lib/db");
  const d = new Date(Date.now() + 86400000); const local = (await import("@/lib/agenda/tempo")).dataLocal(d, "America/Sao_Paulo");
  const { diaSemana, instanteLocal, dataParaColuna } = await import("@/lib/agenda/tempo");
  const inicio = new Date(instanteLocal(local, 9 * 60, "America/Sao_Paulo"));
  m.agendamentos.mockResolvedValue([{ id: "a", inicio, fim: new Date(+inicio + 30 * 60000), cliente: { nome: "Cliente" }, servico: { nome: "Corte" } }]);
  const semana = [{ diaSemana: diaSemana(local), inicioMin: 600, fimMin: 1080 }];
  expect(await conflitosSemana(db, "b", semana)).toHaveLength(1);
  m.excecoes.mockResolvedValue([{ data: dataParaColuna(local), tipo: "HORARIO_ESPECIAL", intervalos: [{ inicioMin: 540, fimMin: 1080 }] }]);
  expect(await conflitosSemana(db, "b", semana)).toHaveLength(0);
});
it("não aprova nem altera horários com atendimento em conflito", async () => {
  const { dataLocal, instanteLocal } = await import("@/lib/agenda/tempo");
  const data = dataLocal(Date.now() + 86400000, "America/Sao_Paulo");
  const inicio = new Date(instanteLocal(data, 8 * 60, "America/Sao_Paulo"));
  m.agendamentos.mockResolvedValue([{ id: "a", inicio, fim: new Date(+inicio + 30 * 60000), cliente: { nome: "Cliente" }, servico: { nome: "Corte" } }]);
  await expect(decidirSemana("b", "p", "aprovar", undefined, dono)).rejects.toMatchObject({ status: 409, codigo: "conflitos_pendentes" });
  expect(m.apagar).not.toHaveBeenCalled(); expect(m.inserir).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled();
});
it("solicita e aprova folga sem cancelar atendimentos", async () => {
  const periodo = { data: "2099-01-01", inicioMin: 600, fimMin: 660, motivo: "Pessoal" };
  await solicitarPeriodo("b", "FOLGA", periodo, barber);
  expect(m.criar).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tipo: "FOLGA", proposto: expect.objectContaining({ inicioMin: 0, fimMin: 1440 }) }) }));
  expect(m.bloquear).not.toHaveBeenCalled();
  m.pedido.mockResolvedValue({ id: "p", barbeiroId: "b", tipo: "FOLGA", status: "PENDENTE", proposto: { ...periodo, inicioMin: 0, fimMin: 1440 } });
  await decidirSemana("b", "p", "aprovar", undefined, dono);
  expect(m.bloquear).toHaveBeenCalledOnce();
  expect(m.apagar).not.toHaveBeenCalled();
});
it("solicitação de bloqueio não é aplicada se houver atendimento no período", async () => {
  const periodo = { data: "2099-01-01", inicioMin: 600, fimMin: 660, motivo: "" };
  m.pedido.mockResolvedValue({ id: "p", barbeiroId: "b", tipo: "BLOQUEIO", status: "PENDENTE", proposto: periodo });
  m.agendamentos.mockResolvedValue([{ id: "a" }]);
  await expect(decidirSemana("b", "p", "aprovar", undefined, dono)).rejects.toMatchObject({ status: 409, codigo: "conflitos_pendentes" });
  expect(m.bloquear).not.toHaveBeenCalled();
});
