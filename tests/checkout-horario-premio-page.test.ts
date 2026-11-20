import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ consultar: vi.fn(), sincronizar: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ sessaoAtual: async () => ({ clienteId: "cliente" }) }));
vi.mock("@/lib/db", () => ({ db: { agendamento: { findFirst: m.consultar } } }));
vi.mock("@/lib/pagamentos/checkout", () => ({ checkoutProprio: () => true }));
vi.mock("@/lib/agenda/antecipado", () => ({ sincronizarAntecipado: m.sincronizar }));
import PagarHorario from "@/app/c/(area)/pagar-horario/[id]/page";
it.each([
  ["PAGO", "Pagamento recebido."], ["PENDENTE", "Pagamento em conferência."], ["CANCELADO", "Pague no balcão"],
])("Pix local pendente e prêmio, após consulta ficou %s", async (status, mensagem) => {
  m.consultar.mockResolvedValue({ premiosGanhos: [{ id: "desconto" }], adicionais: [], antecipado: { id: "pix", status: "PENDENTE" } });
  m.sincronizar.mockResolvedValue({ status });
  const html = renderToStaticMarkup(await PagarHorario({ params: Promise.resolve({ id: "horario" }), searchParams: Promise.resolve({}) }));
  expect(m.sincronizar).toHaveBeenCalledWith("pix");
  expect(html).toContain(mensagem);
  if (status !== "CANCELADO") expect(html).not.toContain("Pague no balcão");
  expect(html).not.toContain("Pagar agora");
});
