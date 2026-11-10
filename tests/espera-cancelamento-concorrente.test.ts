import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processarEsperas } from "@/lib/crescimento/rotina";
import { sairDaEspera } from "@/lib/crescimento/espera";

type Estado = "ATIVA" | "AVISADA" | "CANCELADA";
const m = vi.hoisted(() => ({
  estado: "ATIVA" as Estado, canal: vi.fn(), claim: vi.fn(), auditar: vi.fn(), configuracoes: [] as unknown[],
  antesDaTrava: null as null | (() => Promise<void>), filaDaTrava: null as null | (() => void),
  eventos: [] as string[], ocupada: false, fila: [] as Array<() => void>,
}));
vi.mock("@/lib/db", () => {
  const esperaHorario = {
    findMany: async () => [{ id: "espera", clienteId: "cliente", data: new Date("2026-11-11T00:00:00Z"), servicoId: "corte",
      servicosAdicionais: ["barba"], barbeiroId: "b", periodo: "TARDE", origem: "SITE", cliente: { nome: "Fictício", telefone: "5500000000000" } }],
    findFirst: async () => ({ id: "espera", clienteId: "cliente", status: m.estado }),
    count: async (q: { where: { id?: string } }) => q.where.id && m.estado === "ATIVA" ? 1 : 0,
    updateMany: async (q: { where: { id?: string; status?: string | { in: string[] } }; data: { status: Estado } }) => {
      if (!q.where.id) return { count: 0 }; // expiração de outra data
      const status = q.where.status;
      const aceita = !status || (typeof status === "string" ? status === m.estado : status.in.includes(m.estado));
      if (!aceita) return { count: 0 };
      m.estado = q.data.status; m.eventos.push(`status:${m.estado}`); return { count: 1 };
    },
  };
  return { db: {
    esperaHorario, agendamento: { findMany: async () => [] }, servico: { findMany: async () => [{ nome: "Corte" }, { nome: "Barba" }] },
    automacaoEnviada: { create: m.claim, update: vi.fn() },
    $transaction: async (f: (tx: unknown) => Promise<unknown>, configuracao?: unknown) => {
      m.configuracoes.push(configuracao);
      let liberacao: (() => void) | undefined;
      const tx = { esperaHorario, cliente: { findUnique: async () => ({ id: "cliente", excluidoEm: null }) }, $executeRaw: async (_sql: unknown, chave: string) => {
        if (chave !== "espera:cliente") return;
        if (m.antesDaTrava) await m.antesDaTrava();
        if (m.ocupada) {
          m.filaDaTrava?.();
          await new Promise<void>(resolve => m.fila.push(resolve));
        } else m.ocupada = true;
        liberacao = () => { const proxima = m.fila.shift(); if (proxima) proxima(); else m.ocupada = false; };
      } };
      try { return await f(tx); } finally { liberacao?.(); }
    },
  } };
});
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/agenda/consultas", () => ({ horariosDisponiveis: async () => [{ barbeiroId: "b", nome: "Nome", horarios: ["2026-11-11T17:00:00Z"] }] }));
vi.mock("@/lib/crescimento/indicacao", () => ({ converterIndicacoes: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/whatsapp/conversas", () => ({ notificarCliente: m.canal }));
vi.mock("@/lib/recuperacao/quarentena", () => ({ quarentenaRestauracao: () => false }));
vi.mock("@/lib/whatsapp/piloto-regras", () => ({ recursoPiloto: () => false }));
vi.mock("@/lib/whatsapp/teste-equipe", () => ({ testeEquipeAtivo: () => false }));

function barreira() {
  let liberar!: () => void;
  const promessa = new Promise<void>(resolve => { liberar = resolve; });
  return { promessa, liberar };
}
const agora = Date.parse("2026-11-10T14:00:00Z");

describe("cancelamento versus entrega do aviso", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "false");
    m.estado = "ATIVA"; m.antesDaTrava = null; m.filaDaTrava = null; m.ocupada = false;
    m.fila = []; m.eventos = []; m.configuracoes = [];
    m.claim.mockResolvedValue({ id: "claim" }); m.canal.mockResolvedValue({ ok: true, erro: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("cancelamento concluído antes da aquisição impede claim e transporte", async () => {
    const chegou = barreira(), prosseguir = barreira();
    m.antesDaTrava = async () => { chegou.liberar(); await prosseguir.promessa; };
    const rodada = processarEsperas(agora);
    await chegou.promessa;
    m.antesDaTrava = null;
    await sairDaEspera("cliente", "espera");
    expect(m.estado).toBe("CANCELADA");
    prosseguir.liberar();
    expect(await rodada).toBe(0);
    expect(m.claim).not.toHaveBeenCalled(); expect(m.canal).not.toHaveBeenCalled();
    expect(m.configuracoes).toEqual(expect.arrayContaining([{ maxWait: 10_000, timeout: 120_000 }]));
  });

  it("cancelamento concorrente aguarda o canal em curso e confirma após o fechamento do trecho", async () => {
    const entrouNoCanal = barreira(), concluirCanal = barreira(), cancelamentoNaFila = barreira();
    m.canal.mockImplementation(async () => {
      m.eventos.push("canal:inicio"); entrouNoCanal.liberar(); await concluirCanal.promessa;
      m.eventos.push("canal:fim"); return { ok: true, erro: null };
    });
    const rodada = processarEsperas(agora);
    await entrouNoCanal.promessa;
    m.filaDaTrava = cancelamentoNaFila.liberar;
    let cancelamentoConfirmado = false;
    const cancelamento = sairDaEspera("cliente", "espera").then(() => { cancelamentoConfirmado = true; m.eventos.push("cancelamento:confirmado"); });
    await cancelamentoNaFila.promessa;
    expect(cancelamentoConfirmado).toBe(false); expect(m.estado).toBe("ATIVA");
    concluirCanal.liberar();
    expect(await rodada).toBe(1);
    await cancelamento;
    expect(m.eventos).toEqual(["canal:inicio", "canal:fim", "status:AVISADA", "status:CANCELADA", "cancelamento:confirmado"]);
    expect(m.claim).toHaveBeenCalledOnce(); expect(m.canal).toHaveBeenCalledOnce();
    expect(m.configuracoes.filter(Boolean)).toEqual([{ maxWait: 10_000, timeout: 120_000 }, { maxWait: 10_000, timeout: 120_000 }]);
  });
});
