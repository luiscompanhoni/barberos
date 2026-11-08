import { beforeEach, describe, expect, it, vi } from "vitest";
type UsuarioFixture = { id: string; ativo: boolean; nome: string; telefone: string; papel: string; sessaoVersao: number;
  telefoneVerificadoEm: Date; senhaHash: string; senhaFalhas: number; bloqueadoAte: Date | null; cliente: null; barbeiro: null; trocarSenha?: boolean };
const m = vi.hoisted(() => ({ usuario: {} as UsuarioFixture, cauda: Promise.resolve() as Promise<unknown>, consultar: vi.fn(), atualizar: vi.fn(), auditar: vi.fn(), lock: vi.fn(), token: { usuarioId: "fixture-u", sessaoVersao: 4 } }));
vi.mock("@/lib/db", () => ({ db: {
  usuario: { findUnique: m.consultar },
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => {
    const atual = m.cauda.catch(() => {}).then(async () => {
      const antes = { ...m.usuario };
      try { return await fn({ $executeRaw: m.lock, usuario: { findUnique: m.consultar, update: m.atualizar } }); }
      catch (e) { m.usuario = antes; throw e; }
    });
    m.cauda = atual.catch(() => {}); return atual;
  },
} }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/whatsapp/canal", () => ({ enviarCodigoAcesso: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "fixture-token" }) }) }));
vi.mock("@/lib/auth/token", () => ({ COOKIE_SESSAO: "fixture", DURACAO_SESSAO_S: 60, lerToken: async () => m.token, assinarToken: vi.fn() }));
import { definirSenhaTemporaria, entrarComSenha, redefinirSenhaTemporaria, trocarPropriaSenha } from "@/lib/auth/acesso";
import { conferirSenha, gerarHash } from "@/lib/auth/senha";
import { sessaoAtual } from "@/lib/auth/sessao";
import { _zerarLimites } from "@/lib/limite";

beforeEach(async () => {
  vi.clearAllMocks(); _zerarLimites(); m.cauda = Promise.resolve(); m.token = { usuarioId: "fixture-u", sessaoVersao: 4 };
  m.usuario = { id: "fixture-u", ativo: true, nome: "Fixture", telefone: "5511999990000", papel: "DONO", sessaoVersao: 4,
    telefoneVerificadoEm: new Date(), senhaHash: await gerarHash("fixture-senha-forte-atual"), senhaFalhas: 0, bloqueadoAte: null, cliente: null, barbeiro: null };
  m.consultar.mockImplementation(async () => ({ ...m.usuario }));
  m.atualizar.mockImplementation(async ({ data }) => {
    const { sessaoVersao, ...resto } = data; Object.assign(m.usuario, resto);
    if (sessaoVersao) m.usuario.sessaoVersao += sessaoVersao.increment;
    return { ...m.usuario };
  });
});

describe("tentativas de senha serializadas", () => {
  it("cinco falhas concorrentes persistem o bloqueio e a próxima senha certa recebe 429", async () => {
    const r = await Promise.allSettled(Array.from({ length: 5 }, () => entrarComSenha("11999990000", "senha-errada", "equipe")));
    expect(r.every(x => x.status === "rejected")).toBe(true);
    expect(m.usuario.senhaFalhas).toBe(0); expect(m.usuario.bloqueadoAte).toBeInstanceOf(Date);
    await expect(entrarComSenha("11999990000", "fixture-senha-forte-atual", "equipe")).rejects.toMatchObject({ status: 429, codigo: "bloqueado" });
    expect(m.lock.mock.calls[0][1]).toBe("auth-usuario:fixture-u");
  });
  it("acerto legítimo depois do prazo remove bloqueio e falhas sem alterar a versão", async () => {
    m.usuario.bloqueadoAte = new Date(Date.now() - 60_000); m.usuario.senhaFalhas = 2;
    expect(await entrarComSenha("11999990000", "fixture-senha-forte-atual", "equipe")).toMatchObject({ id: "fixture-u", sessaoVersao: 4 });
    expect(m.usuario.bloqueadoAte).toBeNull(); expect(m.usuario.senhaFalhas).toBe(0);
  });
  it("relê credencial atual sob a mesma trava do reset", async () => {
    const antiga = { ...m.usuario };
    m.usuario.senhaHash = await gerarHash("fixture-senha-ja-alterada");
    m.consultar.mockResolvedValueOnce(antiga).mockImplementation(async () => ({ ...m.usuario }));
    await expect(entrarComSenha("11999990000", "fixture-senha-forte-atual", "equipe")).rejects.toMatchObject({ status: 401 });
  });
});

describe("revogação de sessões ao trocar credenciais", () => {
  it("a troca incrementa versão, audita e devolve dados para renovar somente a sessão solicitante", async () => {
    const atual = await trocarPropriaSenha("fixture-u", { atual: "fixture-senha-forte-atual", nova: "fixture-senha-forte-nova" }, 4);
    expect(atual.sessaoVersao).toBe(5); expect(await conferirSenha("fixture-senha-forte-nova", m.usuario.senhaHash)).toBe(true);
    expect(m.auditar).toHaveBeenCalledWith(expect.anything(), "fixture-u", "trocar_senha", "usuario", "fixture-u", { revogouSessoes: true });
    expect(await sessaoAtual()).toBeNull(); m.token.sessaoVersao = 5;
    expect(await sessaoAtual()).toMatchObject({ sessaoVersao: 5 });
  });
  it("senha temporária também revoga sessão antiga e preserva o retorno usado pelo teste de login", async () => {
    const temp = await definirSenhaTemporaria("fixture-u");
    expect(typeof temp).toBe("string"); expect(m.usuario.sessaoVersao).toBe(5); expect(m.usuario.trocarSenha).toBe(true);
    expect(await sessaoAtual()).toBeNull(); expect(await conferirSenha(temp, m.usuario.senhaHash)).toBe(true);
  });
  it("reset pelo dono revalida versão antes da gravação e conserva a senha se a sessão foi revogada", async () => {
    await expect(redefinirSenhaTemporaria("fixture-u", { usuarioId: "fixture-u", sessaoVersao: 3 })).rejects.toMatchObject({ status: 403 });
    expect(m.atualizar).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
  });
  it("falha de auditoria desfaz senha e versão na mesma transação", async () => {
    const anterior = m.usuario.senhaHash; m.auditar.mockRejectedValueOnce(new Error("fixture-auditoria"));
    await expect(trocarPropriaSenha("fixture-u", { atual: "fixture-senha-forte-atual", nova: "fixture-senha-forte-nova" }, 4)).rejects.toThrow("fixture-auditoria");
    expect(m.usuario.sessaoVersao).toBe(4); expect(m.usuario.senhaHash).toBe(anterior);
  });
});
