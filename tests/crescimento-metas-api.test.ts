import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/crescimento/metas/route";
import { ErroNegocio } from "@/lib/erros";

const mocks = vi.hoisted(() => ({ sessao: vi.fn(), permissao: vi.fn(), configuracao: vi.fn(), assinaturas: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ LIDERANCA: ["DONO", "GERENTE", "LIDER"], exigirSessao: mocks.sessao }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirPermissao: mocks.permissao }));
vi.mock("@/lib/db", () => ({ db: { configuracao: { findUnique: mocks.configuracao }, assinatura: { findMany: mocks.assinaturas } } }));

function assinatura(indice: number, alteracoes: Record<string, unknown> = {}) {
  return { id: `id-original-${indice}`, clienteId: `cliente-original-${indice}`, planoId: "plano-original", status: "ATIVA", precoCentavos: 9_800,
    cicloInicio: new Date("2026-11-01T00:00:00Z"), proximoVencimento: new Date("2026-12-01T00:00:00Z"),
    ativadaEm: new Date("2026-11-01T12:00:00Z"), criadaEm: new Date("2026-11-01T12:00:00Z"), encerraEm: null, pausadaEm: null, operacaoInicial: null,
    plano: { nome: "Plano efetivo" }, cobrancas: [{ vencimento: new Date("2026-11-01T00:00:00Z"), pagaEm: new Date("2026-11-01T12:00:00Z") }], ...alteracoes };
}
function cenario() {
  return { referencia: "2026-11-08", realizado: { inicio: "2026-10-01", fimExclusivo: "2026-11-01", receitaAssinaturasLiquidaCentavos: 100_000,
    receitaOutrasVendasLiquidaCentavos: 0, descontosEstornosJaDeduzidosCentavos: 0, custosTotaisCentavos: null, custosCompletos: false },
  assinantesAdimplentes: 1, assinantesAtrasados: 0, contratosCompletos: false,
  contratos: [{ id: "c-1", clienteId: "p-1", planoId: "pl-1", inicio: "2026-11-01", fimExclusivo: null, valorMensalLiquidoCentavos: 9_800, situacao: "ADIMPLENTE" }],
  cancelamentos: [], dezembro: { outrasVendasLiquidasCentavos: null, custosBaseCentavos: null, custosCompletos: false },
  aquisicao: { contribuicaoVerificada: false, receitaLiquidaPorNovoDezembroCentavos: null, custosVariaveisPorNovoCentavos: null,
    custoIndicacaoTotalPorNovoCentavos: 0, creditoIndicacaoJaDeduzidoReceitaPorNovoCentavos: 0 },
  capacidade: { verificada: false, duracaoVisitaMinutos: null, minutosOfertaveisDezembro: null, minutosOutrasVendasDezembro: null, visitasPlanejadasPorAssinante: 4 } };
}
const requisicao = (body: unknown) => new Request("http://localhost/api/crescimento/metas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("API de metas: acesso, evidência e cálculo sem efeitos", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-08T15:00:00Z"));
    mocks.sessao.mockResolvedValue({ papel: "DONO", usuarioId: "dono" });
    mocks.permissao.mockResolvedValue(undefined); mocks.configuracao.mockResolvedValue({ fuso: "America/Sao_Paulo" });
    mocks.assinaturas.mockResolvedValue([]);
  });
  afterEach(() => { vi.useRealTimers(); });

  it("exige liderança e permissão de lucro antes de consultar ou calcular", async () => {
    mocks.sessao.mockRejectedValue(new ErroNegocio("Entre.", 401));
    expect((await GET()).status).toBe(401);
    expect((await POST(requisicao(cenario()))).status).toBe(401);
    expect(mocks.assinaturas).not.toHaveBeenCalled(); expect(mocks.permissao).not.toHaveBeenCalled();
    mocks.sessao.mockResolvedValue({ papel: "LIDER", usuarioId: "lider" });
    mocks.permissao.mockRejectedValue(new ErroNegocio("Sem permissão.", 403));
    expect((await GET()).status).toBe(403);
    expect((await POST(requisicao(cenario()))).status).toBe(403);
    expect(mocks.sessao).toHaveBeenCalledWith(["DONO", "GERENTE", "LIDER"]);
    expect(mocks.permissao).toHaveBeenCalledWith({ papel: "LIDER", usuarioId: "lider" }, "lucro");
    expect(mocks.assinaturas).not.toHaveBeenCalled();
  });

  it("não usa ATIVA, pagamento antigo, pausa ou operação inicial como prova atual", async () => {
    mocks.assinaturas.mockResolvedValue([assinatura(1), assinatura(2, { cobrancas: [] }),
      assinatura(3, { cobrancas: [{ vencimento: new Date("2026-10-01T00:00:00Z"), pagaEm: new Date("2026-10-01T12:00:00Z") }] }),
      assinatura(4, { status: "ATRASADA" }), assinatura(5, { pausadaEm: new Date() }), assinatura(6, { operacaoInicial: "piloto" })]);
    const resposta = await GET(); const dados = await resposta.json();
    expect(dados.assinantesNominais).toBe(6); expect(dados.assinantesComprovados).toBe(1);
    expect(dados.assinantesAtrasados).toBe(1); expect(dados.outrosSemComprovacao).toBe(4);
    expect(dados.mrrNominalCentavos).toBe(58_800); expect(dados.contratos).toHaveLength(2);
    expect(JSON.stringify(dados)).not.toContain("original");
    expect(dados.limitacoes.join(" ")).toContain("não foram auditados");
    expect(resposta.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.assinaturas.mock.calls[0][0].select.cobrancas.where).toEqual({ status: "PAGA", pagaEm: { not: null }, vinculosExternos: { none: {} } });
  });

  it("base indisponível devolve erro claro sem credenciais ou dados simulados", async () => {
    mocks.assinaturas.mockRejectedValue(new Error("postgres://senha-secreta@servidor"));
    const resposta = await GET(); const dados = await resposta.json();
    expect(resposta.status).toBe(503); expect(dados.erro).toContain("nenhum dado de exemplo");
    expect(JSON.stringify(dados)).not.toContain("senha-secreta");
  });

  it("não aceita ciclo expirado com vencimento empurrado ou pagamento com data futura", async () => {
    mocks.assinaturas.mockResolvedValue([
      assinatura(1, { cicloInicio: new Date("2026-09-01T00:00:00Z"),
        cobrancas: [{ vencimento: new Date("2026-09-01T00:00:00Z"), pagaEm: new Date("2026-09-01T12:00:00Z") }] }),
      assinatura(2, { cobrancas: [{ vencimento: new Date("2026-11-01T00:00:00Z"), pagaEm: new Date("2026-11-09T12:00:00Z") }] }),
    ]);
    const dados = await (await GET()).json();
    expect(dados.assinantesComprovados).toBe(0);
    expect(dados.outrosSemComprovacao).toBe(2);
  });

  it("POST somente calcula, preserva bloqueios e nunca aprova orçamento", async () => {
    const resposta = await POST(requisicao(cenario())); const dados = await resposta.json();
    expect(resposta.status).toBe(200); expect(dados.orcamentoAprovado).toBe(false);
    expect(dados.margemLiquidaRealizadaPontosBase).toBeNull(); expect(dados.tetoOrcamentoCandidatoCentavos).toBeNull();
    expect(dados.bloqueios).toContain("CAPACIDADE_NAO_VERIFICADA");
    expect(mocks.assinaturas).not.toHaveBeenCalled(); expect(mocks.configuracao).not.toHaveBeenCalled();
  });

  it("rejeita negativos, datas impossíveis, overflow e aprovação injetada", async () => {
    const negativo = cenario(); negativo.realizado.receitaAssinaturasLiquidaCentavos = -1;
    expect((await POST(requisicao(negativo))).status).toBe(400);
    const invalido = cenario(); invalido.referencia = "2026-11-31";
    expect((await POST(requisicao(invalido))).status).toBe(400);
    const overflow = cenario(); overflow.realizado.receitaAssinaturasLiquidaCentavos = Number.MAX_SAFE_INTEGER;
    overflow.realizado.receitaOutrasVendasLiquidaCentavos = 1;
    expect((await POST(requisicao(overflow))).status).toBe(400);
    expect((await POST(requisicao({ ...cenario(), orcamentoAprovado: true }))).status).toBe(400);
  });
});
