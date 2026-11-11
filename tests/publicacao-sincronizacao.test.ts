import { afterEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  webhooks: vi.fn(), fila: vi.fn(), pausas: vi.fn(), encerradas: vi.fn(), antecipados: vi.fn(), links: vi.fn(),
  assinatura: vi.fn(), vencerManuais: vi.fn(), sincronizar: vi.fn(), gateway: vi.fn(), emitir: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  assinatura: { findMany: m.assinatura, updateMany: m.vencerManuais },
  configuracao: { findUnique: vi.fn().mockResolvedValue({ fuso: "America/Sao_Paulo" }) },
} }));
vi.mock("@/lib/pagamentos/webhook-entrada", () => ({ recuperarWebhooksPagamento: m.webhooks }));
vi.mock("@/lib/assinaturas/cobranca-automatica-rotina", () => ({ processarCobrancasAutomaticas: m.fila }));
vi.mock("@/lib/assinaturas/retencao-rotina", () => ({ reativarPausas: m.pausas, encerrarCancelados: m.encerradas }));
vi.mock("@/lib/agenda/antecipado", () => ({ sincronizarAntecipadosPendentes: m.antecipados }));
vi.mock("@/lib/links/servico", () => ({ sincronizarLinksPendentes: m.links }));
vi.mock("@/lib/assinaturas/cobrancas", () => ({ linkAbsoluto: vi.fn(), sincronizarAssinatura: m.sincronizar, sincronizarCobranca: vi.fn() }));
vi.mock("@/lib/assinaturas/cartao-pix", () => ({ gerarPixDoMes: m.emitir }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gateway: m.gateway }));

import { rodarRotinaDePagamentos } from "@/lib/assinaturas/rotina";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("bloqueia apenas emissão automática e preserva as consultas de reconciliação", async () => {
  vi.stubEnv("PAGAMENTOS_EMISSAO_AUTOMATICA_PIX_ATIVA", "false");
  vi.stubEnv("BARBEROS_QUARENTENA_RESTAURACAO", "false");
  m.webhooks.mockResolvedValue(0); m.fila.mockResolvedValue({ processadas: 0 });
  m.pausas.mockResolvedValue(0); m.encerradas.mockResolvedValue(0);
  m.antecipados.mockResolvedValue(0); m.links.mockResolvedValue(0);
  m.assinatura.mockResolvedValue([{ id: "assinatura-ficticia" }]);
  m.vencerManuais.mockResolvedValue({ count: 0 });
  m.sincronizar.mockResolvedValue(undefined); m.gateway.mockResolvedValue({ nome: "simulado", pix: "avulso" });
  expect(await rodarRotinaDePagamentos()).toEqual({ pix: 0, vencidas: 0, celcash: 1, reativadas: 0, encerradas: 0 });
  expect(m.webhooks).toHaveBeenCalledTimes(1);
  expect(m.antecipados).toHaveBeenCalledTimes(1);
  expect(m.links).toHaveBeenCalledTimes(1);
  expect(m.sincronizar).toHaveBeenCalledWith("assinatura-ficticia");
  expect(m.vencerManuais).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ gatewayId: null, ultimoPagamentoManualEm: { not: null } }),
    data: { status: "ATRASADA" },
  }));
  expect(m.emitir).not.toHaveBeenCalled();
});
