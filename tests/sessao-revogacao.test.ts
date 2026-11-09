import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ token: vi.fn(), usuario: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "jwt-assinado" }) }) }));
vi.mock("@/lib/db", () => ({ db: { usuario: { findUnique: m.usuario } } }));
vi.mock("@/lib/auth/token", async original => ({ ...await original<typeof import("@/lib/auth/token")>(), COOKIE_SESSAO: "s", DURACAO_SESSAO_S: 100, lerToken: m.token }));
import { sessaoAtual } from "@/lib/auth/sessao";
beforeEach(() => { vi.clearAllMocks(); m.token.mockResolvedValue({ usuarioId: "u1", sessaoVersao: 0 }); });
it("revoga token anterior à primeira prova do celular mesmo que assinatura e prazo ainda sejam válidos", async () => {
  m.usuario.mockResolvedValue({ id: "u1", ativo: true, papel: "CLIENTE", sessaoVersao: 1, cliente: { id: "c1", excluidoEm: null } });
  expect(await sessaoAtual()).toBeNull();
});
it("tokens legados sem versão são zero e também perdem acesso após a prova", async () => {
  m.token.mockResolvedValue({ usuarioId: "u1" });
  m.usuario.mockResolvedValue({ id: "u1", ativo: true, papel: "CLIENTE", sessaoVersao: 1, cliente: { id: "c1", excluidoEm: null } });
  expect(await sessaoAtual()).toBeNull();
});
it.each(["CLIENTE", "DONO"])("preserva sessão legada %s até revogação explícita", async (papel) => {
  m.token.mockResolvedValue({ usuarioId: "u1" });
  m.usuario.mockResolvedValue({ id: "u1", ativo: true, papel, sessaoVersao: 0, cliente: papel === "CLIENTE" ? { id: "c1", excluidoEm: null } : null });
  expect(await sessaoAtual()).toMatchObject({ usuarioId: "u1", sessaoVersao: 0 });
});
it("aceita apenas versão atual revalidada no banco", async () => {
  m.token.mockResolvedValue({ usuarioId: "u1", sessaoVersao: 1 });
  m.usuario.mockResolvedValue({ id: "u1", ativo: true, papel: "CLIENTE", sessaoVersao: 1, cliente: { id: "c1", excluidoEm: null } });
  expect(await sessaoAtual()).toMatchObject({ usuarioId: "u1", sessaoVersao: 1 });
});
