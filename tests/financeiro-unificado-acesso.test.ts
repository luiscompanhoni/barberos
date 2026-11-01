import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sessao: vi.fn(), pode: vi.fn(), pendentes: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirSessao: m.sessao, BALCAO: ["DONO", "GERENTE", "RECEPCAO"], GESTAO: ["DONO", "GERENTE"] }));
vi.mock("@/lib/auth/permissoes", () => ({ pode: m.pode }));
vi.mock("@/lib/estornos/servico", () => ({ contarPendentes: m.pendentes }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/components/financeiro/FinanceiroTela", () => ({ FinanceiroTela: () => null }));
vi.mock("@/components/financeiro/MeuFinanceiro", () => ({ MeuFinanceiro: () => null }));
vi.mock("@/components/financeiro/FinanceiroContexto", () => ({ FinanceiroContexto: () => null }));
import Page from "@/app/(app)/financeiro/page";
import Antiga from "@/app/(app)/meu-financeiro/page";

const page = (searchParams: Record<string, string> = {}) => Page({ searchParams: Promise.resolve(searchParams), params: Promise.resolve({}) });
describe("financeiro unificado preserva a separação de acesso", () => {
  beforeEach(() => { vi.clearAllMocks(); m.sessao.mockResolvedValue({ papel: "DONO", usuarioId: "dono" }); m.pode.mockResolvedValue(true); m.pendentes.mockResolvedValue(2); });
  it.each(["BARBEIRO", "LIDER", "DONO", "RECEPCAO"])("%s não consulta a empresa na área pessoal", async papel => {
    m.sessao.mockResolvedValue({ papel });
    const tela = await page({ area: "pessoal" });
    expect(tela.props.pessoal).toBe(true);
    expect(m.pendentes).not.toHaveBeenCalled(); expect(m.pode).not.toHaveBeenCalled();
  });
  it.each(["BARBEIRO", "LIDER"])("%s é encaminhado ao pessoal ao pedir empresa", async papel => {
    m.sessao.mockResolvedValue({ papel });
    await expect(page({ area: "empresa", aba: "resultado" })).rejects.toThrow("REDIRECT:/financeiro?area=pessoal");
    expect(m.pendentes).not.toHaveBeenCalled(); expect(m.pode).not.toHaveBeenCalled();
  });
  it("recepção sem lucro não abre resultado por URL", async () => {
    m.sessao.mockResolvedValue({ papel: "RECEPCAO" }); m.pode.mockResolvedValue(false);
    const tela = await page({ area: "empresa", aba: "resultado" });
    expect(tela.props.children.props.verLucro).toBe(false);
    expect(tela.props.children.props.abaInicial).toBe("despesas");
  });
  it("mantém o acesso autorizado ao resultado", async () => {
    const tela = await page({ aba: "resultado" });
    expect(tela.props.children.props.verLucro).toBe(true);
    expect(tela.props.children.props.abaInicial).toBe("resultado");
  });
  it("uma sessão rejeitada não consulta dados financeiros", async () => {
    m.sessao.mockRejectedValue(new Error("Sem acesso"));
    await expect(page()).rejects.toThrow("Sem acesso");
    expect(m.pode).not.toHaveBeenCalled(); expect(m.pendentes).not.toHaveBeenCalled();
  });
  it("o endereço antigo conserva o destino pessoal", () => { expect(() => Antiga()).toThrow("REDIRECT:/financeiro?area=pessoal"); });
});
