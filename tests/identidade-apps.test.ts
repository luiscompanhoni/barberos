import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Marca } from "@/components/Marca";
import { Navegacao } from "@/components/Navegacao";

vi.stubGlobal("React", React);
vi.mock("next/navigation", () => ({ usePathname: () => "/minha-agenda", useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

describe("identidade dos aplicativos e da gestão", () => {
  it("usa a arte original da barbearia nos pontos públicos por padrão", () => {
    const html = renderToStaticMarkup(React.createElement(Marca, { nome: "Black Barber", tamanho: "lg" }));
    expect(html).toContain('/brand/black/logo-original.png');
    expect(html).toContain('alt="Black Barber"');
    expect(html).not.toContain('/brand/barberos');
  });
  it.each(["BARBEIRO", "LIDER"])("mantém marca e navegação Black para %s", papel => {
    const html = renderToStaticMarkup(React.createElement(Navegacao, {
      nome: "Exemplo", papel, nomeBarbearia: "Black Barber", links: [{ href: "/minha-agenda", rotulo: "Minha agenda" }],
    }));
    expect(html).toContain('/brand/black/logo-original.png');
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
    expect(html).not.toContain('/brand/black/logo-original.png');
    expect(html).toContain('Expandir menu');
  });
});
