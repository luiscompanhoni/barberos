import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usuario: vi.fn(), lerToken: vi.fn(), gravarCookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "token-antigo" }), set: mocks.gravarCookie }) }));
vi.mock("@/lib/db", () => ({ db: { usuario: { findUnique: mocks.usuario } } }));
vi.mock("@/lib/auth/token", async original => ({ ...await original<typeof import("@/lib/auth/token")>(), lerToken: mocks.lerToken, COOKIE_SESSAO: "teste", DURACAO_SESSAO_S: 60, assinarToken: vi.fn() }));
import { criarSessao, sessaoAtual } from "@/lib/auth/sessao";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lerToken.mockResolvedValue({ usuarioId: "pessoa", papel: "DONO", nome: "Nome antigo", barbeiroId: "antigo", clienteId: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("sessão revalidada após editar acesso", () => {
  it("usa função, nome e agenda atuais mesmo quando o token ainda diz dono", async () => {
    mocks.usuario.mockResolvedValue({ id: "pessoa", nome: "Nome novo", papel: "LIDER", ativo: true, barbeiro: { id: "agenda", ativo: true }, cliente: null });
    expect(await sessaoAtual()).toEqual({ usuarioId: "pessoa", nome: "Nome novo", papel: "LIDER", barbeiroId: "agenda", clienteId: null, sessaoVersao: 0 });
  });
  it("sessão já aberta perde acesso ao desativar o usuário", async () => {
    mocks.usuario.mockResolvedValue({ id: "pessoa", papel: "DONO", ativo: false });
    expect(await sessaoAtual()).toBeNull();
  });
  it("retirar a agenda remove o vínculo de atendimento na sessão", async () => {
    mocks.usuario.mockResolvedValue({ id: "pessoa", nome: "Líder", papel: "LIDER", ativo: true, barbeiro: { id: "agenda", ativo: false }, cliente: null });
    expect((await sessaoAtual())?.barbeiroId).toBeNull();
  });
  it.each([null, { id: "cliente-excluido", excluidoEm: new Date() }])("não mantém sessão de cliente sem ficha disponível", async cliente => {
    mocks.usuario.mockResolvedValue({ id: "pessoa", nome: "Cliente", papel: "CLIENTE", ativo: true, cliente });
    expect(await sessaoAtual()).toBeNull();
  });
  it("recusa domínio incompatível antes de emitir um cookie que causaria login em ciclo", async () => {
    vi.stubEnv("SITE_URL", "https://black.invalid"); vi.stubEnv("PAINEL_URL", "https://outro.invalid");
    await expect(criarSessao({ usuarioId: "u", papel: "DONO", nome: "Teste", clienteId: null, barbeiroId: null })).rejects.toMatchObject({ codigo: "dominios_incompativeis" });
    expect(mocks.gravarCookie).not.toHaveBeenCalled();
  });
});
