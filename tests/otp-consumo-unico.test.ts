import { createHmac } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ consulta: vi.fn(), consumir: vi.fn(), usuario: vi.fn(), atualizar: vi.fn(), salvarUsuario: vi.fn(), apagarIdentidades: vi.fn(), audit: vi.fn(), cliente: vi.fn(), criarUsuario: vi.fn(), vincularCliente: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { codigoLogin: { findFirst: m.consulta, updateMany: m.consumir, update: m.atualizar },
  $transaction: (fn: (tx: unknown) => unknown) => fn({ $executeRaw: vi.fn(), codigoLogin: { findFirst: m.consulta, updateMany: m.consumir, update: m.atualizar }, usuario: { findUnique: m.usuario, findUniqueOrThrow: m.usuario, update: m.salvarUsuario, create: m.criarUsuario }, cliente: { findUnique: m.cliente, upsert: m.vincularCliente }, identidadeSocial: { deleteMany: m.apagarIdentidades } }),
} }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.audit }));
vi.mock("@/lib/whatsapp/canal", () => ({ enviarCodigoAcesso: vi.fn() }));
import { verificarCodigo } from "@/lib/auth/otp";
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("SESSION_SECRET", "segredo-de-teste-com-mais-de-32-caracteres");
  m.cliente.mockResolvedValue(null);
  m.consulta.mockResolvedValue({ id: "otp", codigoHash: createHmac("sha256", process.env.SESSION_SECRET!).update("5547999990000:123456").digest("hex"), expiraEm: new Date(Date.now() + 60000), tentativas: 0 });
});
afterEach(() => vi.unstubAllEnvs());
it("não autentica quando outra tentativa já consumiu o mesmo código", async () => {
  m.consumir.mockResolvedValue({ count: 0 });
  await expect(verificarCodigo("5547999990000", "123456", "cliente")).rejects.toThrow("inválido");
  expect(m.usuario).not.toHaveBeenCalled();
});
it("consome somente um código ainda válido, sem uso e dentro do limite", async () => {
  m.consumir.mockResolvedValue({ count: 1 }); m.usuario.mockResolvedValue({ id: "u1", ativo: true, papel: "CLIENTE", telefoneVerificadoEm: new Date(), cliente: { id: "c1" } });
  expect(await verificarCodigo("5547999990000", "123456", "cliente")).toMatchObject({ id: "u1" });
  expect(m.consumir).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "otp", usadoEm: null, expiraEm: { gt: expect.any(Date) }, tentativas: { lt: 5 } } }));
});
it("a primeira prova remove senha e vínculos do pré-cadastro e revoga todas as sessões anteriores", async () => {
  const preCadastro = { id: "u1", ativo: true, papel: "CLIENTE", telefoneVerificadoEm: null, senhaHash: "senha-do-atacante", sessaoVersao: 0, cliente: { id: "c1" } };
  m.consumir.mockResolvedValue({ count: 1 }); m.usuario.mockResolvedValue(preCadastro);
  m.salvarUsuario.mockResolvedValue({ ...preCadastro, senhaHash: null, telefoneVerificadoEm: new Date(), sessaoVersao: 1 });
  const comprovado = await verificarCodigo("5547999990000", "123456", "cliente");
  expect(comprovado).toMatchObject({ senhaHash: null, sessaoVersao: 1, telefoneVerificadoEm: expect.any(Date) });
  expect(m.apagarIdentidades).toHaveBeenCalledWith({ where: { usuarioId: "u1" } });
  expect(m.salvarUsuario).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ senhaHash: null, sessaoVersao: { increment: 1 }, telefoneVerificadoEm: expect.any(Date) }) }));
});
it.each(["DONO", "BARBEIRO", "RECEPCAO"])("preserva credenciais e sessões da equipe %s", async (papel) => {
  const equipe = { id: "staff", ativo: true, papel, telefoneVerificadoEm: null, senhaHash: "legitima", sessaoVersao: 0 };
  m.consumir.mockResolvedValue({ count: 1 }); m.usuario.mockResolvedValue(equipe);
  expect(await verificarCodigo("5547999990000", "123456", "equipe")).toBe(equipe);
  expect(m.salvarUsuario).not.toHaveBeenCalled(); expect(m.apagarIdentidades).not.toHaveBeenCalled();
});
it("preserva senha e vínculos de cliente já verificado", async () => {
  const cliente = { id: "u1", ativo: true, papel: "CLIENTE", telefoneVerificadoEm: new Date(), senhaHash: "legitima", sessaoVersao: 1, cliente: { id: "c1" } };
  m.consumir.mockResolvedValue({ count: 1 }); m.usuario.mockResolvedValue(cliente);
  expect(await verificarCodigo("5547999990000", "123456", "cliente")).toBe(cliente);
  expect(m.salvarUsuario).not.toHaveBeenCalled(); expect(m.apagarIdentidades).not.toHaveBeenCalled();
});
it("não autentica nem altera credenciais de cliente cuja ficha foi excluída", async () => {
  m.consumir.mockResolvedValue({ count: 1 });
  m.usuario.mockResolvedValue({ id: "u1", ativo: true, papel: "CLIENTE", telefoneVerificadoEm: null, cliente: { id: "c1", excluidoEm: new Date() } });
  await expect(verificarCodigo("5547999990000", "123456", "cliente")).rejects.toMatchObject({ codigo: "codigo_invalido" });
  expect(m.salvarUsuario).not.toHaveBeenCalled(); expect(m.apagarIdentidades).not.toHaveBeenCalled();
});
it("não procura um código antigo depois que o mais recente foi usado", async () => {
  m.consulta.mockResolvedValueOnce({ usadoEm: new Date(), expiraEm: new Date(Date.now() + 60_000), tentativas: 0 });
  await expect(verificarCodigo("5547999990000", "123456", "cliente")).rejects.toMatchObject({ codigo: "codigo_invalido" });
  expect(m.consulta).toHaveBeenCalledWith({ where: { telefone: "5547999990000" }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }] });
  expect(m.consumir).not.toHaveBeenCalled();
});
it("recuperação não aceita código emitido para login", async () => {
  await expect(verificarCodigo("5547999990000", "123456", "cliente", "recuperacao")).rejects.toMatchObject({ codigo: "codigo_invalido" });
  expect(m.atualizar).toHaveBeenCalledWith({ where: { id: "otp" }, data: { tentativas: { increment: 1 } } });
  expect(m.consumir).not.toHaveBeenCalled();
});

