import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  fluxo: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  identidade: { findUnique: vi.fn(), create: vi.fn() }, usuario: { findUnique: vi.fn() },
  cookie: { get: vi.fn(), set: vi.fn() }, verificar: vi.fn(), guardar: vi.fn(), pendente: vi.fn(), limpar: vi.fn(), abrir: vi.fn(), audit: vi.fn(), lock: vi.fn(), otp: vi.fn(), salvarUsuario: vi.fn(), salvarCliente: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { fluxoSocial: m.fluxo, identidadeSocial: m.identidade,
  $transaction: (fn: (tx: unknown) => unknown) => fn({ identidadeSocial: m.identidade, usuario: { ...m.usuario, update: m.salvarUsuario }, cliente: { update: m.salvarCliente }, $executeRaw: m.lock }) } }));
vi.mock("next/headers", () => ({ cookies: async () => m.cookie }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.audit }));
vi.mock("@/lib/auth/abrir-sessao", () => ({ abrirSessao: m.abrir }));
vi.mock("@/lib/auth/otp", () => ({ verificarCodigo: m.otp }));
vi.mock("@/lib/auth/social-cookies", () => ({ COOKIE_SOCIAL_NAVEGADOR: "cookie-browser", guardarIdentidadePendente: m.guardar,
  identidadePendente: m.pendente, limparIdentidadePendente: m.limpar, socialSeguro: () => true }));
vi.mock("@/lib/auth/social-provedores", () => ({ configuracaoSocial: () => ({}), urlAutorizacao: () => "https://provider.example.test", verificarIdentidadeSocial: m.verificar }));
import { concluirCadastroSocial, retornarSocial, vincularSocialDaSessao } from "@/lib/auth/social";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
beforeEach(() => {
  vi.clearAllMocks();
  m.cookie.get.mockReturnValue({ value: "browser-secret" });
  m.fluxo.findUnique.mockResolvedValue({ id: hash("state"), provedor: "google", navegadorHash: hash("browser-secret"), nonce: "nonce", verificador: "v", expiraEm: new Date(Date.now() + 600_000), consumidoEm: null });
  m.fluxo.updateMany.mockResolvedValue({ count: 1 });
  m.verificar.mockResolvedValue({ provedor: "google", subject: "sub-123", email: "same@example.test" });
  m.identidade.findUnique.mockResolvedValue(null);
});

