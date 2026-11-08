import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ atualizar: vi.fn(), baseline: vi.fn(), gravar: vi.fn(), count: vi.fn(), auditar: vi.fn(), ler: vi.fn(), salario: 1000 }));
vi.mock("@/lib/auditoria", () => ({ auditarMudanca: m.auditar }));
vi.mock("@/lib/rh/vigencias", async () => {
  const real = await vi.importActual<typeof import("@/lib/rh/vigencias")>("@/lib/rh/vigencias");
  return { ...real, garantirBaselineRemuneracao: m.baseline, gravarVigenciaRemuneracao: m.gravar, lerVigenciaRemuneracao: m.ler };
});
vi.mock("@/lib/checklist/pontos", () => ({ totaisDePontos: async () => new Map() }));
vi.mock("@/lib/checklist/regras", () => ({ progressoNivel: () => ({ nivel: 1 }) }));
vi.mock("@/lib/db", () => {
  const pessoa = () => ({ id: "p1", nome: "Fixture", telefone: "sintetico", ativo: true, funcao: "GERENTE", salarioCentavos: m.salario, chavePix: null, revisaoPix: 0, admissao: null });
  const tx = { $queryRaw: vi.fn(), checklistPessoa: { findUnique: async () => pessoa(), update: m.atualizar }, folhaPagamento: { count: m.count } };
  return { db: { $transaction: async (f: (v: unknown) => unknown) => f(tx), checklistPessoa: { findMany: async () => [pessoa()] }, barbeiro: { findMany: async () => [] }, checklistConfig: { upsert: async () => ({}) } } };
});
import { salvarFicha, listarFuncionarios } from "@/lib/rh/funcionarios";
import type { Sessao } from "@/lib/auth/sessao";
const dono: Sessao = { usuarioId: "dono", nome: "Fixture", papel: "DONO", barbeiroId: null, clienteId: null };
const d = { cargo: "Fixture", salarioCentavos: 2000, admissao: null, barbeiroId: null };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-08T12:00:00Z"));
  m.salario = 1000; m.count.mockResolvedValue(0); m.atualizar.mockResolvedValue({ revisaoPix: 0 }); m.ler.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());
it("salário alterado sem mês informado passa a valer no próximo mês com baseline anterior", async () => {
  await salvarFicha(dono, "p1", d);
  expect(m.baseline).toHaveBeenCalledWith(expect.anything(), "salario:p1", { salarioCentavos: 1000 }, "dono");
  expect(m.gravar).toHaveBeenCalledWith(expect.anything(), { escopo: "salario:p1", competencia: "2026-12", conteudo: { salarioCentavos: 2000 }, atorId: "dono" });
  expect(m.auditar.mock.calls[0].at(-1)).toMatchObject({ competenciaSalario: "2026-12" });
});
it("mês atual é aceito somente quando fornecido explicitamente", async () => {
  await salvarFicha(dono, "p1", { ...d, competenciaSalario: "2026-11" });
  expect(m.gravar.mock.calls[0][1].competencia).toBe("2026-11");
});
it("mês passado e mês com folha fechada são recusados antes de qualquer versão ou alteração", async () => {
  await expect(salvarFicha(dono, "p1", { ...d, competenciaSalario: "2026-10" })).rejects.toMatchObject({ codigo: "remuneracao_retroativa" });
  m.count.mockResolvedValue(1);
  await expect(salvarFicha(dono, "p1", { ...d, competenciaSalario: "2026-11" })).rejects.toMatchObject({ codigo: "folha_fechada" });
  expect(m.baseline).not.toHaveBeenCalled(); expect(m.gravar).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled();
});
it("edição sem mudar salário e sem selecionar mês não cria vigência", async () => {
  await salvarFicha(dono, "p1", { ...d, salarioCentavos: 1000 });
  expect(m.gravar).not.toHaveBeenCalled(); expect(m.baseline).not.toHaveBeenCalled();
});
it("exibe salário do mês sem confundir proposta futura com valor vigente", async () => {
  m.salario = 2000; m.ler.mockResolvedValue({ conteudo: { salarioCentavos: 1000 }, origem: "BASELINE_LEGADO_NAO_HOMOLOGADO" });
  const r = await listarFuncionarios();
  expect(r.funcionarios[0]).toMatchObject({ salarioCentavos: 2000, salarioAtualCentavos: 1000, salarioHomologado: false });
  expect(r.competenciaSalarioPadrao).toBe("2026-12");
});
it("conteúdo salarial malformado não vira zero ou configuração atual por fallback", async () => {
  m.ler.mockResolvedValue({ conteudo: { salarioCentavos: "2000" }, origem: "CONFIGURACAO_EXPLICITA" });
  await expect(listarFuncionarios()).rejects.toMatchObject({ codigo: "remuneracao_invalida" });
});
