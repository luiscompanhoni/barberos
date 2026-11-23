import { expect, it, vi } from "vitest";
import { pendencias } from "@/lib/painel";

const m = vi.hoisted(() => ({ conversas: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    conversa: { findMany: m.conversas },
    agendamento: { findMany: async () => [], groupBy: async () => [] },
    barbeiro: { findMany: async () => [] },
    assinatura: { findMany: async () => [] },
    cliente: { findMany: async () => [] },
  },
}));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/agenda/expediente", () => ({ atendimentosForaDoExpediente: async () => [] }));

it("identifica o Direct no resumo sem devolver o IGSID como telefone", async () => {
  const base = { nomePerfil: null, naoLidas: 2, atualizadoEm: new Date(), cliente: null };
  m.conversas.mockResolvedValue([
    { ...base, id: "ig", telefone: "instagram:40000000000002", instagramIgsid: "40000000000002", instagramCliente: { nome: "Contato fictício" } },
    { ...base, id: "wa", telefone: "5511990000000", instagramIgsid: null, instagramCliente: null },
  ]);

  const { conversas } = await pendencias();
  expect(conversas).toMatchObject([
    { id: "ig", canal: "Instagram", telefone: null, cliente: { nome: "Contato fictício" } },
    { id: "wa", canal: "WhatsApp", telefone: "5511990000000", cliente: null },
  ]);
  expect(JSON.stringify(conversas)).not.toContain("40000000000002");
});
