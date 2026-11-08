import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ cliente: vi.fn(), situacao: vi.fn(), cancelar: vi.fn(), previa: vi.fn(), equipe: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { cliente: { findUnique: m.cliente } } }));
vi.mock("@/lib/assinaturas/servico", () => ({ situacaoDoCliente: m.situacao }));
vi.mock("@/lib/assinaturas/retencao-avisos", () => ({ passarConversaParaEquipe: m.equipe }));
vi.mock("@/lib/assinaturas/retencao", () => ({ cancelarPeloCliente: m.cancelar, previaCancelamento: m.previa, aceitarDesconto: vi.fn(), pausar: vi.fn(), falarComGerente: vi.fn() }));
import { executarCancelamento } from "@/lib/bot/ferramentas-cancelamento";
const ctx = { conversaId: "c", telefone: "5547999990000", nomePerfil: null };
beforeEach(() => {
  vi.clearAllMocks(); m.cliente.mockResolvedValue({ id: "cli" }); m.situacao.mockResolvedValue({ assinatura: { id: "a" } });
});
describe("cancelamento no legado", () => {
  it("separa pedido local de cobrança externa e passa para equipe", async () => {
    m.cancelar.mockResolvedValue({ cashbarber: true, ultimoDia: "2026-11-30" });
    const r = await executarCancelamento("cancelar_assinatura", { motivo: "NAO_USA", decisao: "cancelar" }, ctx);
    expect(r.passouParaHumano).toBe(true);
    expect(r.texto).toContain("ainda precisa de confirmação");
    expect(r.texto).not.toContain("sem novas cobranças");
    expect(m.equipe).toHaveBeenCalledWith(ctx.telefone, expect.stringContaining("CashBarber/Celcash"));
  });
  it("preserva o cancelamento confirmado no gateway integrado", async () => {
    m.cancelar.mockResolvedValue({ cashbarber: false, ultimoDia: "2026-11-30" });
    const r = await executarCancelamento("cancelar_assinatura", { motivo: "NAO_USA", decisao: "cancelar" }, ctx);
    expect(r.texto).toContain("Plano cancelado"); expect(m.equipe).not.toHaveBeenCalled();
  });
});
