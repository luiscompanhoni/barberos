import type { Papel } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Clientes from "@/app/(app)/clientes/page";
import Convites from "@/app/(app)/conversas/convites/page";
import Recompras from "@/app/(app)/recompras/page";

const mocks = vi.hoisted(() => ({
  usuario: vi.fn(),
  relatorio: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => { throw new Error(`REDIRECT:${destino}`); },
}));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/lib/db", () => ({ db: { usuario: { findUnique: mocks.usuario } } }));
vi.mock("@/lib/auth/token", () => ({
  tokenDoCookie: () => "token",
  lerToken: async () => ({ usuarioId: "usuario" }),
}));
vi.mock("@/lib/convites/relatorio", () => ({ relatorioConvites: mocks.relatorio }));
vi.mock("@/components/clientes/ClientesTela", () => ({ ClientesTela: () => null }));
vi.mock("@/components/recompras/RecomprasConfiguracao", () => ({ RecomprasConfiguracao: () => null }));

const convites = () => Convites({
  searchParams: Promise.resolve({ pagina: "2" }),
  params: Promise.resolve({}),
});

const papeis: Papel[] = ["DONO", "GERENTE", "RECEPCAO", "LIDER", "BARBEIRO", "CLIENTE"];
const paginas = [
  { rota: "/recompras", abrir: Recompras, permitidos: ["DONO"] },
  { rota: "/clientes", abrir: Clientes, permitidos: ["DONO", "GERENTE", "RECEPCAO"] },
  { rota: "/conversas/convites", abrir: convites, permitidos: ["DONO", "GERENTE"] },
];

describe.each(paginas)("entrada direta em $rota", ({ rota, abrir, permitidos }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.relatorio.mockResolvedValue({ totais: { total: 0 }, linhas: [] });
  });

  it("encaminha a sessão ausente para o login", async () => {
    mocks.usuario.mockResolvedValue(null);
    await expect(abrir()).rejects.toThrow(new Error("REDIRECT:/entrar"));
    expect(mocks.relatorio).not.toHaveBeenCalled();
  });

  it.each(papeis)("%s segue as permissões da página", async (papel) => {
    mocks.usuario.mockResolvedValue({
      id: "usuario",
      ativo: true,
      papel,
      cliente: papel === "CLIENTE" ? { id: "cliente" } : null,
    });

    if (permitidos.includes(papel)) {
      await expect(abrir()).resolves.toMatchObject({ props: expect.any(Object) });
      if (rota === "/conversas/convites") expect(mocks.relatorio).toHaveBeenCalledExactlyOnceWith(2);
    } else {
      const destino = papel === "CLIENTE" ? "/c" : "/";
      await expect(abrir()).rejects.toThrow(new Error(`REDIRECT:${destino}`));
      expect(mocks.relatorio).not.toHaveBeenCalled();
    }
  });
});
