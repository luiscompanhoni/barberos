import { describe, expect, it } from "vitest";
import { destinoNotificacao } from "@/lib/pwa/urls";
import { manifestoApp } from "@/lib/pwa/manifesto";

describe("destinos das notificações", () => {
  it("preserva caminho permitido e somente parâmetros conhecidos", () => {
    expect(destinoNotificacao("/meu-dia?data=2026-10-28&voltar=https://evil.test")).toBe("/meu-dia?data=2026-10-28");
    expect(destinoNotificacao("/recepcao?barbeiroId=igor&encaixes=1")).toBe("/recepcao?barbeiroId=igor&encaixes=1");
  });
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "/api/auth/sair", "/c/entrar?voltar=https://evil.test", "/%2f%2fevil.test", "/notificacoes\n", "/desconhecido", null, {}])("recusa caminho arbitrário %s", href => {
    expect(destinoNotificacao(href, "cliente")).toBe("/c/notificacoes");
  });
  it("não carrega fragmentos ou parâmetros inválidos", () => {
    expect(destinoNotificacao("/c/avaliacoes?id=%3Cscript%3E#segredo", "cliente")).toBe("/c/avaliacoes");
  });
});

describe("manifests por público", () => {
  it("separa identidade e entrada do aplicativo sem URLs externas", () => {
    const cliente = manifestoApp("cliente"), equipe = manifestoApp("equipe");
    expect(cliente.id).toBe("/c"); expect(cliente.start_url).toBe("/c"); expect(cliente.name).toBe("Black Barber");
    expect(equipe.id).toBe("/painel"); expect(equipe.start_url).toBe("/painel"); expect(equipe.name).toBe("Black Barber Equipe");
    expect(cliente.display).toBe("standalone");
    expect(cliente.icons?.map(i => i.sizes)).toEqual(["192x192", "512x512"]);
    expect(cliente.icons?.every(i => i.src.startsWith("/pwa/"))).toBe(true);
  });
});
