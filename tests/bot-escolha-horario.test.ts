import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { confirmouReserva } from "@/lib/bot/escolha-horario";

const pedido = { data: "2026-11-28", servico_id: "corte", barbeiro_id: "ygor", horario: "09:00" };
const consulta: Anthropic.Beta.BetaMessageParam[] = [
  { role: "user", content: "Quando ele tem horário?" },
  { role: "assistant", content: [{ type: "tool_use", id: "consulta", name: "consultar_horarios", input: pedido }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "consulta", content: JSON.stringify({
    data: pedido.data, opcoes: ["09:00", "09:10"].map(horario => ({ horario, barbeiro_id: pedido.barbeiro_id })),
  }) }] },
  { role: "assistant", content: "O mais próximo é sábado (28/11) às 09:00 ou 09:10. Alguma dessas te serve?" },
];

describe("confirmação da reserva pelo WhatsApp", () => {
  it("grava a escolha explícita depois de um comentário sem nova oferta", () => {
    const historico: Anthropic.Beta.BetaMessageParam[] = [...consulta,
      { role: "user", content: "Oloco, o homi tá muito cheio kkkkk" },
      { role: "assistant", content: "Kkkk o Ygor tá bem disputado essa semana!" },
    ];
    expect(confirmouReserva("Marca no sábado às 9 com o Ygor", historico, pedido)).toBe(true);
    expect(confirmouReserva("Sim", historico, pedido)).toBe(false);
    expect(confirmouReserva("Marca na sexta às 9 com o Ygor", historico, pedido)).toBe(false);
    expect(confirmouReserva("Marca dia 29/11 às 9 com o Ygor", historico, pedido)).toBe(false);
    expect(confirmouReserva("Marca no sábado às 9 com o Ygor", historico, { ...pedido, barbeiro_id: "outro" })).toBe(false);
  });

  it("reconhece o aceite coloquial de uma única vaga reapresentada", () => {
    const historico: Anthropic.Beta.BetaMessageParam[] = [...consulta,
      { role: "user", content: "Marca no sábado às 9:00 pra mim" },
      { role: "assistant", content: "Fica assim: corte com o Ygor no sábado (28/11) às 09:00. Posso marcar?" },
    ];
    expect(confirmouReserva("Pode mano", historico, pedido)).toBe(true);
    expect(confirmouReserva("Pode, irmão!", historico, pedido)).toBe(true);
    expect(confirmouReserva("Pode mano", consulta, pedido)).toBe(false);
    expect(confirmouReserva("Não pode, mano", historico, pedido)).toBe(false);
    expect(confirmouReserva("Pode mano", historico, { ...pedido, data: "2026-11-29" })).toBe(false);
    expect(confirmouReserva("Pode marca às 9 com o Ygor", historico, pedido)).toBe(true);
  });

  it("não recupera oferta anterior depois de uma consulta diferente", () => {
    const historico: Anthropic.Beta.BetaMessageParam[] = [...consulta,
      { role: "user", content: "E na sexta com outro?" },
      { role: "assistant", content: [{ type: "tool_use", id: "outra", name: "consultar_horarios", input: { ...pedido, data: "2026-11-27", barbeiro_id: "outro" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "outra", content: JSON.stringify({
        data: "2026-11-27", opcoes: [{ horario: "09:00", barbeiro_id: "outro" }],
      }) }] },
      { role: "assistant", content: "Na sexta tem só com outro profissional às 09:00." },
    ];
    expect(confirmouReserva("Pode, mano", historico, pedido)).toBe(false);
  });
});
