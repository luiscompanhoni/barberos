import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Assinaturas from "@/app/(app)/assinaturas/page";
import { GET } from "@/app/api/assinaturas/route";

const m = vi.hoisted(() => ({ sessao: vi.fn(), exigir: vi.fn(), pode: vi.fn(), localizar: vi.fn(), listar: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirecionou para ${url}`); } }));
vi.mock("@/components/assinaturas/AssinaturasTela", () => ({ AssinaturasTela: () => null }));
vi.mock("@/lib/auth/sessao", () => ({ BALCAO: ["DONO", "GERENTE", "RECEPCAO"], sessaoAtual: m.sessao, exigirSessao: m.exigir }));
vi.mock("@/lib/auth/permissoes", () => ({ pode: m.pode }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/assinaturas/servico", () => ({}));
vi.mock("@/lib/whatsapp/conversas", () => ({}));
vi.mock("@/lib/db", () => ({
  db: { assinatura: { findFirst: m.localizar, findMany: m.listar, groupBy: async () => [],
    aggregate: async () => ({ _sum: { precoCentavos: null } }), count: async () => 0 } },
}));

const abrir = (searchParams: Record<string, string> = {}) =>
  Assinaturas({ searchParams: Promise.resolve(searchParams), params: Promise.resolve({}) }) as Promise<ReactElement>;

beforeEach(() => {
  vi.resetAllMocks();
  m.sessao.mockResolvedValue({ papel: "RECEPCAO" });
  m.pode.mockResolvedValue(false);
  m.localizar.mockResolvedValue(null);
  m.listar.mockResolvedValue([]);
});

describe("acesso da ficha ao módulo de assinaturas", () => {
  it.each([null, { papel: "BARBEIRO" }, { papel: "CLIENTE" }])("recusa sessão fora do balcão: %j", async sessao => {
    m.sessao.mockResolvedValue(sessao);
    await expect(abrir({ clienteId: "cliente-a", assinatura: "a" })).rejects.toThrow("redirecionou para /");
    expect(m.localizar).not.toHaveBeenCalled();
  });

  it("abre o vínculo confirmado do cadastro com as permissões da recepção", async () => {
    m.localizar.mockResolvedValue({ id: "a" });
    expect((await abrir({ clienteId: "cliente-a", assinatura: "a" })).props).toMatchObject({
      clienteId: "cliente-a", assinaturaInicial: "a", podeCancelar: false,
    });
    expect(m.localizar).toHaveBeenCalledWith({ where: { id: "a", clienteId: "cliente-a" }, select: { id: true } });
    expect(m.pode).toHaveBeenCalledWith({ papel: "RECEPCAO" }, "assinatura");
  });

  it("deixa o detalhe fechado se o vínculo não pertence ao cadastro", async () => {
    expect((await abrir({ clienteId: "cliente-a", assinatura: "de-outro-cliente" })).props)
      .toMatchObject({ clienteId: "cliente-a", assinaturaInicial: undefined });
  });

  it("filtra pelo cadastro e preserva os contratos da oferta na tela própria", async () => {
    const res = await GET(new Request("http://localhost/api/assinaturas?clienteId=cliente-a&busca=Joao"));
    expect(res.status).toBe(200);
    expect(m.listar).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { clienteId: "cliente-a", ofertaDezembro: { is: null } } }));
    expect(m.exigir).toHaveBeenCalledWith(["DONO", "GERENTE", "RECEPCAO"]);
  });
});
