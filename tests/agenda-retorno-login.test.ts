import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import LayoutCliente from "@/app/c/(area)/layout";

const m = vi.hoisted(() => ({ sessao: vi.fn(), lerToken: vi.fn(), headers: new Headers() }));
vi.mock("@/lib/auth/token", () => ({ tokenDoCookie: () => undefined, lerToken: m.lerToken }));
vi.mock("@/lib/auth/sessao", () => ({ sessaoAtual: m.sessao }));
vi.mock("next/headers", () => ({ headers: async () => m.headers }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));

const caminho = "/c/agendar?servico=corte";
beforeEach(() => {
  m.headers.delete("x-barberos-retorno");
  m.sessao.mockReset();
  m.lerToken.mockReset();
});

describe("retorno à agenda após identificar a conta", () => {
  it.each([["sessão da equipe", { papel: "RECEPCAO" }], ["sessão expirada", null]] as const)(
    "%s volta ao login com a seleção original", async (_, sessao) => {
      m.lerToken.mockResolvedValue({ papel: "RECEPCAO" });
      const resposta = await proxy(new NextRequest("http://localhost" + caminho));
      const voltar = resposta.headers.get("x-middleware-request-x-barberos-retorno");
      expect(voltar).toBe(caminho);
      m.headers.set("x-barberos-retorno", voltar!);
      m.sessao.mockResolvedValue(sessao);
      const busca = new URLSearchParams({ voltar: caminho, confirmar: "1" });
      if (sessao) busca.set("conta", "cliente");
      await expect(LayoutCliente({ children: null })).rejects.toThrow("/c/entrar?" + busca);
    },
  );
});
