import { describe, expect, it } from "vitest";
import { aberturaDaJornada, mensagemDaRetomada, instanteDeRetomada, instanteDeAjudaAposLeitura } from "@/lib/convites/jornada-leonel";
import { destinoDaJornada, tokenDaJornada, tokenDeConvite, ehJornadaComRoleta, previaDaRoleta } from "@/lib/convites/link";

describe("jornadas de campanha do Leonel", () => {
  const site = "http://localhost:3000";
  const agora = new Date("2026-11-22T12:00:00Z");
  const cincoHoras = new Date("2026-11-22T17:00:00Z");
  it("divide o quente em quatro balões e envia o link sozinho no último", () => {
    const quente = tokenDaJornada("quente", "a".repeat(32));
    const morno = tokenDaJornada("morno", "b".repeat(32));
    const link = destinoDaJornada(quente);
    const abertura = aberturaDaJornada("quente", "João Carlos", link);
    expect(abertura).toEqual([
      "Fala, João, tudo bem? Aqui é o Leonel da Black.",
      expect.stringMatching(/^Tem uma notícia boa pra ti!/),
      expect.stringContaining("feedback"),
      link,
    ]);
    expect(abertura.slice(0, -1).every(fala => !fala.includes(link))).toBe(true);
    expect(abertura.join(" ")).not.toMatch(/responda parar/i);
    const aberturaMorno = aberturaDaJornada("morno", "João Carlos", destinoDaJornada(morno));
    expect(aberturaMorno[1]).not.toBe(abertura[1]);
    expect(aberturaMorno.join(" ")).not.toMatch(/responda parar/i);
    expect(new URL(link, site).pathname).toBe("/c/entrar");
    expect(new URL(link, site).searchParams.get("convite")).toBe(quente);
    expect(tokenDeConvite(quente)).toBe(true);
  });
  it.each(["frio", "muitoFrio"] as const)("abre direto na roleta para %s e mantém o token no login posterior", segmento => {
    const token = tokenDaJornada(segmento, "c".repeat(32));
    expect(ehJornadaComRoleta(token)).toBe(true);
    expect(tokenDeConvite(token)).toBe(true);
    expect(new URL(destinoDaJornada(token), site).pathname).toBe(`/c/r/${token}`);
    const falas = aberturaDaJornada(segmento, "João", destinoDaJornada(token));
    expect(falas[1]).toMatch(/gira a roleta/i);
    expect(falas[2]).toBe(destinoDaJornada(token));
    expect(previaDaRoleta(token).openGraph).toMatchObject({ url: destinoDaJornada(token),
      images: [{ url: expect.stringContaining("/previa-roleta-ygor-v1.jpg"), width: 1200, height: 630 }] });
    expect(falas.join(" ")).not.toMatch(/responda parar/i);
  });
  it("espera cinco horas da última atividade e oferece ajuda adequada à etapa", () => {
    expect(instanteDeRetomada(agora)).toEqual(cincoHoras);
    expect(instanteDeAjudaAposLeitura(agora, cincoHoras)).toEqual(new Date("2026-11-22T18:00:00Z"));
    expect(mensagemDaRetomada("João", "cadastro", "/c/entrar")).toContain("cadastro");
    expect(mensagemDaRetomada("João", "roleta", "/c/r/teste")).toContain("girar");
    expect(mensagemDaRetomada("João", "agenda", "/c/entrar")).toContain("horário");
  });
});
