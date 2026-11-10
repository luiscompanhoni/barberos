import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processarEsperas } from "@/lib/crescimento/rotina";
import { excluirConta, mudarMensagens } from "@/lib/lgpd/titular";
import { editarCliente } from "@/lib/clientes/gestao";

type Cliente = { id: string; nome: string; telefone: string; usuarioId: string | null; aceitaMensagens: boolean; excluidoEm: Date | null };
const telefone = "5500000000000";
const m = vi.hoisted(() => ({
  cliente: null as Cliente | null, estado: "ATIVA", eventos: [] as string[],
  canal: vi.fn(), claim: vi.fn(), resultado: vi.fn(), auditar: vi.fn(),
  antesDaTrava: null as null | ((dono: number, chave: string) => Promise<void>),
  naFila: null as null | (() => void), proximoDono: 0,
  travas: new Map<string, { dono: number; fila: Array<{ dono: number; liberar: () => void }> }>(),
}));

vi.mock("@/lib/db", () => {
  const vazio = { count: async () => 0, deleteMany: async () => ({ count: 0 }), updateMany: async () => ({ count: 0 }) };
  const cliente = {
    findUnique: async () => m.cliente ? { ...m.cliente } : null,
    findFirst: async () => m.cliente && !m.cliente.excluidoEm ? { ...m.cliente } : null,
    update: async ({ data }: { data: Partial<Cliente> }) => Object.assign(m.cliente!, data),
    updateMany: async ({ where, data }: { where: { telefone: string }; data: Partial<Cliente> }) => {
      if (m.cliente?.telefone !== where.telefone) return { count: 0 };
      Object.assign(m.cliente, data); return { count: 1 };
    },
  };
  const esperaHorario = {
    findMany: async () => [{ id: "espera", clienteId: "cliente", data: new Date("2026-11-11T00:00:00Z"), servicoId: "corte",
      servicosAdicionais: [], barbeiroId: "b", periodo: "TARDE", origem: "SITE", cliente: { nome: "Fictício", telefone: "5500000000000" } }],
    count: async ({ where }: { where: { id?: string; cliente?: { telefone: string } } }) =>
      where.id && m.estado === "ATIVA" && m.cliente?.aceitaMensagens && !m.cliente.excluidoEm && m.cliente.telefone === where.cliente?.telefone ? 1 : 0,
    updateMany: async ({ where, data }: { where: { id?: string }; data: { status: string } }) => {
      if (!where.id) return { count: 0 };
      m.estado = data.status; return { count: 1 };
    },
    deleteMany: async () => { m.estado = "EXCLUIDA"; return { count: 1 }; },
  };
  const tabelas = {
    cliente, esperaHorario, usuario: { findUnique: async () => ({ id: "usuario", papel: "CLIENTE", ativo: true, sessaoVersao: 0 }), update: async () => ({}) },
    conversa: vazio, assinatura: vazio, cobranca: vazio, pagamentoAntecipado: vazio, linkPagamento: vazio,
    comanda: vazio, codigoLogin: vazio, listaEsperaPlano: vazio, avaliacaoMensalElegibilidade: vazio,
    pedidoAgendamento: vazio, identidadeSocial: vazio, fluxoSocial: vazio,
    agendamento: { ...vazio, findMany: async () => [] }, servico: { findMany: async () => [{ nome: "Corte" }] },
    automacaoEnviada: { create: m.claim, update: m.resultado },
  };
  return { db: {
    ...tabelas,
    $transaction: async (f: (tx: unknown) => Promise<unknown>) => {
      const dono = ++m.proximoDono;
      const adquiridas = new Set<string>();
      const tx = { ...tabelas, $queryRaw: async () => [], $executeRaw: async (_sql: unknown, chave: string) => {
        if (adquiridas.has(chave)) return;
        await m.antesDaTrava?.(dono, chave);
        const atual = m.travas.get(chave);
        if (atual) {
          m.naFila?.();
          await new Promise<void>(liberar => atual.fila.push({ dono, liberar }));
        } else m.travas.set(chave, { dono, fila: [] });
        adquiridas.add(chave);
        m.eventos.push(`trava:${dono}:${chave}`);
      } };
      try { return await f(tx); } finally {
        for (const chave of [...adquiridas].reverse()) {
          const atual = m.travas.get(chave)!;
          const proxima = atual.fila.shift();
          if (proxima) { atual.dono = proxima.dono; proxima.liberar(); }
          else m.travas.delete(chave);
        }
      }
    },
  } };
});
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/crescimento/espera", () => ({ opcoesDoDia: async () => [{ barbeiroId: "b", nome: "Nome", inicio: "2026-11-11T17:00:00Z", minutos: 840 }], descreverOpcao: () => "14h com Nome" }));
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
const acoes = ["exclusão", "recusa", "troca de telefone"] as const;
async function alterar(acao: typeof acoes[number]) {
  if (acao === "exclusão") await excluirConta("cliente", "usuario");
  else if (acao === "recusa") await mudarMensagens("cliente", "usuario", false);
  else await editarCliente("cliente", { telefone: "5500000000001" }, "gestor");
}

