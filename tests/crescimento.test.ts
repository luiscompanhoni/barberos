import { describe, expect, it } from "vitest";
import { escolherSugestoes, gerarCodigoIndicacao, noPeriodo, normalizarCodigo, retornoDevido, ritmoDoCliente, TEXTOS } from "@/lib/crescimento/regras";

const D = 86_400_000;

describe("retorno no ritmo do cliente", () => {
  it("ritmo = intervalo medio recente, entre 7 e 60 dias", () => {
    expect(ritmoDoCliente([0, 20 * D, 40 * D])).toBe(20);
    expect(ritmoDoCliente([0, 2 * D])).toBe(7);
    expect(ritmoDoCliente([0, 200 * D])).toBe(60);
    expect(ritmoDoCliente([5 * D])).toBeNull();
    // Usa as 6 ultimas: um intervalo antigo e enorme nao distorce
    expect(ritmoDoCliente([0, 400 * D, 414 * D, 428 * D, 442 * D, 456 * D, 470 * D])).toBe(14);
  });
  it("lembra de 1 dia antes do ritmo ate 1,5x", () => {
    expect(retornoDevido(0, 20, 18 * D)).toBe(false);
    expect(retornoDevido(0, 20, 19 * D)).toBe(true);
    expect(retornoDevido(0, 20, 30 * D)).toBe(true);
    expect(retornoDevido(0, 20, 31 * D)).toBe(false);
  });
});

describe("lista de espera", () => {
  it("periodo do dia", () => {
    expect(noPeriodo(9 * 60, "MANHA")).toBe(true);
    expect(noPeriodo(12 * 60, "MANHA")).toBe(false);
    expect(noPeriodo(15 * 60, "TARDE")).toBe(true);
    expect(noPeriodo(18 * 60, "NOITE")).toBe(true);
    expect(noPeriodo(3, "QUALQUER")).toBe(true);
  });
  it("sugestoes espalhadas no dia, preferindo o barbeiro de costume", () => {
    const op = (b: string, m: number) => ({ barbeiroId: b, nome: b, inicio: `${b}-${m}`, minutos: m });
    const lista = [op("a", 540), op("a", 600), op("a", 660), op("a", 720), op("a", 900), op("b", 560)];
    expect(escolherSugestoes(lista, 3, "a").map((o) => o.minutos)).toEqual([540, 660, 900]);
    expect(escolherSugestoes(lista, 3, "b").map((o) => o.barbeiroId)).toEqual(["b"]);
    expect(escolherSugestoes(lista, 3, "z")).toHaveLength(3); // sem o preferido: usa todos
  });
});

describe("indicacao", () => {
  it("codigo legivel com o nome e sem letras confusas", () => {
    let i = 0;
    const seq = [0, 0.5, 0.99];
    const c = gerarCodigoIndicacao("Rafaél Souza", () => seq[i++ % 3]);
    expect(c.startsWith("RAFAE")).toBe(true);
    expect(c).toHaveLength(8);
    expect(c.slice(5)).not.toMatch(/[01IO]/);
    expect(gerarCodigoIndicacao("", () => 0).startsWith("AMIGO")).toBe(true);
  });
  it("normaliza o que o cliente digita", () => {
    expect(normalizarCodigo(" rafa-7k2 ")).toBe("RAFA7K2");
    expect(normalizarCodigo("ab")).toBeNull();
  });
  it("mensagens", () => {
    expect(TEXTOS.INDICACAO_CONVERTIDA({ nome: "Rafael Souza", amigo: "Bruno Lima", premio: 2000 })).toMatch(/Bruno veio pela sua indicação.*R\$ 20,00/);
    expect(TEXTOS.CONVITE({ nome: "Rafael", barbearia: "Black Barber", link: "https://x/i/RAFA7K2", codigo: "RAFA7K2", premioIndicado: 1000 })).toMatch(/ganha R\$ 10,00.*https:\/\/x\/i\/RAFA7K2/);
    expect(TEXTOS.RETORNO({ nome: "Rafa", dias: 19, servico: "Corte", opcoes: ["sexta às 14:00 com Pedro"], peloPlano: true })).toMatch(/19 dias.*Separei: sexta às 14:00 com Pedro \(pelo plano\)/);
  });
});
