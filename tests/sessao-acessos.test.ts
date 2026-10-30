import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usuario: vi.fn(), lerToken: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "token-antigo" }) }) }));
vi.mock("@/lib/db", () => ({ db: { usuario: { findUnique: mocks.usuario } } }));
vi.mock("@/lib/auth/token", () => ({ lerToken: mocks.lerToken, COOKIE_SESSAO: "teste", DURACAO_SESSAO_S: 60, assinarToken: vi.fn() }));
import { sessaoAtual } from "@/lib/auth/sessao";

beforeEach(() => {
  mocks.lerToken.mockResolvedValue({ usuarioId: "pessoa", papel: "DONO", nome: "Nome antigo", barbeiroId: "antigo", clienteId: null });
});

describe("sessão revalidada após editar acesso", () => {
  it("usa função, nome e agenda atuais mesmo quando o token ainda diz dono", async () => {
    mocks.usuario.mockResolvedValue({ id: "pessoa", nome: "Nome novo", papel: "LIDER", ativo: true, barbeiro: { id: "agenda", ativo: true }, cliente: null });
    expect(await sessaoAtual()).toEqual({ usuarioId: "pessoa", nome: "Nome novo", papel: "LIDER", barbeiroId: "agenda", clienteId: null });
  });
  it("sessão já aberta perde acesso ao desativar o usuário", async () => {
    mocks.usuario.mockResolvedValue({ id: "pessoa", papel: "DONO", ativo: false });
    expect(await sessaoAtual()).toBeNull();
  });
  it("retirar a agenda remove o vínculo de atendimento na sessão", async () => {
    mocks.usuario.mockResolvedValue({ id: "pessoa", nome: "Líder", papel: "LIDER", ativo: true, barbeiro: { id: "agenda", ativo: false }, cliente: null });
    expect((await sessaoAtual())?.barbeiroId).toBeNull();
  });
});
