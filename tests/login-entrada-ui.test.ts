import { Children, createElement, isValidElement, type ChangeEvent, type ClipboardEvent, type FormEvent, type InputHTMLAttributes, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, busca: new URLSearchParams(), replace: vi.fn(), refresh: vi.fn(),
  social: null as null | { entrarComSenha: () => void; voltarAoLogin: () => void },
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useRef: (inicial: unknown) => ({ current: inicial }),
  useEffect: () => {},
  useState: (inicial: unknown) => {
    const i = m.cursor++;
    if (!(i in m.states)) m.states[i] = inicial;
    return [m.states[i], (v: unknown) => { m.states[i] = typeof v === "function" ? v(m.states[i]) : v; }];
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: m.replace, refresh: m.refresh }), useSearchParams: () => m.busca }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children) }));
vi.mock("@/components/Marca", () => ({ Marca: () => null }));
vi.mock("@/components/login/CadastroSocial", () => ({ CadastroSocial: (props: NonNullable<typeof m.social>) => { m.social = props; return createElement("p", null, "CADASTRO_SOCIAL"); } }));
import { CaixasCodigo } from "@/components/login/CaixasCodigo";
import { FormularioLogin } from "@/components/login/FormularioLogin";

beforeEach(() => { vi.clearAllMocks(); m.states = []; m.cursor = 0; m.busca = new URLSearchParams(); m.social = null; });
afterEach(() => vi.unstubAllGlobals());
function caixas(valor: string) {
  const mudar = vi.fn();
  const elemento = CaixasCodigo({ valor, onChange: mudar }) as ReactElement<{ children: ReactElement<InputHTMLAttributes<HTMLInputElement>>[] }>;
  return { mudar, inputs: elemento.props.children.map(e => e.props) };
}
function elementoLogin(codigoDisponivel = true) {
  m.cursor = 0;
  return FormularioLogin({ area: "cliente", titulo: "Black teste", subtitulo: "Cliente", destinoPadrao: "/c", codigoDisponivel });
}
function renderLogin(codigoDisponivel = true) {
  return renderToStaticMarkup(elementoLogin(codigoDisponivel));
}
function encontrarElemento<P>(raiz: ReactNode, tipo: ReactElement["type"]): ReactElement<P> | undefined {
  for (const filho of Children.toArray(raiz)) {
    if (!isValidElement<{ children?: ReactNode }>(filho)) continue;
    if (filho.type === tipo) return filho as ReactElement<P>;
    const encontrado = encontrarElemento<P>(filho.props.children, tipo);
    if (encontrado) return encontrado;
  }
}
describe("modo inicial vindo da área do cliente (confirmar=1)", () => {
  it("orienta a usar o cadastro de cliente quando a sessão anterior é da equipe", () => {
    m.busca = new URLSearchParams({ confirmar: "1", voltar: "/c/agendar", conta: "cliente" });
    expect(renderLogin(true)).toContain("Esta conta é da equipe.");
  });
  it("abre em receber código quando o envio do código está ligado", () => {
    m.busca = new URLSearchParams({ confirmar: "1", voltar: "/c/agendar" });
    const html = renderLogin(true);
    expect(html).toContain("Receber código"); expect(html).not.toContain('id="senha"');
  });
  it("mantém a senha quando o código não pode ser enviado", () => {
    m.busca = new URLSearchParams({ confirmar: "1", voltar: "/c/agendar" });
    const html = renderLogin(false);
    expect(html).toContain('id="senha"'); expect(html).not.toContain("Receber código");
  });
});
it.each(["/c?aba=horarios", "/c/dezembro-gratis"])("reabre %s em uma nova navegação após validar o código", async (voltar) => {
  m.busca = new URLSearchParams({ confirmar: "1", voltar });
  const navegar = vi.fn();
  vi.stubGlobal("window", { location: { origin: "http://localhost", replace: navegar } });
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ codigoTeste: "123456" }))
    .mockResolvedValueOnce(Response.json({ papel: "CLIENTE", base: "http://localhost" })));

  function tela(): ReactNode {
    const formulario = elementoLogin().props.children[1];
    return formulario.type(formulario.props);
  }
  function enviar() {
    const form = encontrarElemento<{ onSubmit: (evento: FormEvent) => void }>(tela(), "form");
    form!.props.onSubmit({ preventDefault() {} } as FormEvent);
  }

  const telefone = encontrarElemento<InputHTMLAttributes<HTMLInputElement>>(tela(), "input");
  telefone!.props.onChange!({ target: { value: "47999990000" } } as ChangeEvent<HTMLInputElement>);
  enviar();
  const otp = () => encontrarElemento<Parameters<typeof CaixasCodigo>[0]>(tela(), CaixasCodigo);
  await vi.waitFor(() => expect(otp()).toBeDefined());
  otp()!.props.onChange("123456");
  enviar();
  await vi.waitFor(() => expect(navegar.mock.calls.length + m.replace.mock.calls.length).toBe(1));
  expect(navegar).toHaveBeenCalledWith(voltar);
  expect(m.refresh).not.toHaveBeenCalled();
});
describe("código de acesso no celular", () => {
  it.each(["", "12", "654321"])("aceita autofill de seis dígitos sobre '%s'", atual => {
    const c = caixas(atual);
    c.inputs[0].onChange!({ target: { value: "123456" } } as ChangeEvent<HTMLInputElement>);
    expect(c.mudar).toHaveBeenCalledWith("123456");
  });
  it("mantém colagem integral e limpa separadores", () => {
    const c = caixas("99"), prevenir = vi.fn();
    c.inputs[3].onPaste!({ preventDefault: prevenir, clipboardData: { getData: () => "123 456" } } as unknown as ClipboardEvent<HTMLInputElement>);
    expect(prevenir).toHaveBeenCalledOnce(); expect(c.mudar).toHaveBeenCalledWith("123456");
  });
  it("digita e corrige um dígito sem descartar os demais", () => {
    const vazio = caixas(""); vazio.inputs[0].onChange!({ target: { value: "1" } } as ChangeEvent<HTMLInputElement>);
    expect(vazio.mudar).toHaveBeenCalledWith("1");
    const cheio = caixas("123456"); cheio.inputs[2].onChange!({ target: { value: "9" } } as ChangeEvent<HTMLInputElement>);
    expect(cheio.mudar).toHaveBeenCalledWith("129456");
    cheio.inputs[2].onChange!({ target: { value: "39" } } as ChangeEvent<HTMLInputElement>);
    expect(cheio.mudar).toHaveBeenLastCalledWith("129456");
  });
  it("preserva apagar e voltar de uma caixa vazia", () => {
    const c = caixas("123"), prevenir = vi.fn();
    c.inputs[3].onKeyDown!({ key: "Backspace", preventDefault: prevenir } as unknown as KeyboardEvent<HTMLInputElement>);
    expect(prevenir).toHaveBeenCalledOnce(); expect(c.mudar).toHaveBeenCalledWith("12");
  });
});
describe("retorno do cadastro social", () => {
  it.each([
    ["", "/c/entrar"],
    ["/c/agendar?servico=corte", "/c/entrar?voltar=%2Fc%2Fagendar%3Fservico%3Dcorte"],
    ["//externo.invalid", "/c/entrar"],
  ])("sai sem remontar o formulário e preserva apenas retorno seguro: %s", (voltar, destino) => {
    m.busca = new URLSearchParams({ social: "pendente", ...(voltar ? { voltar } : {}) });
    expect(renderLogin()).toContain("CADASTRO_SOCIAL");
    m.social!.voltarAoLogin();
    expect(m.replace).toHaveBeenCalledWith(destino);
    m.busca = new URL(destino, "https://local.invalid").searchParams;
    const html = renderLogin();
    expect(html).not.toContain("CADASTRO_SOCIAL"); expect(html).toContain('id="senha"');
    expect(m.refresh).not.toHaveBeenCalled();
  });
  it("entrar com senha preserva o vínculo social pendente para confirmação posterior", () => {
    m.busca = new URLSearchParams({ social: "pendente" }); renderLogin();
    m.social!.entrarComSenha();
    expect(renderLogin()).toContain('id="senha"'); expect(m.replace).not.toHaveBeenCalled();
    expect(m.busca.get("social")).toBe("pendente");
  });
  it("o retorno fica disponível também quando o acesso social expirou", async () => {
    const { CadastroSocial } = await vi.importActual<typeof import("@/components/login/CadastroSocial")>("@/components/login/CadastroSocial");
    const voltar = vi.fn();
    const props = { codigoDisponivel: true, entrarComSenha: vi.fn(), voltarAoLogin: voltar };
    CadastroSocial(props); m.states[5] = false; m.cursor = 0;
    const tela = CadastroSocial(props) as ReactElement<{ children: ReactElement<{ children: ReactNode; onClick?: () => void; disabled?: boolean }>[] }>;
    const botao = tela.props.children.find(e => e?.props?.children === "Voltar ao login")!;
    expect(botao.type).toBe("button"); expect(botao.props.disabled).toBe(false);
    botao.props.onClick!(); expect(voltar).toHaveBeenCalledOnce();
  });
});
