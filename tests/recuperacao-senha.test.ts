import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ verificar: vi.fn(), solicitar: vi.fn(), usuario: vi.fn(), atualizar: vi.fn(), audit: vi.fn(), abrir: vi.fn() }));
vi.mock("@/lib/auth/otp", () => ({ verificarCodigo: m.verificar, solicitarCodigo: m.solicitar }));
vi.mock("@/lib/db", () => ({ db: { $transaction: (fn: (tx: unknown) => unknown) => fn({ $executeRaw: vi.fn(), usuario: { findUnique: m.usuario, update: m.atualizar } }) } }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.audit }));
vi.mock("@/lib/auth/abrir-sessao", () => ({ abrirSessao: m.abrir }));
import { recuperarSenhaCliente } from "@/lib/auth/recuperacao";
import { POST } from "@/app/api/auth/recuperar-senha/route";
import { conferirSenha } from "@/lib/auth/senha";
const telefone = "5511999990000";
const usuario = { id: "u", ativo: true, papel: "CLIENTE", telefone, telefoneVerificadoEm: new Date(), sessaoVersao: 4, cliente: { id: "c", excluidoEm: null }, senhaHash: "anterior" };
const dados = { telefone, codigo: "123456", senha: "SenhaNova!927" };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("SITE_URL", "https://cliente.example.test");
  m.verificar.mockResolvedValue(usuario); m.usuario.mockResolvedValue(usuario);
  m.atualizar.mockResolvedValue({ ...usuario, sessaoVersao: 5 }); m.abrir.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());
const req = (b: unknown, origin = "https://cliente.example.test") => new Request("https://cliente.example.test/api/auth/recuperar-senha", { method: "POST", headers: { origin }, body: JSON.stringify(b) });

it("recupera sem senha anterior, exige OTP próprio e revoga sessões", async () => {
  const u = await recuperarSenhaCliente(dados);
  expect(m.verificar).toHaveBeenCalledWith(telefone, "123456", "cliente", "recuperacao");
  const alteracao = m.atualizar.mock.calls[0][0].data;
  expect(alteracao).toMatchObject({ sessaoVersao: { increment: 1 }, senhaFalhas: 0, bloqueadoAte: null, trocarSenha: false });
  expect(await conferirSenha(dados.senha, alteracao.senhaHash)).toBe(true);
  expect(u.sessaoVersao).toBe(5);
  expect(m.audit).toHaveBeenCalledWith(expect.anything(), "u", "cliente_recuperar_senha", "usuario", "u", { revogouSessoes: true });
});
it.each([{ ativo: false }, { sessaoVersao: 5 }, { papel: "DONO" }, { cliente: { id: "c", excluidoEm: new Date() } }])("revalida conta sob lock depois do código %#", async (mudanca) => {
  m.usuario.mockResolvedValue({ ...usuario, ...mudanca });
  await expect(recuperarSenhaCliente(dados)).rejects.toMatchObject({ status: 401 });
  expect(m.atualizar).not.toHaveBeenCalled();
});
it("senha fraca não consome a prova de celular", async () => {
  await expect(recuperarSenhaCliente({ ...dados, senha: "123" })).rejects.toThrow();
  expect(m.verificar).not.toHaveBeenCalled();
});
it("rota nega origem externa e campos privilegiados antes do OTP", async () => {
  expect((await POST(req({ acao: "codigo", telefone }, "https://evil.example.test"))).status).toBe(403);
  expect((await POST(req({ acao: "codigo", telefone, papel: "DONO" }))).status).toBe(400);
  expect(m.solicitar).not.toHaveBeenCalled();
});
it("abre sessão na versão nova e mantém pedido de código sem enumerar conta", async () => {
  m.solicitar.mockResolvedValue(null);
  const r = await POST(req({ acao: "codigo", telefone }));
  expect(r.status).toBe(200); expect(await r.json()).toEqual({ ok: true, mensagem: "Se o número tiver uma conta de cliente, o código foi enviado." });
  expect(m.solicitar).toHaveBeenCalledWith(telefone, "cliente", "recuperacao");
  expect((await POST(req({ acao: "redefinir", ...dados }))).status).toBe(200);
  expect(m.abrir).toHaveBeenCalledWith(expect.objectContaining({ sessaoVersao: 5 }));
});