describe("state e vínculo social", () => {
  it("uma identidade criada antes da prova do celular não abre sessão", async () => {
    m.identidade.findUnique.mockResolvedValue({ usuario: { id: "u1", ativo: true, papel: "CLIENTE", telefoneVerificadoEm: null, cliente: { id: "c1" } } });
    expect(await retornarSocial("google", "state", "code")).toBe("/c/entrar?social=pendente");
    expect(m.abrir).not.toHaveBeenCalled();
  });
  it("senha legada sem celular confirmado não autoriza novo vínculo social", async () => {
    m.pendente.mockResolvedValue({ provedor: "google", subject: "sub-123" });
    m.usuario.findUnique.mockResolvedValue({ id: "u1", ativo: true, papel: "CLIENTE", telefoneVerificadoEm: null, cliente: { id: "c1" } });
    await expect(vincularSocialDaSessao("u1", 0)).rejects.toMatchObject({ codigo: "confirmar_celular" });
    expect(m.identidade.create).not.toHaveBeenCalled();
  });
  it("sessão previamente autenticada não vincula depois de revogada durante a requisição", async () => {
    m.pendente.mockResolvedValue({ provedor: "google", subject: "sub-123" });
    m.usuario.findUnique.mockResolvedValue({ id: "u1", ativo: true, papel: "CLIENTE", telefoneVerificadoEm: new Date(), sessaoVersao: 1, cliente: { id: "c1" } });
    await expect(vincularSocialDaSessao("u1", 0)).rejects.toMatchObject({ status: 401 });
    expect(m.identidade.create).not.toHaveBeenCalled();
  });
  it("não vincula por e-mail: identidade desconhecida exige confirmação do cadastro", async () => {
    expect(await retornarSocial("google", "state", "code")).toBe("/c/entrar?social=pendente");
    expect(m.guardar).toHaveBeenCalledWith(expect.objectContaining({ subject: "sub-123" }));
    expect(m.identidade.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { provedor_subject: { provedor: "google", subject: "sub-123" } } }));
    expect(m.abrir).not.toHaveBeenCalled(); expect(m.identidade.create).not.toHaveBeenCalled();
  });
  it("recusa callback de outro navegador antes de consultar o provedor", async () => {
    m.cookie.get.mockReturnValue({ value: "attacker" });
    await expect(retornarSocial("google", "state", "code")).rejects.toThrow("expirou");
    expect(m.verificar).not.toHaveBeenCalled();
  });
  it("recusa replay concorrente por claim atômico", async () => {
    m.fluxo.updateMany.mockResolvedValue({ count: 0 });
    await expect(retornarSocial("google", "state", "code")).rejects.toThrow("expirou");
    expect(m.verificar).not.toHaveBeenCalled();
  });
  it("recusa state de outro provedor", async () => {
    await expect(retornarSocial("apple", "state", "code")).rejects.toThrow("expirou"); expect(m.verificar).not.toHaveBeenCalled();
  });
  it.each(["DONO", "RECEPCAO", "BARBEIRO"])("não abre papel %s pelo login social", async (papel) => {
    m.identidade.findUnique.mockResolvedValue({ usuario: { ativo: true, papel, cliente: { id: "c1" } } });
    await expect(retornarSocial("google", "state", "code")).rejects.toThrow("expirou"); expect(m.abrir).not.toHaveBeenCalled();
  });
  it("não abre usuário desativado", async () => {
    m.identidade.findUnique.mockResolvedValue({ usuario: { ativo: false, papel: "CLIENTE", cliente: { id: "c1" } } });
    await expect(retornarSocial("google", "state", "code")).rejects.toThrow("expirou"); expect(m.abrir).not.toHaveBeenCalled();
  });
  it("não transfere identidade entre contas", async () => {
    m.pendente.mockResolvedValue({ provedor: "google", subject: "sub-123" });
    m.usuario.findUnique.mockResolvedValue({ id: "local-1", ativo: true, papel: "CLIENTE", telefoneVerificadoEm: new Date(), cliente: { id: "c1", excluidoEm: null } });
    m.identidade.findUnique.mockResolvedValue({ usuarioId: "outra-conta", subject: "sub-123" });
    await expect(vincularSocialDaSessao("local-1")).rejects.toThrow("outra conta");
    expect(m.identidade.create).not.toHaveBeenCalled(); expect(m.limpar).not.toHaveBeenCalled();
  });
  it("cadastro social validado permite criar acesso pelo OTP sem exigir senha adicional", async () => {
    const dados = { telefone: "5547999990000", nome: "Cliente social", cpf: "52998224725", email: "social@example.test",
      endereco: "Rua de teste, 123", dataNascimento: new Date("2000-01-01T00:00:00Z") };
    const u = { id: "u-social", ativo: true, papel: "CLIENTE", telefoneVerificadoEm: new Date(), sessaoVersao: 0, cliente: { id: "c-social", excluidoEm: null } };
    m.pendente.mockResolvedValue({ provedor: "google", subject: "sub-novo" }); m.otp.mockResolvedValue(u); m.usuario.findUnique.mockResolvedValue(u);
    await expect(concluirCadastroSocial(dados, "123456")).resolves.toMatchObject({ ok: true });
    expect(m.otp).toHaveBeenCalledWith(dados.telefone, "123456", "cliente", "acesso", { permitirNovoCadastro: true });
    expect(m.salvarCliente).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ...dados, perfilCompletoEm: expect.any(Date) }) }));
    expect(m.abrir).toHaveBeenCalledWith({ ...u, nome: dados.nome });
  });
});
