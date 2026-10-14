import { describe, expect, it } from "vitest";
import { lerStatus, lerStatusEvolution } from "@/lib/whatsapp/webhook";

describe("status das mensagens: API oficial", () => {
  it("entregue, lida e falha; 'sent' e mensagem recebida nao contam", () => {
    const payload = {
      entry: [{ changes: [{ value: {
        statuses: [
          { id: "wamid.A", status: "sent", timestamp: "1760000000" },
          { id: "wamid.A", status: "delivered", timestamp: "1760000005" },
          { id: "wamid.A", status: "read", timestamp: "1760000060" },
          { id: "wamid.B", status: "failed", timestamp: "1760000001", errors: [{ code: 131026, title: "Message undeliverable" }] },
        ],
        messages: [{ id: "wamid.C", from: "5511999999999", type: "text", text: { body: "oi" } }],
      } }] }],
    };
    expect(lerStatus(payload)).toEqual([
      { wamid: "wamid.A", status: "ENTREGUE", quando: 1760000005000, erro: null },
      { wamid: "wamid.A", status: "LIDA", quando: 1760000060000, erro: null },
      { wamid: "wamid.B", status: "FALHOU", quando: 1760000001000, erro: "Message undeliverable" },
    ]);
  });
});

describe("status das mensagens: Evolution", () => {
  it("v2 (texto) e v1 (numero); ignora o que o cliente mandou e outros eventos", () => {
    expect(lerStatusEvolution({ event: "messages.update", data: { keyId: "K1", fromMe: true, status: "DELIVERY_ACK" } }))
      .toEqual([{ wamid: "K1", status: "ENTREGUE", quando: null, erro: null }]);
    expect(lerStatusEvolution({ event: "MESSAGES_UPDATE", data: [{ key: { id: "K2", fromMe: true }, update: { status: 4 } }] }))
      .toEqual([{ wamid: "K2", status: "LIDA", quando: null, erro: null }]);
    expect(lerStatusEvolution({ event: "messages.update", data: { keyId: "K3", fromMe: false, status: "READ" } })).toEqual([]);
    expect(lerStatusEvolution({ event: "messages.update", data: { keyId: "K4", status: "SERVER_ACK" } })).toEqual([]);
    expect(lerStatusEvolution({ event: "messages.upsert", data: { keyId: "K5", status: "READ" } })).toEqual([]);
  });
});
