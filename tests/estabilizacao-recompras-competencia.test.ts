import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";

const m = vi.hoisted(() => ({ versao: vi.fn(), raw: vi.fn(), criar: vi.fn(), upsert: vi.fn(), emTransacao: false, alterarNaAprovacao: false, fim: "2026-12-01T03:00:00Z" }));
vi.mock("@/lib/db", () => {
  const principal = () => ({ id: "principal", barbeiroId: "barbeiro", clienteId: "cliente", servicoId: "corte", inicio: new Date("2026-11-30T23:00:00Z"), fim: new Date(m.fim), status: "CONFIRMADO", cadeiraId: null, adicionalDeId: null, cliente: { nome: "Cliente fictício" }, itemComanda: null, barbeiro: { ativo: true, nome: "Barbeiro fictício" } });
  const servico = () => ({ id: "barba", nome: "Barba", ativo: true, intervaloRecompraDias: 30, duracaoMin: 30, precoCentavos: 10000, custoCentavos: 1000, barbeiros: [{ barbeiroId: "barbeiro", duracaoMin: null, precoCentavos: null }] });
  const tx = {
    $executeRaw: vi.fn(), $queryRaw: vi.fn(), remuneracaoVersao: { findFirst: m.versao }, comissaoServico: { findMany: m.raw },
    agendamento: { findUnique: async () => principal(), findUniqueOrThrow: async () => principal(),
      findMany: async ({ where }: { where: { barbeiroId?: string } }) => where.barbeiroId ? [principal()] : [], count: async () => 0, create: m.criar },
    servico: { findMany: async () => [servico()], findUniqueOrThrow: async () => servico() },
    ofertaRecompra: { findUnique: async () => null, findMany: async () => [], findFirst: async () => null, upsert: m.upsert },
    adicionalComissao: { findMany: async () => [] },
    recompraConfig: { findUniqueOrThrow: async () => ({ descontoAtivo: true, descontoPct: 20, descontoMaxCentavos: 2000, descontoValidadeDias: 7, reativacaoDias: 30, margemMinimaPct: 20 }) },
    comanda: { create: async () => ({ id: "comanda-ficticia", status: "ABERTA" }) }, itemComanda: { create: async () => ({ id: "item-ficticio" }) },
  };
  return { db: { ...tx, $transaction: async (fn: (c: typeof tx) => Promise<unknown>) => { m.emTransacao = true; try { return await fn(tx); } finally { m.emTransacao = false; } } } };
});
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo", intervaloEntreClientes: 0 }), STATUS_ATIVOS: ["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO"],
  carregarDia: async () => new Map([["barbeiro", { janelas: [{ inicio: +new Date("2026-11-30T03:00:00Z"), fim: +new Date("2026-12-02T03:00:00Z") }], bloqueios: [], agendamentos: [] }]]) }));
vi.mock("@/lib/recompras/configuracao", () => ({ configRecompras: async () => ({ ativo: true, descontoAtivo: true, descontoPct: 20, descontoMaxCentavos: 2000, descontoValidadeDias: 7, reativacaoDias: 30, margemMinimaPct: 20 }) }));
vi.mock("@/lib/recompras/historico", () => ({ ultimasCompras: async () => ({ ultimas: new Map([["cliente:barba", { fim: new Date("2026-10-01T15:00:00Z") }]]), visitas: new Map([["cliente", new Date("2026-10-01T15:00:00Z")]]) }) }));
vi.mock("@/lib/agenda/cadeiras", () => ({ ocupacaoCadeira: async () => [], validarCadeira: vi.fn() }));
vi.mock("@/lib/agenda/agendamentos", () => ({ travarBarbeiro: vi.fn(), validarEncaixe: vi.fn() }));
vi.mock("@/lib/assinaturas/agenda", () => ({ precificar: async () => ({ precoCentavos: 10000, assinaturaId: null }) }));
vi.mock("@/lib/rh/adicionais", () => ({ adicionaisDoCalculo: async () => [], listarAdicionais: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirGestaoBarbeiro: vi.fn() }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirPermissao: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn() }));
vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));
import { oportunidadesDoDia } from "@/lib/recompras/servico";
import { registrarOferta } from "@/lib/recompras/ofertas";

const regra = (pct: number) => [{ servicoId: "barba", barbeiroId: null, avulsoTipo: "PERCENTUAL", avulsoValor: pct, planoTipo: "FIXO", planoValor: 1500 }];
const s: Sessao = { usuarioId: "usuario", nome: "Dono fictício", papel: "DONO", barbeiroId: null, clienteId: null };
const aceitar = () => registrarOferta(s, { agendamentoId: "principal", servicoId: "barba", estado: "ACEITOU", aplicarDesconto: true });
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-30T12:00:00Z"));
  m.emTransacao = false; m.alterarNaAprovacao = false; m.fim = "2026-12-01T03:00:00Z";
  m.raw.mockResolvedValue(regra(9900));
  m.criar.mockImplementation(async ({ data }: { data: object }) => ({ id: "novo-ficticio", ...data }));
  m.upsert.mockImplementation(async ({ create }: { create: object }) => ({ id: "oferta-ficticia", ...create }));
  m.versao.mockImplementation(async ({ where }: { where: { escopo: string; competencia: { lte: string } } }) => ({
    competencia: where.competencia.lte, versao: m.emTransacao && m.alterarNaAprovacao ? 2 : 1,
    conteudoJson: { origem: "CONFIGURACAO_EXPLICITA", conteudo: where.escopo === "servicos" ? regra(m.emTransacao && m.alterarNaAprovacao ? 8000 : where.competencia.lte < "2026-12" ? 4000 : 6000)
      : { assinaturas: { ativo: false, percentualBps: 3500, creditos: { barba: 1 } }, faixas: [] } },
  }));
});
afterEach(() => vi.useRealTimers());

describe("recompra observa a competência local do encaixe e confere novamente no aceite", () => {
  it("virada UTC não antecipa dezembro; encaixe após meia-noite local usa dezembro", async () => {
    m.fim = "2026-12-01T02:30:00Z";
    expect((await oportunidadesDoDia("barbeiro", "2026-11-30"))[0].comissaoCentavos).toBe(4000);
    expect(m.versao.mock.calls.every(([q]) => q.where.competencia.lte === "2026-11")).toBe(true);
    m.versao.mockClear(); m.fim = "2026-12-01T03:00:00Z";
    expect((await oportunidadesDoDia("barbeiro", "2026-11-30"))[0]).toMatchObject({ comissaoCentavos: 6000, descontoCentavos: 2000 });
    expect(m.versao.mock.calls.every(([q]) => q.where.competencia.lte === "2026-12")).toBe(true);
    expect(m.raw).not.toHaveBeenCalled();
  });
  it("aceite conserva desconto com a versão do encaixe, mesmo havendo rascunho futuro mais caro", async () => {
    await aceitar();
    expect(m.criar).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ precoCentavos: 8000 }) }));
    expect(m.raw).not.toHaveBeenCalled(); expect(m.upsert).toHaveBeenCalledOnce();
    expect(m.versao.mock.calls.every(([q]) => q.where.competencia.lte === "2026-12")).toBe(true);
  });
  it("versão alterada entre a recomendação e o aceite impede reservar ou conceder desconto antigo", async () => {
    m.alterarNaAprovacao = true;
    await expect(aceitar()).rejects.toMatchObject({ codigo: "recompra_remuneracao_mudou", status: 409 });
    expect(m.criar).not.toHaveBeenCalled(); expect(m.upsert).not.toHaveBeenCalled();
  });
});
