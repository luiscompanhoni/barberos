import { afterEach, describe, expect, it, vi } from "vitest";
import { lerDesconexoes, lerEcos, lerHistorico } from "@/lib/whatsapp/coexistencia";
import { cifrarToken, decifrarToken } from "@/lib/whatsapp/oficial";
import { lerMensagens } from "@/lib/whatsapp/webhook";

const envelope = (field: string, value: unknown, id = "102290129340398") => ({ object: "whatsapp_business_account", entry: [{ id, changes: [{ field, value }] }] });

describe("ecos do app WhatsApp Business", () => {
  it("lê texto e mídia enviados pelo celular", () => {
    const p = envelope("smb_message_echoes", {
      metadata: { display_phone_number: "554733330000" },
      message_echoes: [
        { from: "554733330000", to: "5547988887777", id: "wamid.A", timestamp: "1700255121", type: "text", text: { body: " Oi! " } },
        { from: "554733330000", to: "5547988887777", id: "wamid.B", timestamp: "1700255122", type: "image", image: {} },
      ],
    });
    expect(lerEcos(p)).toEqual([
      { wamid: "wamid.A", waId: "5547988887777", texto: "Oi!", quando: new Date(1700255121000), daEmpresa: true },
      { wamid: "wamid.B", waId: "5547988887777", texto: "[foto]", quando: new Date(1700255122000), daEmpresa: true },
    ]);
  });
  it("ignora outros campos", () => {
    expect(lerEcos(envelope("messages", { message_echoes: [{ id: "x", to: "1", type: "text", text: { body: "a" } }] }))).toEqual([]);
  });
});

describe("histórico da coexistência", () => {
  const p = envelope("history", {
    metadata: { display_phone_number: "15550783881" },
    history: [{ metadata: { phase: 0, chunk_order: 1, progress: 55 }, threads: [{ id: "16505551234", messages: [
      { from: "15550783881", id: "wamid.1", timestamp: "1739230955", type: "text", text: { body: "Aqui está" } },
      { from: "15550783881", id: "wamid.2", timestamp: "1739230970", type: "media_placeholder" },
      { from: "16505551234", id: "wamid.3", timestamp: "1739230971", type: "text", text: { body: "Valeu" } },
    ] }] }],
  });
  it("separa o que a barbearia e o cliente mandaram", () => {
    expect(lerHistorico(p).map((m) => [m.wamid, m.daEmpresa, m.texto, m.waId])).toEqual([
      ["wamid.1", true, "Aqui está", "16505551234"],
      ["wamid.2", true, "[mídia]", "16505551234"],
      ["wamid.3", false, "Valeu", "16505551234"],
    ]);
  });
  it("histórico recusado não gera mensagens", () => {
    expect(lerHistorico(envelope("history", { history: [{ errors: [{ code: 2593109 }] }] }))).toEqual([]);
  });
  it("mídia antiga do histórico não vira mensagem nova para o bot", () => {
    const midia = envelope("history", { messages: [{ from: "16505551234", id: "wamid.9", timestamp: "1", type: "image", image: { id: "1" } }] });
    expect(lerMensagens(midia)).toEqual([]);
  });
});

describe("desconexão da API", () => {
  it("PARTNER_REMOVED usa a WABA de waba_info", () => {
    const p = envelope("account_update", { event: "PARTNER_REMOVED", waba_info: { waba_id: "555" }, disconnection_info: { reason: "PRIMARY_INACTIVITY" } }, "parceiro");
    expect(lerDesconexoes(p)).toEqual([{ wabaId: "555", motivo: "PRIMARY_INACTIVITY" }]);
  });
  it("ACCOUNT_OFFBOARDED usa o id da entrada", () => {
    expect(lerDesconexoes(envelope("account_update", { event: "ACCOUNT_OFFBOARDED" }, "862475293675413"))).toEqual([{ wabaId: "862475293675413", motivo: "ACCOUNT_OFFBOARDED" }]);
  });
  it("outros eventos não desconectam", () => {
    expect(lerDesconexoes(envelope("account_update", { event: "ACCOUNT_RECONNECTED" }))).toEqual([]);
  });
});

describe("token comercial cifrado", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("volta igual e não guarda o texto puro", () => {
    vi.stubEnv("SESSION_SECRET", "s".repeat(40));
    const c = cifrarToken("EAAtoken-de-teste");
    expect(c).not.toContain("EAAtoken");
    expect(decifrarToken(c)).toBe("EAAtoken-de-teste");
  });
  it("outra chave não abre", () => {
    vi.stubEnv("SESSION_SECRET", "a".repeat(40));
    const c = cifrarToken("EAAtoken");
    vi.stubEnv("SESSION_SECRET", "b".repeat(40));
    expect(() => decifrarToken(c)).toThrow();
  });
});
