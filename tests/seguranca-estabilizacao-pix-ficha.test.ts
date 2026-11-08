import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ pessoa: {} as Record<string, unknown>, consultar: vi.fn(), atualizar: vi.fn(), auditar: vi.fn(), ator: vi.fn(), listar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  checklistPessoa: { findMany: m.listar }, barbeiro: { findMany: async () => [] }, checklistConfig: { upsert: async () => ({}) },
  $transaction: async (fn: (tx: unknown) => unknown) => {
    const antes = { ...m.pessoa };
    try { return await fn({ $queryRaw: vi.fn(), checklistPessoa: { findUnique: m.consultar, findFirst: async () => null, update: m.atualizar }, usuario: { findUnique: m.ator } }); }
    catch (e) { m.pessoa = antes; throw e; }
  },
} }));
vi.mock("@/lib/checklist/pontos", () => ({ totaisDePontos: async () => new Map() }));
vi.mock("@/lib/checklist/regras", () => ({ progressoNivel: () => ({ nivel: 1 }) }));
vi.mock("@/lib/auditoria", () => ({ auditarMudanca: m.auditar, auditar: m.auditar }));
vi.mock("@/lib/rh/vigencias", () => ({ competenciasRemuneracao: () => ({ atual: "2026-11", proxima: "2026-12" }), lerVigenciaRemuneracao: async () => null,
  competenciaSalario: () => "2026-12", garantirBaselineRemuneracao: vi.fn(), gravarVigenciaRemuneracao: vi.fn() }));
import { listarFuncionarios, salvarFicha, type FichaEntrada } from "@/lib/rh/funcionarios";
import { protegerChavePix } from "@/lib/rh/pix-protegido";
import { migrarPixLegado } from "@/lib/rh/pix-migracao";
import type { Sessao } from "@/lib/auth/sessao";
const s: Sessao = { usuarioId: "fixture-dono", papel: "DONO", nome: "Fixture", sessaoVersao: 4, barbeiroId: null, clienteId: null };
const ficha: FichaEntrada = { cargo: "Fixture", salarioCentavos: 100, admissao: null, barbeiroId: null };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("RH_PIX_ENCRYPTION_KEY", Buffer.alloc(32, 71).toString("base64"));
  m.pessoa = { id: "p1", nome: "Fixture", telefone: "sintetico-001", funcao: "BARBEIRO", ativo: true, salarioCentavos: 100, admissao: null, revisaoPix: 0, ...protegerChavePix("p1", "fixture@example.test") };
  m.consultar.mockImplementation(async () => ({ ...m.pessoa })); m.listar.mockImplementation(async () => [{ ...m.pessoa }]);
  m.ator.mockResolvedValue({ ativo: true, papel: "DONO", sessaoVersao: 4 });
  m.atualizar.mockImplementation(async ({ data }) => { Object.assign(m.pessoa, data); if ("chavePixCifrada" in data) m.pessoa.revisaoPix = Number(m.pessoa.revisaoPix) + 1; return { ...m.pessoa }; });
});
afterEach(() => vi.unstubAllEnvs());

describe("cadastro Pix confidencial e atualização explícita", () => {
  it("listagem nunca envia chave em texto, cifra ou hash individual", async () => {
    const resultado = await listarFuncionarios(), texto = JSON.stringify(resultado);
    expect(texto).not.toContain("fixture@example.test"); expect(texto).not.toContain(m.pessoa.chavePixCifrada); expect(texto).not.toContain(m.pessoa.chavePixHash);
    expect(resultado.funcionarios[0]).not.toHaveProperty("chavePix");
    expect(resultado.funcionarios[0].pix).toMatchObject({ estado: "PROTEGIDA" });
  });
  it("editar salário sem preencher Pix preserva o cadastro mesmo sem segredo disponível", async () => {
    vi.stubEnv("RH_PIX_ENCRYPTION_KEY", "");
    await salvarFicha(s, "p1", ficha);
    expect(m.atualizar.mock.calls[0][0].data).not.toHaveProperty("chavePix");
    expect(m.atualizar.mock.calls[0][0].data).not.toHaveProperty("chavePixCifrada");
  });
  it("altera somente com dono atual e revisão exata, com chave vazia legada recusada", async () => {
    m.ator.mockResolvedValueOnce({ ativo: true, papel: "GERENTE", sessaoVersao: 4 });
    await expect(salvarFicha(s, "p1", { ...ficha, chavePix: "nova@example.test", revisaoPix: 0 })).rejects.toMatchObject({ status: 403 });
    await expect(salvarFicha(s, "p1", { ...ficha, chavePix: "nova@example.test", revisaoPix: 2 })).rejects.toMatchObject({ codigo: "pix_mudou" });
    await expect(salvarFicha(s, "p1", { ...ficha, chavePix: null })).rejects.toMatchObject({ codigo: "pix_mudou" });
    expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("troca cifra/metadata em conjunto e audita apenas a revisão", async () => {
    await salvarFicha(s, "p1", { ...ficha, chavePix: "nova@example.test", revisaoPix: 0 });
    expect(m.pessoa.chavePix).toBeNull(); expect(m.pessoa.chavePixCifrada).toBeTruthy(); expect(m.pessoa.revisaoPix).toBe(1);
    expect(JSON.stringify(m.auditar.mock.calls)).not.toContain("nova@example.test");
    expect(JSON.stringify(m.auditar.mock.calls)).not.toContain(m.pessoa.chavePixCifrada);
  });
  it("auditoria indisponível preserva o cadastro anterior", async () => {
    const antes = { ...m.pessoa }; m.auditar.mockRejectedValueOnce(new Error("fixture-auditoria"));
    await expect(salvarFicha(s, "p1", { ...ficha, chavePix: "nova@example.test", revisaoPix: 0 })).rejects.toThrow("fixture-auditoria");
    expect(m.pessoa).toEqual(antes);
  });
  it("migrador sem segredo falha antes de consultar qualquer registro legado", async () => {
    vi.stubEnv("RH_PIX_ENCRYPTION_KEY", "");
    await expect(migrarPixLegado()).rejects.toMatchObject({ codigo: "pix_protecao_indisponivel" });
    expect(m.listar).not.toHaveBeenCalled();
  });
});
