import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  cliente: vi.fn(), conversa: vi.fn(), entrada: vi.fn(), atualizacao: vi.fn(), optOut: vi.fn(), conversaOptOut: vi.fn(), trava: vi.fn(), transacao: vi.fn(), busca: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  cliente: { findUnique: m.cliente, updateMany: m.optOut },
  conversa: { upsert: m.conversa, update: m.atualizacao, findUniqueOrThrow: m.busca },
  mensagem: { create: m.entrada }, $transaction: m.transacao,
} }));
vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));

import { registrarEntrada } from "@/lib/whatsapp/conversas";

describe("registro transacional do pedido para parar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.cliente.mockResolvedValue({ id: "cliente" });
    m.conversa.mockResolvedValue({ id: "conversa" });
    m.entrada.mockReturnValue("mensagem");
    m.atualizacao.mockReturnValue("conversa-atualizada");
    m.optOut.mockReturnValue("preferencia");
    m.transacao.mockImplementation(async (fn: unknown) => typeof fn === "function" ? (fn as (tx: unknown) => unknown)({
      $executeRaw: m.trava,
      cliente: { updateMany: m.optOut },
      conversa: { update: m.atualizacao, updateMany: m.conversaOptOut },
      mensagem: { create: m.entrada },
    }) : []);
    m.busca.mockResolvedValue({ id: "conversa" });
  });

  it("salva a preferência na mesma transação da mensagem e da janela", async () => {
    await registrarEntrada({ telefone: "5547999990000", texto: "PARAR", wamid: "unico", optOut: true });
    expect(m.optOut).toHaveBeenCalledWith({ where: { telefone: "5547999990000" }, data: { aceitaMensagens: false } });
    expect(m.conversaOptOut).toHaveBeenCalledWith({ where: { telefone: "5547999990000" }, data: { recusaAutomaticas: true } });
    expect(m.trava.mock.invocationCallOrder[0]).toBeLessThan(m.entrada.mock.invocationCallOrder[0]);
    expect(m.entrada).toHaveBeenCalledTimes(1); expect(m.atualizacao).toHaveBeenCalledTimes(1);
  });

  it("não altera a preferência para uma mensagem comum", async () => {
    await registrarEntrada({ telefone: "5547999990000", texto: "oi", wamid: "outro" });
    expect(m.optOut).not.toHaveBeenCalled();
    expect(m.transacao).toHaveBeenCalledWith(["mensagem", "conversa-atualizada"]);
  });
});