it("login comum de número desconhecido consome a prova sem criar ficha incompleta", async () => {
  m.consumir.mockResolvedValue({ count: 1 }); m.usuario.mockResolvedValue(null);
  await expect(verificarCodigo("5547999990000", "123456", "cliente")).rejects.toMatchObject({ status: 409, codigo: "cadastro_necessario" });
  expect(m.consumir).toHaveBeenCalledOnce();
  expect(m.criarUsuario).not.toHaveBeenCalled(); expect(m.vincularCliente).not.toHaveBeenCalled();
});
it("primeiro acesso de cliente importado preserva a ficha mesmo incompleta", async () => {
  const usuario = { id: "u-importado", ativo: true, papel: "CLIENTE", telefoneVerificadoEm: new Date(), cliente: { id: "c-importado" } };
  m.consumir.mockResolvedValue({ count: 1 });
  m.usuario.mockResolvedValueOnce(null).mockResolvedValue(usuario);
  m.cliente.mockResolvedValue({ id: "c-importado", nome: "Cliente importado", usuarioId: null, excluidoEm: null });
  m.criarUsuario.mockResolvedValue({ ...usuario, cliente: null });
  expect(await verificarCodigo("5547999990000", "123456", "cliente")).toEqual(usuario);
  expect(m.criarUsuario).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ nome: "Cliente importado" }) }));
  expect(m.vincularCliente).toHaveBeenCalledWith(expect.objectContaining({ where: { telefone: "5547999990000" }, update: { usuarioId: usuario.id } }));
});
it("fluxo interno de cadastro completo pode criar ficha após provar o celular", async () => {
  const usuario = { id: "u-novo", ativo: true, papel: "CLIENTE", telefoneVerificadoEm: new Date(), cliente: { id: "c-novo" } };
  m.consumir.mockResolvedValue({ count: 1 });
  m.usuario.mockResolvedValueOnce(null).mockResolvedValue(usuario); m.criarUsuario.mockResolvedValue({ ...usuario, cliente: null });
  expect(await verificarCodigo("5547999990000", "123456", "cliente", "acesso", { permitirNovoCadastro: true })).toEqual(usuario);
  expect(m.criarUsuario).toHaveBeenCalledOnce(); expect(m.vincularCliente).toHaveBeenCalledOnce();
});
it("opção interna de cadastro nunca cria membro da equipe por OTP", async () => {
  m.consumir.mockResolvedValue({ count: 1 }); m.usuario.mockResolvedValue(null);
  await expect(verificarCodigo("5547999990000", "123456", "equipe", "acesso", { permitirNovoCadastro: true })).rejects.toMatchObject({ codigo: "codigo_invalido" });
  expect(m.criarUsuario).not.toHaveBeenCalled(); expect(m.vincularCliente).not.toHaveBeenCalled();
});
