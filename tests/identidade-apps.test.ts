import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Marca } from "@/components/Marca";
import { Navegacao } from "@/components/Navegacao";
import { AberturaBlack } from "@/components/visual/AberturaBlack";

vi.stubGlobal("React", React);
const caminho = vi.hoisted(() => ({ atual: "/minha-agenda" }));
vi.mock("next/navigation", () => ({ usePathname: () => caminho.atual, useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

describe("identidade dos aplicativos e da gestão", () => {
  it("usa a marca vetorial transparente da barbearia por padrão", () => {
    const html = renderToStaticMarkup(React.createElement(Marca, { nome: "Black Barber", tamanho: "lg" }));
    expect(html).toContain('/brand/black/logo-horizontal.svg');
    expect(html).toContain('alt="Black Barber"');
    expect(html).not.toContain('/brand/barberos');
  });
  it.each(["BARBEIRO", "LIDER"])("mantém marca e navegação Black para %s", papel => {
    const html = renderToStaticMarkup(React.createElement(Navegacao, {
      nome: "Exemplo", papel, nomeBarbearia: "Black Barber", links: [{ href: "/minha-agenda", rotulo: "Minha agenda" }],
    }));
    expect(html).toContain('/brand/black/logo-horizontal.svg');
    expect(html).not.toContain('/brand/barberos');
    expect(html).not.toContain('Expandir menu');
    expect(html).toContain('href="/minha-agenda"');
  });
  it.each(["DONO", "GERENTE", "RECEPCAO"])("preserva a identificação do BarberOS na gestão para %s", papel => {
    const html = renderToStaticMarkup(React.createElement(Navegacao, {
      nome: "Exemplo", papel, nomeBarbearia: "Black Barber", links: [{ href: "/painel", rotulo: "Visão geral" }],
    }));
    expect(html).toContain('/brand/barberos-app.svg');
    expect(html).toContain('alt="BarberOS"');
    expect(html).not.toContain('/brand/black/logo-horizontal.svg');
    expect(html).toContain('Expandir menu');
  });
  it.each(["/c/agendar", "/c/perfil", "/c/pagar/token"])("não coloca a abertura sobre formulários do cliente em %s", url => {
    caminho.atual = url;
    expect(renderToStaticMarkup(React.createElement(AberturaBlack, { area: "cliente" }))).toBe("");
  });
  it("abre o cliente com a fachada e o acesso real ao agendamento", () => {
    caminho.atual = "/c";
    const html = renderToStaticMarkup(React.createElement(AberturaBlack, { area: "cliente" }));
    expect(html).toContain(encodeURIComponent('/brand/black/fachada.webp'));
    expect(html).toContain('href="/c/agendar"');
    expect(html).toContain('/brand/black/logo-horizontal.svg');
    expect(html).not.toContain('Cliente exemplo');
  });
  it("não exibe uma abertura de barbeiro no painel administrativo", () => {
    caminho.atual = "/painel";
    expect(renderToStaticMarkup(React.createElement(AberturaBlack, { area: "barbeiro" }))).toBe("");
  });
  it("preserva o destino da agenda na abertura do barbeiro", () => {
    caminho.atual = "/meu-dia";
    const html = renderToStaticMarkup(React.createElement(AberturaBlack, { area: "barbeiro" }));
    expect(html).toContain('href="/minha-agenda"');
    expect(html).toContain('Seu dia começa aqui.');
  });
});
