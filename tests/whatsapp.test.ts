import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assinaturaValida, lerMensagens, telefoneCanonico } from "@/lib/whatsapp/webhook";

const SEGREDO = "segredo-de-teste";
const assinar = (corpo: string) => `sha256=${createHmac("sha256", SEGREDO).update(corpo).digest("hex")}`;

describe("assinatura do webhook", () => {
  const corpo = JSON.stringify({ entry: [] });
  it("aceita assinatura correta", () => {
    expect(assinaturaValida(corpo, assinar(corpo), SEGREDO)).toBe(true);
  });
  it("recusa corpo alterado, cabecalho ausente ou mal formado", () => {
    expect(assinaturaValida(corpo + " ", assinar(corpo), SEGREDO)).toBe(false);
    expect(assinaturaValida(corpo, null, SEGREDO)).toBe(false);
    expect(assinaturaValida(corpo, "sha256=abc", SEGREDO)).toBe(false);
    expect(assinaturaValida(corpo, assinar(corpo), "")).toBe(false);
  });
});

describe("lerMensagens", () => {
  const payload = {
    entry: [{
      changes: [{
        value: {
          contacts: [{ wa_id: "551188887777", profile: { name: "Carlos" } }],
          messages: [
            { id: "wamid.1", from: "551188887777", timestamp: "1790000000", type: "text", text: { body: " oi, tem horario? " } },
            { id: "wamid.2", from: "551188887777", timestamp: "1790000001", type: "interactive", interactive: { button_reply: { title: "Confirmar" } } },
            { id: "wamid.3", from: "551188887777", timestamp: "1790000002", type: "audio" },
          ],
          statuses: [{ id: "wamid.0", status: "delivered" }],
        },
      }],
    }],
  };

  it("extrai texto, botao e marca tipos nao suportados", () => {
    const m = lerMensagens(payload);
    expect(m).toHaveLength(3);
    expect(m[0]).toMatchObject({ wamid: "wamid.1", waId: "551188887777", nomePerfil: "Carlos", texto: "oi, tem horario?" });
    expect(m[1].texto).toBe("Confirmar");
    expect(m[2]).toMatchObject({ tipo: "audio", texto: null });
  });

  it("ignora payload vazio ou estranho", () => {
    expect(lerMensagens({})).toEqual([]);
    expect(lerMensagens(null)).toEqual([]);
  });
});

describe("telefoneCanonico", () => {
  it("coloca o 9 em celular brasileiro antigo", () => {
    expect(telefoneCanonico("551188887777")).toBe("5511988887777");
  });
  it("mantem numeros ja completos e fixos", () => {
    expect(telefoneCanonico("5511988887777")).toBe("5511988887777");
    expect(telefoneCanonico("551133334444")).toBe("551133334444"); // fixo comeca com 2-5
  });
});
