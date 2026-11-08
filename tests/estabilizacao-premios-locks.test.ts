import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";

type Premio = { id: string; clienteId: string; comandaId: string | null; status: string; tipo: string; codigo: string; rotulo: string; agendamentoId: string | null; utilizadoEm: Date | null; descontoAplicadoCentavos: number; valorCentavos: number; percentual: number; expiraEm: null; servicoId: null };
const m = vi.hoisted(() => ({
  premio: null as Premio | null, leituras: [] as (Premio | null)[], locks: [] as string[],
  comanda: { id: "comanda-ficticia", clienteId: "cliente-ficticio", status: "ABERTA", descontoCentavos: 500 },
  atualizarComanda: vi.fn(), atualizarPremio: vi.fn(), auditar: vi.fn(), avisar: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => { m.locks.push(strings.join("?").includes("FROM comandas") ? "comanda" : "premio"); return []; },
    premioGanho: { findUnique: async () => m.leituras.length ? m.leituras.shift() : m.premio, update: m.atualizarPremio },
    comanda: { findUnique: async () => ({ ...m.comanda, itens: [{ quantidade: 1, precoUnitCentavos: 5000, agendamento: null }], pagamentos: [], linksPagamento: [] }), update: m.atualizarComanda },
  };
  return { db: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/comandas/servico", () => ({ avisarComanda: m.avisar }));
vi.mock("@/lib/jogos/motor", () => ({ premioParaCliente: vi.fn() }));
import { desfazerValidacao, validarPremio } from "@/lib/jogos/premios";
const sessao = { usuarioId: "dono-ficticio", papel: "DONO", nome: "Dono fictício", barbeiroId: null, clienteId: null } as Sessao;

beforeEach(() => {
  vi.clearAllMocks(); m.locks = []; m.leituras = [];
  m.comanda = { id: "comanda-ficticia", clienteId: "cliente-ficticio", status: "ABERTA", descontoCentavos: 500 };
  m.premio = { id: "premio-ficticio", clienteId: "cliente-ficticio", comandaId: "comanda-ficticia", status: "UTILIZADO", tipo: "DESCONTO", codigo: "BB-FICTICIO", rotulo: "Prêmio fictício", agendamentoId: null, utilizadoEm: new Date(), descontoAplicadoCentavos: 500, valorCentavos: 500, percentual: 0, expiraEm: null, servicoId: null };
});

describe("prêmio e comanda preservam a ordem de travas do cancelamento", () => {
  it("desfaz com comanda travada antes do prêmio e do desconto", async () => {
    await desfazerValidacao(sessao, "premio-ficticio");
    expect(m.locks).toEqual(["comanda", "premio"]);
    expect(m.atualizarComanda).toHaveBeenCalledWith({ where: { id: "comanda-ficticia" }, data: { descontoCentavos: 0 } });
    expect(m.atualizarPremio).toHaveBeenCalledOnce();
  });
  it("relê o prêmio e recusa vínculo alterado enquanto aguardava a comanda", async () => {
    m.leituras = [{ ...m.premio! }, { ...m.premio!, comandaId: "outra-comanda" }];
    await expect(desfazerValidacao(sessao, "premio-ficticio")).rejects.toMatchObject({ codigo: "premio_alterado", status: 409 });
    expect(m.locks).toEqual(["comanda", "premio"]);
    expect(m.atualizarComanda).not.toHaveBeenCalled(); expect(m.atualizarPremio).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
  });
  it("não muda desconto quando o cancelamento foi concluído antes da releitura", async () => {
    m.leituras = [{ ...m.premio! }, { ...m.premio!, comandaId: null, status: "DISPONIVEL" }];
    await expect(desfazerValidacao(sessao, "premio-ficticio")).rejects.toMatchObject({ codigo: "premio_alterado" });
    expect(m.atualizarComanda).not.toHaveBeenCalled(); expect(m.atualizarPremio).not.toHaveBeenCalled();
  });
  it("prêmio sem comanda não adquire uma comanda depois de travar o prêmio", async () => {
    m.premio!.comandaId = null; m.premio!.descontoAplicadoCentavos = 0;
    await desfazerValidacao(sessao, "premio-ficticio");
    expect(m.locks).toEqual(["premio"]); expect(m.atualizarComanda).not.toHaveBeenCalled();
  });
  it("valida desconto na mesma ordem comanda e prêmio", async () => {
    m.premio!.status = "DISPONIVEL"; m.premio!.comandaId = null; m.premio!.percentual = 10; m.comanda.descontoCentavos = 0;
    await validarPremio(sessao, "premio-ficticio", { comandaId: "comanda-ficticia" });
    expect(m.locks).toEqual(["comanda", "premio"]); expect(m.atualizarComanda).toHaveBeenCalledOnce();
  });
  it("desfazer não reabre comanda já fechada", async () => {
    m.comanda.status = "FECHADA";
    await expect(desfazerValidacao(sessao, "premio-ficticio")).rejects.toMatchObject({ status: 409 });
    expect(m.atualizarComanda).not.toHaveBeenCalled(); expect(m.atualizarPremio).not.toHaveBeenCalled();
  });
});
