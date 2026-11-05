import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ cliente: vi.fn(), agendamentos: vi.fn(), dados: null as unknown }));
vi.mock("@/lib/db", () => ({ db: {
  cliente: { findFirst: m.cliente }, assinatura: { findMany: async () => [] },
  agendamento: { findMany: m.agendamentos, count: async () => 0 },
} }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn() }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(),
  useState: (inicial: unknown) => [inicial === null ? m.dados : inicial, vi.fn()],
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children) }));
import { detalharCliente } from "@/lib/clientes/gestao";
import { ClienteDetalhe } from "@/components/clientes/ClienteDetalhe";

beforeEach(() => {
  vi.clearAllMocks(); m.dados = null;
  m.cliente.mockResolvedValue({ id: "c-teste", nome: "Cliente de teste", telefone: "5511999990000", email: null,
    cpf: null, endereco: null, dataNascimento: null, observacoes: null, usuarioId: null,
    criadoEm: new Date("2026-01-01T12:00:00Z"), fotoVersao: 0, perfilCompletoEm: null });
});

describe("histórico de serviços agrupados no CRM", () => {
  it.each([
    { nomes: ["Barba", "Hidratação"], esperado: "Corte + Barba + Hidratação" },
    { nomes: [], esperado: "Corte" },
  ])("mostra $esperado dentro de um único atendimento", async ({ nomes, esperado }) => {
    m.agendamentos.mockResolvedValue([{ id: "ag-principal", inicio: new Date("2026-11-06T13:00:00Z"), status: "MARCADO",
      servico: { nome: "Corte" }, barbeiro: { nome: "Profissional de teste" }, adicionais: nomes.map(nome => ({ servico: { nome } })),
    }]);
    m.dados = JSON.parse(JSON.stringify(await detalharCliente("c-teste")));
    const html = renderToStaticMarkup(createElement(ClienteDetalhe, { id: "c-teste", aoVoltar: vi.fn(), aoSalvar: vi.fn() }));
    expect(html).toContain(esperado);
    expect(html.match(/<li\b/g)).toHaveLength(1);
    expect(m.agendamentos).toHaveBeenCalledWith(expect.objectContaining({
      where: { clienteId: "c-teste", adicionalDeId: null },
      select: expect.objectContaining({ adicionais: { select: { servico: { select: { nome: true } } }, orderBy: { inicio: "asc" } } }),
    }));
    if (!nomes.length) expect(html).not.toContain("Corte +");
  });
});
