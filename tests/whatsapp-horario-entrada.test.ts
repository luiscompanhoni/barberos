import { describe, expect, it } from "vitest";
import { instanteDaEntradaCloud } from "@/lib/whatsapp/horario-entrada";

const agora = Date.UTC(2026, 10, 21, 15);

describe("horário de envio da entrada da Cloud API", () => {
  it("mantém o horário de uma mensagem antiga mesmo se o webhook chegar hoje", () => {
    const anterior = agora - 25 * 3_600_000;
    expect(instanteDaEntradaCloud(anterior, agora)?.getTime()).toBe(anterior);
  });

  it.each([Number.NaN, 0, -1, agora + 1000])("não abre janela com timestamp inválido %s", timestamp => {
    expect(instanteDaEntradaCloud(timestamp, agora)).toBeNull();
  });
});