describe("privacidade concorrente à entrega do aviso", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "false");
    m.cliente = { id: "cliente", nome: "Fictício", telefone, usuarioId: "usuario", aceitaMensagens: true, excluidoEm: null };
    m.estado = "ATIVA"; m.eventos = []; m.proximoDono = 0; m.travas.clear(); m.antesDaTrava = null; m.naFila = null;
    m.claim.mockResolvedValue({ id: "claim" }); m.canal.mockResolvedValue({ ok: true, erro: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(acoes)("%s concluída antes da trava impede claim e transporte", async acao => {
    if (acao === "troca de telefone") m.cliente!.usuarioId = null;
    const chegou = barreira(), prosseguir = barreira();
    m.antesDaTrava = async dono => { if (dono === 1) { chegou.liberar(); await prosseguir.promessa; } };
    const rodada = processarEsperas(agora);
    await chegou.promessa;
    m.antesDaTrava = null;
    try { await alterar(acao); } finally { prosseguir.liberar(); }
    expect(await rodada).toBe(0);
    expect(m.claim).not.toHaveBeenCalled(); expect(m.canal).not.toHaveBeenCalled();
  });

  it.each(acoes)("%s aguarda a entrega iniciada antes de confirmar a alteração", async acao => {
    if (acao === "troca de telefone") m.cliente!.usuarioId = null;
    const entrouNoCanal = barreira(), concluirCanal = barreira(), naFila = barreira();
    m.canal.mockImplementation(async () => {
      m.eventos.push("canal:inicio"); entrouNoCanal.liberar(); await concluirCanal.promessa;
      m.eventos.push("canal:fim"); return { ok: true, erro: null };
    });
    const rodada = processarEsperas(agora);
    await entrouNoCanal.promessa;
    m.naFila = naFila.liberar;
    const mudanca = alterar(acao).then(() => m.eventos.push("alteracao:confirmada"));
    try {
      expect(await Promise.race([naFila.promessa.then(() => "aguardando"), mudanca.then(() => "concluída")])).toBe("aguardando");
      expect(m.eventos).not.toContain("alteracao:confirmada");
    } finally {
      concluirCanal.liberar();
      await rodada; await mudanca;
    }
    expect(m.eventos.indexOf("alteracao:confirmada")).toBeGreaterThan(m.eventos.indexOf("canal:fim"));
    expect(m.claim).toHaveBeenCalledOnce(); expect(m.canal).toHaveBeenCalledOnce();
  });

  it("usa ciclo, preferência e espera nessa ordem antes de reservar o envio", async () => {
    await processarEsperas(agora);
    expect(m.eventos.filter(e => e.startsWith("trava:1:"))).toEqual([
      "trava:1:cliente-ciclo:cliente", `trava:1:whatsapp-optout:${telefone}`, "trava:1:espera:cliente",
    ]);
  });

  it("falha ambígua preserva o claim e uma nova rodada não repete o transporte", async () => {
    m.canal.mockRejectedValue(new Error("Timeout depois de iniciar o transporte"));
    m.claim.mockResolvedValueOnce({ id: "claim" }).mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicado", { code: "P2002", clientVersion: "6" }));
    expect(await processarEsperas(agora)).toBe(0);
    expect(await processarEsperas(agora)).toBe(0);
    expect(m.claim).toHaveBeenCalledTimes(2); expect(m.canal).toHaveBeenCalledOnce();
    expect(m.resultado).toHaveBeenCalledWith({ where: { id: "claim" }, data: { ok: false, erro: "Timeout depois de iniciar o transporte" } });
    expect(m.estado).toBe("ATIVA");
  });
});
