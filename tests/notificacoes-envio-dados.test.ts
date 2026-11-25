import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ listar: vi.fn(), reservar: vi.fn(), entrega: vi.fn(), salvar: vi.fn(), corpo: vi.fn(), enviar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  pushEntrega: { updateMany: m.reservar, findMany: m.listar, findUniqueOrThrow: m.entrega, update: m.salvar },
  pushInscricao: { findUnique: async () => ({ ativo: true, usuarioId: "u", tokenHash: "token" }) },
  usuario: { findUnique: async () => ({ ativo: true, notificacaoPreferencia: null }) },
} }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/notificacoes/configuracao", () => ({ configuracaoPush: () => ({ disponivel: true, vapidHash: "hash" }) }));
vi.mock("@/lib/notificacoes/geracao-relevancia", () => ({ notificacaoAindaRelevante: async () => true }));
vi.mock("@/lib/notificacoes/texto-atual", () => ({ corpoAtualPush: m.corpo }));
vi.mock("@/lib/notificacoes/provedor", () => ({ enviarPush: m.enviar }));
import { processarPush } from "@/lib/notificacoes/envio";
const agora = new Date("2026-11-26T12:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  const notificacao = { id: "n", usuarioId: "u", categoria: "EQUIPE", expiraEm: new Date(+agora + 3_600_000),
    dados: { tipo: "NOVO_AGENDAMENTO", agendamentoId: "a", barbeiroId: "b" }, usuario: { ativo: true, notificacaoPreferencia: null } };
  m.listar.mockResolvedValue([{ id: "e", notificacao }]);
  m.entrega.mockResolvedValue({ notificacao, inscricaoId: "s", tentativas: 1, inscricao: { ativo: true, usuarioId: "u", tokenHash: "token", vapidHash: "hash" } });
  m.reservar.mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });
  m.corpo.mockRejectedValue(new Error("Consulta de dados temporariamente indisponível"));
});
it("falha ao recarregar os dados antes do provedor reagenda sem marcar entrega incerta", async () => {
  const r = await processarPush(agora);
  expect(r.adiados).toBe(1); expect(r.incertos).toBe(0); expect(m.enviar).not.toHaveBeenCalled();
  expect(m.salvar).toHaveBeenCalledWith({ where: { id: "e" }, data: { estado: "PENDENTE", codigoErro: "DADOS_INDISPONIVEIS", proximaTentativaEm: new Date(+agora + 300_000) } });
});
it("encerra a falha de dados após três tentativas sem chamar o provedor", async () => {
  const entrega = await m.entrega(); m.entrega.mockResolvedValue({ ...entrega, tentativas: 3 });
  const r = await processarPush(agora);
  expect(r.falhas).toBe(1); expect(m.enviar).not.toHaveBeenCalled();
  expect(m.salvar).toHaveBeenCalledWith({ where: { id: "e" }, data: { estado: "FALHOU", codigoErro: "DADOS_INDISPONIVEIS", proximaTentativaEm: null } });
});
