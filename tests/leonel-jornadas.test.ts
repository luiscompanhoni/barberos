import { describe, expect, it } from "vitest";
import { aberturaDaJornada, mensagemDaRetomada, instanteDeRetomada } from "@/lib/convites/jornada-leonel";
import { destinoDaJornada, tokenDaJornada, tokenDeConvite, ehJornadaComRoleta } from "@/lib/convites/link";

describe("jornadas de campanha do Leonel", () => {
  const site = "http://localhost:3000";
  const agora = new Date("2026-11-22T12:00:00Z");
  const cincoHoras = new Date("2026-11-22T17:00:00Z");
  it("usa os dois balões e abre o login do app para o quente e o morno", () => {
    const quente = tokenDaJornada("quente", "a".repeat(32));
    const morno = tokenDaJornada("morno", "b".repeat(32));
    const link = destinoDaJornada(quente);
    const abertura = aberturaDaJornada("quente", "João Carlos", link);
    expect(abertura).toEqual(["Fala, João, tudo bem? Aqui é o Leonel da Black.", expect.stringContaining(link)]);
    expect(abertura[1]).toContain("feedback");
    expect(aberturaDaJornada("morno", "João Carlos", destinoDaJornada(morno))[1]).not.toBe(abertura[1]);
    expect(new URL(link, site).pathname).toBe("/c/entrar");
    expect(new URL(link, site).searchParams.get("convite")).toBe(quente);
    expect(tokenDeConvite(quente)).toBe(true);
  });
  it.each(["frio", "muitoFrio"] as const)("abre direto na roleta para %s e mantém o token no login posterior", segmento => {
    const token = tokenDaJornada(segmento, "c".repeat(32));
    expect(ehJornadaComRoleta(token)).toBe(true);
    expect(tokenDeConvite(token)).toBe(true);
    expect(new URL(destinoDaJornada(token), site).pathname).toBe(`/c/r/${token}`);
    expect(aberturaDaJornada(segmento, "João", destinoDaJornada(token))[1]).toMatch(/gira a roleta/i);
  });
  it("espera cinco horas da última atividade e oferece ajuda adequada à etapa", () => {
    expect(instanteDeRetomada(agora)).toEqual(cincoHoras);
    expect(mensagemDaRetomada("João", "cadastro", "/c/entrar")).toContain("cadastro");
    expect(mensagemDaRetomada("João", "roleta", "/c/r/teste")).toContain("girar");
    expect(mensagemDaRetomada("João", "agenda", "/c/entrar")).toContain("horário");
  });
});
