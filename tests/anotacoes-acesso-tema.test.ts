import { afterEach, describe, expect, it, vi } from "vitest";
import { destinoDoPerfil } from "@/lib/auth/destino";
import { acessoUnicoCompativel, dominioDaSessao } from "@/lib/dominios";
import { COOKIE_SESSAO, COOKIE_SESSAO_LEGADA, tokenDoCookie } from "@/lib/auth/token";
import { resolverTema } from "@/lib/visual/tema";
import { agruparLinks } from "@/components/navegacao/estrutura";
import { schemaPlano } from "@/lib/assinaturas/schemas";

afterEach(() => vi.unstubAllEnvs());
describe("acesso único pelo perfil registrado", () => {
  it.each([["CLIENTE", "/painel", "/c"], ["BARBEIRO", "/c", "/minha-agenda"], ["DONO", "/c/agendar", "/painel"], ["RECEPCAO", "/entrar", "/recepcao"], ["LIDER", "//externo.invalid", "/minha-agenda"]])("%s ignora retorno de outra área", (papel, voltar, esperado) => {
    expect(destinoDoPerfil(papel, voltar)).toBe(esperado);
  });
  it("mantém retorno de trabalho e impede login recursivo ou chamada API pelo redirecionamento", () => {
    expect(destinoDoPerfil("DONO", "/estudio?projeto=1")).toBe("/estudio?projeto=1");
    expect(destinoDoPerfil("DONO", "/api/auth/sair")).toBe("/painel");
    expect(destinoDoPerfil("CLIENTE", "/c/entrar?voltar=/c")).toBe("/c");
  });
  it("compartilha sessão apenas com o subdomínio HTTPS configurado", () => {
    vi.stubEnv("SITE_URL", "https://appblackbarber.com"); vi.stubEnv("PAINEL_URL", "https://painel.appblackbarber.com");
    expect(dominioDaSessao()).toBe("appblackbarber.com");
    vi.stubEnv("PAINEL_URL", "https://outroappblackbarber.com"); expect(dominioDaSessao()).toBeUndefined();
    vi.stubEnv("SITE_URL", "http://localhost:3019"); vi.stubEnv("PAINEL_URL", "http://painel.localhost:3019"); expect(dominioDaSessao()).toBeUndefined();
  });
  it("mantém cookie legado, mas nunca ressuscita a sessão depois do logout novo", () => {
    const valores: Record<string, string> = { [COOKIE_SESSAO_LEGADA]: "antigo" };
    const jar = { get: (nome: string) => nome in valores ? { value: valores[nome] } : undefined };
    expect(tokenDoCookie(jar)).toBe("antigo"); valores[COOKIE_SESSAO] = "novo"; expect(tokenDoCookie(jar)).toBe("novo");
    valores[COOKIE_SESSAO] = ""; expect(tokenDoCookie(jar)).toBe("");
  });
  it.each([
    ["http://localhost:3019", "http://localhost:3020", true],
    ["https://appblackbarber.com", "https://painel.appblackbarber.com", true],
    ["http://localhost:3019", "http://painel.localhost:3019", false],
    ["https://black.invalid", "https://outro.invalid", false],
    ["https://black.invalid", "http://black.invalid", false],
  ])("valida compartilhamento de sessão entre %s e %s", (site, painel, compativel) => {
    vi.stubEnv("SITE_URL", site); vi.stubEnv("PAINEL_URL", painel);
    expect(acessoUnicoCompativel()).toBe(compativel);
  });
});

describe("aparência e organização", () => {
  it("persiste posição do plano e recusa posições fora do intervalo", () => {
    expect(schemaPlano.partial().parse({ ordem: 8 })).toEqual({ ordem: 8 });
    expect(schemaPlano.partial().safeParse({ ordem: -1 }).success).toBe(false);
    expect(schemaPlano.partial().safeParse({ ordem: 1.5 }).success).toBe(false);
  });
  it.each([["2026-11-09T02:59:59-03:00", "espacial"], ["2026-11-09T06:00:00-03:00", "claro"], ["2026-11-09T17:59:59-03:00", "claro"], ["2026-11-09T18:00:00-03:00", "escuro"], ["2026-11-10T00:00:00-03:00", "espacial"]])("automático respeita o horário de São Paulo em %s", (instante, esperado) => {
    expect(resolverTema("automatico", new Date(instante))).toBe(esperado);
  });
  it("a escolha explícita não muda com a hora", () => { expect(resolverTema("claro", new Date("2026-11-09T03:00Z"))).toBe("claro"); });
  it("agentes ficam em Criações e indicadores em Financeiro, sem criar permissões", () => {
    const links = ["/agentes", "/estudio", "/indicadores", "/financeiro"].map(href => ({ href, rotulo: href }));
    const grupos = agruparLinks(links);
    expect(grupos.find(g => g.titulo === "Criações")?.itens.map(l => l.href)).toEqual(["/agentes", "/estudio"]);
    expect(grupos.find(g => g.titulo === "Financeiro")?.itens.map(l => l.href)).toEqual(["/indicadores", "/financeiro"]);
    expect(agruparLinks([])).toEqual([]);
  });
});
