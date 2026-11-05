import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ senha: vi.fn(), codigo: vi.fn(), solicitar: vi.fn(), abrir: vi.fn(), trocar: vi.fn(), encerrar: vi.fn(), revogar: vi.fn(), atualizar: vi.fn() }));
vi.mock("@/lib/auth/acesso", () => ({ entrarComSenha: m.senha, trocarPropriaSenha: m.trocar, normalizarLogin: (v: string) => v }));
vi.mock("@/lib/auth/otp", () => ({ verificarCodigo: m.codigo, solicitarCodigo: m.solicitar }));
vi.mock("@/lib/auth/abrir-sessao", () => ({ abrirSessao: m.abrir }));
vi.mock("@/lib/auth/sessao", () => ({ EQUIPE: ["DONO", "GERENTE", "RECEPCAO", "BARBEIRO"], encerrarSessao: m.encerrar,
  exigirSessao: async () => ({ usuarioId: "cliente-teste", papel: "CLIENTE", sessaoVersao: 2 }) }));
vi.mock("@/lib/notificacoes/inscricoes", () => ({ revogarDispositivoAtual: m.revogar }));
vi.mock("@/lib/db", () => ({ db: { usuario: { update: m.atualizar } } }));
import { POST as senha } from "@/app/api/auth/senha/route";
import { POST as entrar } from "@/app/api/auth/entrar/route";
import { POST as codigo } from "@/app/api/auth/codigo/route";
import { PATCH as minhaSenha } from "@/app/api/auth/minha-senha/route";
import { POST as sair } from "@/app/api/auth/sair/route";
import { ErroNegocio } from "@/lib/erros";

const site = "https://cliente.example.test", painel = "https://painel.example.test";
const telefone = "5511999990000";
const origensInvalidas: Record<string, string>[] = [
  { origin: "https://fora.example.test" }, { origin: "null" }, { origin: site, "sec-fetch-site": "cross-site" },
];
const rotas = [
  { nome: "senha", fn: senha, metodo: "POST", corpo: { identificador: telefone, senha: "SenhaTeste!927", area: "cliente" } },
  { nome: "entrar", fn: entrar, metodo: "POST", corpo: { telefone, codigo: "123456", area: "cliente" } },
  { nome: "codigo", fn: codigo, metodo: "POST", corpo: { telefone, area: "cliente" } },
  { nome: "minha-senha", fn: minhaSenha, metodo: "PATCH", corpo: { nova: "SenhaNova!927" } },
] as const;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("SITE_URL", site); vi.stubEnv("PAINEL_URL", painel);
  const usuario = { id: "cliente-teste", papel: "CLIENTE" };
  m.senha.mockResolvedValue(usuario); m.codigo.mockResolvedValue(usuario); m.solicitar.mockResolvedValue(null); m.abrir.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());
function req(nome: string, metodo: string, corpo?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${site}/api/auth/${nome}`, { method: metodo, headers: { origin: site, "content-type": "application/json", ...headers },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }) });
}
function semEfeitos() {
  for (const fn of Object.values(m)) expect(fn).not.toHaveBeenCalled();
}

describe.each(rotas)("proteção HTTP de $nome", ({ nome, fn, metodo, corpo }) => {
  it.each(origensInvalidas)("nega origem inválida antes de autenticar ou alterar credenciais %#", async (headers) => {
    expect((await fn(req(nome, metodo, corpo, headers))).status).toBe(403); semEfeitos();
  });
  it.each([site, painel])("aceita JSON da origem configurada %s", async (origin) => {
    expect((await fn(req(nome, metodo, corpo, { origin }))).status).toBe(200);
  });
  it("recusa JSON em formulário text/plain", async () => {
    expect((await fn(req(nome, metodo, corpo, { "content-type": "text/plain" }))).status).toBe(415); semEfeitos();
  });
  it("limita bytes reais sem confiar em Content-Length", async () => {
    expect((await fn(req(nome, metodo, { ...corpo, ignorado: "x".repeat(33000) }, { "content-length": "1" }))).status).toBe(413); semEfeitos();
  });
});

it("reprodução de login CSRF com credenciais da própria conta não abre sessão", async () => {
  const corpo = '{"identificador":"5511999990000","senha":"SenhaTeste!927","area":"cliente","ignorado":"="}\r\n';
  const pedido = new Request(`${site}/api/auth/senha`, { method: "POST", headers: { origin: "https://fora.example.test", "content-type": "text/plain", "sec-fetch-site": "cross-site" }, body: corpo });
  expect((await senha(pedido)).status).toBe(403); semEfeitos();
});
it("código incorreto permanece 401 recuperável sem criar sessão", async () => {
  m.codigo.mockRejectedValue(new ErroNegocio("Código inválido.", 401, "codigo_invalido"));
  const r = await entrar(req("entrar", "POST", { telefone, codigo: "000000", area: "cliente" }));
  expect(r.status).toBe(401); expect((await r.json()).codigo).toBe("codigo_invalido"); expect(m.abrir).not.toHaveBeenCalled();
});
it("login OTP não permite habilitar criação incompleta por campo extra enviado pelo navegador", async () => {
  m.codigo.mockRejectedValue(new ErroNegocio("Complete seu cadastro.", 409, "cadastro_necessario"));
  const r = await entrar(req("entrar", "POST", { telefone, codigo: "123456", area: "cliente", permitirNovoCadastro: true }));
  expect(r.status).toBe(409); expect((await r.json()).codigo).toBe("cadastro_necessario");
  expect(m.codigo).toHaveBeenCalledWith(telefone, "123456", "cliente"); expect(m.abrir).not.toHaveBeenCalled();
});
it.each([site, painel])("logout legítimo funciona sem corpo em %s", async (origin) => {
  expect((await sair(req("sair", "POST", undefined, { origin }))).status).toBe(200);
  expect(m.revogar).toHaveBeenCalledOnce(); expect(m.encerrar).toHaveBeenCalledOnce();
});
it.each(origensInvalidas)("logout externo não revoga dispositivo nem sessão %#", async (headers) => {
  expect((await sair(req("sair", "POST", undefined, headers))).status).toBe(403); semEfeitos();
});
