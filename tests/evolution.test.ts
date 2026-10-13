import { describe, expect, it } from "vitest";
import { lerMensagensEvolution, telefoneCanonico } from "@/lib/whatsapp/webhook";

const msg = (data: Record<string, unknown>, event = "messages.upsert") => ({ event, instance: "barberos", data });

describe("webhook da Evolution (WhatsApp nao oficial)", () => {
  it("le texto simples", () => {
    const r = lerMensagensEvolution(msg({
      key: { id: "ABC", remoteJid: "554788040047@s.whatsapp.net", fromMe: false },
      pushName: "Luis", message: { conversation: " Oi, quero cortar " }, messageType: "conversation", messageTimestamp: 1760000000,
    }));
    expect(r).toEqual([{ wamid: "ABC", waId: "554788040047", nomePerfil: "Luis", texto: "Oi, quero cortar", tipo: "conversation", timestamp: 1760000000000 }]);
    expect(telefoneCanonico(r[0].waId)).toBe("5547988040047");
  });

  it("le texto com link/resposta (extendedTextMessage)", () => {
    const r = lerMensagensEvolution(msg({ key: { id: "X", remoteJid: "5547999990000@s.whatsapp.net" }, message: { extendedTextMessage: { text: "amanhã" } } }));
    expect(r[0].texto).toBe("amanhã");
  });

  it("usa o numero real quando chega com @lid", () => {
    const r = lerMensagensEvolution(msg({ key: { id: "L", remoteJid: "123456789@lid", remoteJidAlt: "5547999990000@s.whatsapp.net" }, message: { conversation: "oi" } }));
    expect(r[0].waId).toBe("5547999990000");
    expect(lerMensagensEvolution(msg({ key: { id: "L2", remoteJid: "123456789@lid" }, message: { conversation: "oi" } }))).toEqual([]);
  });

  it("ignora mensagens do proprio numero, grupos e status", () => {
    const ignorar = [
      { key: { id: "1", remoteJid: "5547999990000@s.whatsapp.net", fromMe: true }, message: { conversation: "x" } },
      { key: { id: "2", remoteJid: "120363@g.us" }, message: { conversation: "x" } },
      { key: { id: "3", remoteJid: "status@broadcast" }, message: { conversation: "x" } },
    ];
    for (const d of ignorar) expect(lerMensagensEvolution(msg(d))).toEqual([]);
  });

  it("audio/foto chegam sem texto; outros eventos sao ignorados", () => {
    const r = lerMensagensEvolution(msg({ key: { id: "A", remoteJid: "5547999990000@s.whatsapp.net" }, message: { audioMessage: {} }, messageType: "audioMessage" }));
    expect(r[0]).toMatchObject({ texto: null, tipo: "audioMessage" });
    expect(lerMensagensEvolution(msg({ key: { id: "B", remoteJid: "5547999990000@s.whatsapp.net" }, message: { conversation: "x" } }, "messages.update"))).toEqual([]);
    expect(lerMensagensEvolution(msg({ key: { id: "C", remoteJid: "5547999990000@s.whatsapp.net" }, message: { conversation: "x" } }, "MESSAGES_UPSERT"))).toHaveLength(1);
    expect(lerMensagensEvolution(null)).toEqual([]);
  });
});
