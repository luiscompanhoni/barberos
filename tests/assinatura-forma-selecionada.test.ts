import { describe, expect, it } from "vitest";
import { formaSelecionada } from "@/lib/assinaturas/forma-selecionada";

describe("forma exibida e enviada na venda de plano", () => {
  it("plano inicial exclusivo de cartão não herda o Pix padrão", () => {
    expect(formaSelecionada(["CARTAO"], "PIX")).toBe("CARTAO");
  });
  it("troca de plano descarta forma que deixou de ser permitida", () => {
    const anterior = formaSelecionada(["PIX", "CARTAO"], "PIX");
    expect(formaSelecionada(["BOLETO", "CARTAO"], anterior)).toBe("BOLETO");
  });
  it("mantém escolha válida mesmo se não for a primeira opção", () => {
    expect(formaSelecionada(["PIX", "CARTAO"], "CARTAO")).toBe("CARTAO");
  });
  it("plano sem formas não produz forma inventada para enviar", () => {
    expect(formaSelecionada([], "PIX")).toBe("");
  });
});
