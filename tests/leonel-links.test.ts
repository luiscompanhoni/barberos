import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as indicacao } from "@/app/i/[codigo]/route";
import { presentesDaConversa } from "@/lib/bot/presentes";
import { landingDaCampanha, registrarClique } from "@/lib/campanhas/link";

const m = vi.hoisted(() => ({ buscar: vi.fn(), atualizar: vi.fn(), convite: vi.fn(), dono: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  campanhaEnvio: { findUnique: m.buscar, updateMany: m.atualizar, findFirst: m.convite },
  cliente: { findUnique: async () => ({ id: "cliente-ficticio", excluidoEm: null }) },
  premioGanho: { findMany: async () => [] },
} }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ nomeBarbearia: "Black Barber" }) }));
vi.mock("@/lib/assinaturas/servico", () => ({ situacaoDoCliente: vi.fn() }));
vi.mock("@/lib/jogos/motor", () => ({ noAr: vi.fn(), paraCliente: vi.fn(), premiosExibiveis: vi.fn() }));
vi.mock("@/lib/crescimento/indicacao", () => ({ donoDoCodigo: m.dono, COOKIE_INDICACAO: "black_indicacao" }));
vi.mock("@/lib/dominios", () => ({ urlSite: () => "http://localhost:3000", cookieSeguro: () => false }));

describe("destinos dos links do Leonel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("abre e rastreia o link após a reserva da continuação, sem afetar links legados", async () => {
    const token = "token-campanha-ficticio";
    const where = {
      token, status: "ENVIADO",
      OR: [{ aberturaIniciadaEm: null }, { continuacaoReservadaEm: { not: null } }],
    };
    m.buscar.mockResolvedValueOnce(null).mockResolvedValueOnce({
      status: "ENVIADO", cliente: { nome: "João Teste" }, campanha: { jogo: null },
    });

    expect(await landingDaCampanha(token)).toBeNull();
    expect(await landingDaCampanha(token)).toEqual({ nome: "João", barbearia: "Black Barber", jogo: null });
    expect(m.buscar.mock.calls.map(([args]) => args.where)).toEqual([where, where]);
    await registrarClique(token);
    expect(m.atualizar).toHaveBeenCalledWith({
      where: { ...where, clicouEm: null },
      data: { clicouEm: expect.any(Date) },
    });
  });

  it("leva a indicação à vitrine mesmo com site e painel no mesmo domínio", async () => {
    m.dono.mockResolvedValue({ id: "dono-ficticio" });
    const req = new Request("http://localhost:3000/i/ficticio");
    const res = await indicacao(req, { params: Promise.resolve({ codigo: "ficticio" }) });
    expect(res.headers.get("location")).toBe("http://localhost:3000/assine");
    expect(res.cookies.get("black_indicacao")?.value).toBe("FICTICIO");
  });

  it("omite convites ainda na abertura na consulta de presentes da conversa", async () => {
    m.convite.mockResolvedValue(null);
    expect(await presentesDaConversa("5511900000000")).toMatchObject({ convite: null });
    expect(m.convite).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      clienteId: "cliente-ficticio", status: "ENVIADO",
      OR: [{ aberturaIniciadaEm: null }, { continuacaoReservadaEm: { not: null } }],
    }) }));
  });
});
