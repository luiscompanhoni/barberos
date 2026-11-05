import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusPedidoAgendamento } from "@/components/cliente/StatusPedidoAgendamento";

const agendamento = { inicio: "2026-11-06T13:00:00Z", status: "MARCADO", barbeiro: { nome: "Profissional de teste" } };
const renderizar = (status: string, estadoHorario?: string) => renderToStaticMarkup(createElement(StatusPedidoAgendamento, {
  pedido: { status, agendamento: estadoHorario ? { ...agendamento, status: estadoHorario } : null },
}));

describe("situação atual do horário no histórico de pedidos", () => {
  it("deixa de confirmar o horário quando a recepção cancela a reserva aprovada", () => {
    expect(renderizar("APROVADO", "MARCADO")).toContain("Horário confirmado");
    const cancelado = renderizar("APROVADO", "CANCELADO");
    expect(cancelado).toContain("Horário cancelado");
    expect(cancelado).toContain("Pedido aprovado anteriormente pela equipe");
    expect(cancelado).not.toContain("Horário confirmado");
    expect(cancelado).toContain("Profissional de teste");
  });
  it.each([
    ["CONCLUIDO", "Atendimento concluído"], ["FALTOU", "Falta registrada"],
    ["CHEGOU", "Chegada registrada"], ["EM_ATENDIMENTO", "Atendimento em andamento"],
  ])("acompanha %s sem prometer uma reserva futura", (status, rotulo) => {
    const html = renderizar("APROVADO", status);
    expect(html).toContain(rotulo); expect(html).not.toContain("Horário confirmado");
  });
  it("mantém o pedido pendente sem declarar um horário reservado", () => {
    const html = renderizar("PENDENTE");
    expect(html).toContain("Aguardando conferência");
    expect(html).not.toContain("Horário confirmado"); expect(html).not.toContain("Agendamento:");
  });
  it("não afirma confirmação sem uma reserva vinculada consultável", () => {
    const html = renderizar("APROVADO");
    expect(html).toContain("Pedido aprovado pela equipe"); expect(html).not.toContain("Horário confirmado");
  });
});
