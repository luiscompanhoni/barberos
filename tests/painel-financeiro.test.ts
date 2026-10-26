import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/painel/route";

const mocks = vi.hoisted(() => ({
  pode: vi.fn(), sessao: vi.fn(), resultado: vi.fn(), dataLocal: vi.fn(),
}));
vi.mock("@/lib/auth/permissoes", () => ({ pode: mocks.pode }));
vi.mock("@/lib/auth/sessao", () => ({ BALCAO: ["DONO", "RECEPCAO"], exigirSessao: mocks.sessao }));
vi.mock("@/lib/agenda/tempo", () => ({ dataLocal: mocks.dataLocal }));
vi.mock("@/lib/conciliacao/resultado", () => ({ resultadoDoMes: mocks.resultado }));
vi.mock("@/lib/backups", () => ({ alertaBackup: async () => null }));
vi.mock("@/lib/comandas/relatorio", () => ({ produtosAcabando: async () => [], vendasDeHoje: async () => ({ totalCentavos: 0 }) }));
vi.mock("@/lib/crescimento/espera", () => ({ esperasAtivas: async () => [] }));
vi.mock("@/lib/estornos/servico", () => ({ contarPendentes: async () => 0 }));
vi.mock("@/lib/painel", () => ({
  resumoDoDia: async () => ({ atendimentos: 1 }),
  pendencias: async () => ({ fuso: "America/Sao_Paulo", semBaixa: [] }),
  resumoDoMes: async () => ({ atual: { centavos: 91250 } }),
  mapaDePico: async () => null,
}));

describe("financeiro no painel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessao.mockResolvedValue({ papel: "DONO", usuarioId: "dono" });
    mocks.pode.mockResolvedValue(true);
    mocks.dataLocal.mockReturnValue("2026-10-21");
    mocks.resultado.mockResolvedValue({
      mes: "2026-10", registrado: { total: 2127929 },
      despesas: { total: 1266691 }, custos: { total: 93121 },
      lucro: 768117, alertas: ["Extrato pendente"],
      retiradas: 580850,
    });
  });

  it("usa o resultado financeiro, sem tratar os preços da agenda como faturamento total", async () => {
    const resposta = await GET();
    const dados = await resposta.json();
    expect(dados.financeiro).toEqual({
      mes: "2026-10", faturamento: 2127929, despesas: 1266691,
      taxas: 93121, lucro: 768117, alertas: ["Extrato pendente"],
    });
    expect(mocks.resultado).toHaveBeenCalledWith("2026-10");
    expect(mocks.dataLocal).toHaveBeenCalledWith(expect.any(Number), "America/Sao_Paulo");
  });

  it("não consulta nem devolve resultado para quem não tem permissão", async () => {
    mocks.pode.mockResolvedValue(false);
    mocks.sessao.mockResolvedValue({ papel: "RECEPCAO", usuarioId: "recepcao" });
    const dados = await (await GET()).json();
    expect(dados.financeiro).toBeNull();
    expect(mocks.resultado).not.toHaveBeenCalled();
    expect(dados.mes).toBeNull();
  });

  it("quem ve faturamento mas nao o lucro nao recebe despesas nem lucro", async () => {
    mocks.pode.mockImplementation(async (_s: unknown, p: string) => p === "resultado");
    mocks.sessao.mockResolvedValue({ papel: "GERENTE", usuarioId: "gerente" });
    const dados = await (await GET()).json();
    expect(dados.financeiro).toBeNull();
    expect(mocks.resultado).not.toHaveBeenCalled();
    expect(dados.mes).not.toBeNull();
  });

  it("preserva a operação e não expõe o erro interno quando o financeiro falha", async () => {
    mocks.resultado.mockRejectedValue(new Error("detalhe interno do banco"));
    const resposta = await GET();
    const dados = await resposta.json();
    expect(resposta.status).toBe(200);
    expect(dados.financeiro).toBeNull();
    expect(dados.dia.atendimentos).toBe(1);
    expect(JSON.stringify(dados)).not.toContain("detalhe interno");
  });
});
