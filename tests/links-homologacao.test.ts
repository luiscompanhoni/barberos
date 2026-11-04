import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ buscar: vi.fn(), transacao: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { linkPagamento: { findUnique: m.buscar }, $transaction: m.transacao } }));
import { gateway, gatewayPorId } from "@/lib/pagamentos/gateway";
import { _usarFetch, buscarPedido, estornarCobranca, pagarme } from "@/lib/pagamentos/pagarme";
import { cancelarLink } from "@/lib/links/checkout";
import { sincronizarLink } from "@/lib/links/sincronizacao";
const fetchFalso = vi.fn(async () => { throw Error("Rede não autorizada no teste"); });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AMBIENTE", "homologacao"); vi.stubEnv("PAGAMENTOS_PROVIDER", "pagarme"); vi.stubEnv("PAGARME_SECRET_KEY", "sk_test_sintetica");
  vi.stubGlobal("fetch", fetchFalso); _usarFetch(fetchFalso as typeof fetch);
  m.buscar.mockResolvedValue({ id: "link_copia", status: "PENDENTE", gatewayId: "or_copia", tentativaChave: "lk-original" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("homologação mantém pagamentos reais inacessíveis", () => {
  it.each(["or_copia", "pay_copia", "celchg_copia"])("não mascara %s com um adaptador de teste", async (id) => {
    await expect(gatewayPorId(id)).rejects.toMatchObject({ codigo: "homologacao_pagamento_real" });
    expect(fetchFalso).not.toHaveBeenCalled();
  });
  it("novas cobranças e ids simulados continuam simulados", async () => {
    expect((await gateway()).nome).toBe("simulado"); expect((await gatewayPorId("simpix_sintetico")).nome).toBe("simulado");
    expect(fetchFalso).not.toHaveBeenCalled();
  });
  it("consulta e cancelamento do link copiado não chegam à API nem alteram registros", async () => {
    await expect(sincronizarLink("link_copia")).rejects.toMatchObject({ codigo: "homologacao_pagamento_real" });
    await expect(cancelarLink(null, "link_copia")).rejects.toMatchObject({ codigo: "homologacao_pagamento_real" });
    expect(fetchFalso).not.toHaveBeenCalled(); expect(m.transacao).not.toHaveBeenCalled();
  });
  it("chamadas diretas à Pagar.me também são bloqueadas, mesmo com chave configurada", async () => {
    await expect(buscarPedido("or_copia")).rejects.toMatchObject({ status: 503 });
    await expect(estornarCobranca("or_copia")).rejects.toMatchObject({ status: 503 });
    await expect(pagarme.cancelarCobrancaAvulsa!("or_copia")).rejects.toMatchObject({ status: 503 });
    await expect(pagarme.criarCobrancaAvulsa!({ clienteGatewayId: "cus_sintetico", valorCentavos: 6000, forma: "PIX", vencimento: "2030-01-02", descricao: "Teste sintético", referencia: "lk-teste" })).rejects.toMatchObject({ status: 503 });
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});
