import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/lib/cliente-api";
afterEach(() => vi.unstubAllGlobals());
function preparar(path: string) {
  const replace = vi.fn();
  vi.stubGlobal("window", { location: { pathname: path, replace } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ erro: "Código inválido.", codigo: "codigo_invalido" }), { status: 401 })));
  return replace;
}
it("código incorreto no cadastro social mantém o formulário", async () => {
  const replace = preparar("/c/entrar");
  await expect(api("/api/auth/social/concluir", { method: "POST", body: { codigo: "000000" } })).rejects.toMatchObject({ status: 401 });
  expect(replace).not.toHaveBeenCalled();
});
it("sessão expirada no cliente volta ao acesso do cliente", async () => {
  const replace = preparar("/c/agendar");
  await expect(api("/api/cliente/agendamentos")).rejects.toThrow();
  expect(replace).toHaveBeenCalledWith("/c/entrar?voltar=%2Fc%2Fagendar");
});
it("sessão expirada da equipe mantém o login da equipe", async () => {
  const replace = preparar("/clientes");
  await expect(api("/api/clientes/gestao")).rejects.toThrow();
  expect(replace).toHaveBeenCalledWith("/entrar?voltar=%2Fclientes");
});
