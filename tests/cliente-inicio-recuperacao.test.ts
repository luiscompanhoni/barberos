import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/cliente-api", () => ({ api: m.api }));
import { carregarInicioCliente } from "@/lib/clientes/inicio-cliente";

const agenda = { proximos: [], historico: [], prazoAlteracaoMin: 60 };
const assinatura = { plano: { nome: "Plano teste" }, valida: false, status: "PENDENTE",
  proximoVencimento: null, cobrancaEmAberto: { link: "/pagamento-anterior" }, pausadaAte: null, valeAte: null };
beforeEach(() => {
  m.api.mockReset();
  m.api.mockImplementation(async (url: string) => url.endsWith("/agendamentos") ? agenda
    : url.endsWith("/perfil") ? { nome: "Cliente teste" } : { atual: assinatura });
});
describe("carregamento recuperável da página inicial", () => {
  it.each(["/api/cliente/agendamentos", "/api/cliente/perfil"])("expõe falha de %s e permite nova tentativa", async (alvo) => {
    const padrao = m.api.getMockImplementation()!;
    let falhar = true;
    m.api.mockImplementation(async (url: string) => {
      if (url === alvo && falhar) throw new Error("Falha temporária");
      return padrao(url);
    });
    await expect(carregarInicioCliente()).rejects.toThrow("Falha temporária");
    falhar = false;
    await expect(carregarInicioCliente()).resolves.toMatchObject({ dados: agenda, perfil: { nome: "Cliente teste" } });
  });
  it("falha do plano não afirma que o cliente está sem assinatura", async () => {
    const padrao = m.api.getMockImplementation()!;
    m.api.mockImplementation(async (url: string) => {
      if (url.endsWith("/assinatura")) throw new Error("Plano indisponível");
      return padrao(url);
    });
    const r = await carregarInicioCliente();
    expect(r.plano).toBeUndefined();
    expect(r.dados).toEqual(agenda);
  });
  it("identifica ausência de plano somente quando a consulta a confirma", async () => {
    const padrao = m.api.getMockImplementation()!;
    m.api.mockImplementation(async (url: string) => url.endsWith("/assinatura") ? { atual: null } : padrao(url));
    expect((await carregarInicioCliente()).plano).toBeNull();
  });
  it("oculta link anterior quando a primeira operação está em conferência", async () => {
    const padrao = m.api.getMockImplementation()!;
    m.api.mockImplementation(async (url: string) => url.endsWith("/assinatura")
      ? { atual: { ...assinatura, operacaoEmConferencia: true } } : padrao(url));
    expect((await carregarInicioCliente()).plano).toMatchObject({ link: null, conferindo: true });
  });
  it("preserva link de cobrança disponível fora de conferência", async () => {
    expect((await carregarInicioCliente()).plano).toMatchObject({ link: "/pagamento-anterior", conferindo: false });
  });
});

