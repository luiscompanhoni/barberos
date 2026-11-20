import { isValidElement, type ReactNode, type ReactElement } from "react";
import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ estados: [] as unknown[], cursor: 0, efeitos: [] as (() => void)[], api: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (inicial: unknown) => {
    const i = m.cursor++;
    if (!(i in m.estados)) m.estados[i] = inicial;
    return [m.estados[i], (v: unknown) => { m.estados[i] = typeof v === "function" ? v(m.estados[i]) : v; }];
  },
  useEffect: (fn: () => void) => { m.efeitos.push(fn); },
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("@/lib/cliente-api", () => ({ api: m.api }));
import { PerfilTela } from "@/components/cliente/PerfilTela";
type Elemento = ReactElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void; onSubmit?: (e: { preventDefault: () => void }) => Promise<void> }>;
function elementos(no: ReactNode): Elemento[] {
  if (Array.isArray(no)) return no.flatMap(elementos);
  if (!isValidElement<Elemento["props"]>(no)) return [];
  return [no, ...elementos(no.props.children)];
}
function tela() {
  m.cursor = 0; m.efeitos = [];
  return elementos(PerfilTela({ confirmarSocial: true, voltar: "/c/agendar?premio=p" }));
}
it("aguarda a consulta, permite retentar e só retoma depois da confirmação", async () => {
  const perfil = { nome: "Cliente", telefone: "5511999999999", completo: true };
  const consulta = Promise.withResolvers<unknown>();
  const replace = vi.fn();
  vi.stubGlobal("window", { location: { replace } });
  try {
    m.api.mockResolvedValueOnce(perfil).mockReturnValueOnce(consulta.promise);
    tela(); m.efeitos.forEach(fn => fn());
    await Promise.resolve();
    let itens = tela();
    expect(itens.find(e => e.props.children === "Salvar cadastro")?.props.disabled).toBe(true);
    await itens.find(e => e.type === "form")!.props.onSubmit!({ preventDefault() {} });
    expect(m.api).toHaveBeenCalledTimes(2);
    consulta.reject(new Error("indisponível"));
    await consulta.promise.catch(() => {}); await Promise.resolve();
    itens = tela();
    const tentar = itens.find(e => e.props.children === "Tentar novamente");
    expect(tentar).toBeDefined();
    expect(itens.find(e => e.props.children === "Salvar cadastro")?.props.disabled).toBe(true);
    tentar!.props.onClick!();
    m.api.mockResolvedValueOnce({ pendente: true, provedor: "google" });
    tela(); m.efeitos[1](); await Promise.resolve();
    itens = tela();
    expect(replace).not.toHaveBeenCalled();
    m.api.mockResolvedValueOnce({ ok: true });
    itens.find(e => e.props.children === "Confirmar conexão do acesso")!.props.onClick!();
    await Promise.resolve();
    expect(replace).toHaveBeenCalledWith("/c/agendar?premio=p");
  } finally { vi.unstubAllGlobals(); }
});
