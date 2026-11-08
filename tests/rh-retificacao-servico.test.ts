import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";
import { DECLARACAO_TESTE_FOLHA } from "@/lib/rh/retificacao-regras";
type Estado = { folha: Record<string, unknown>; despesa: Record<string, unknown>; pessoa: Record<string, unknown>; usuario: Record<string, unknown>; evento: Record<string, unknown> | null; lotes: Record<string, unknown>[]; auditorias: unknown[]; salarios: unknown[]; vinculos: number; futura: boolean };
const m = vi.hoisted(() => ({ estado: null as unknown as Estado, falharAuditoria: false, auditar: vi.fn(), atualizarFolha: vi.fn(), atualizarDespesa: vi.fn(), criarEvento: vi.fn() }));
vi.mock("@/lib/rh/folha", () => ({ previaFolha: async () => ({ revisao: "apuracao-ficticia", recebimentos: { completo: false }, conciliacaoAssinaturas: null, linhas: [{ pessoaId: "pessoa-ficticia", vinculoPendente: false, comissaoDetalhe: { semRegra: 0 }, recalculoAtual: { salario: m.estado.pessoa.salarioCentavos, comissao: 20000, adicionais: 300, descontos: 50, liquido: 20350 } }] }) }));
vi.mock("@/lib/rh/trava-regras-folha", () => ({ tocarPessoasDaFolha: vi.fn() }));
vi.mock("@/lib/rh/vigencias", () => ({ competenciasRemuneracao: () => ({ atual: "2026-11" }), garantirBaselineRemuneracao: async () => {}, gravarVigenciaRemuneracao: async (_tx: unknown, d: unknown) => { m.estado.salarios.push(d); } }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/db", () => {
  const tx = { $queryRaw: vi.fn(), usuario: { findUnique: async () => m.estado.usuario },
    checklistPessoa: { findUnique: async () => m.estado.pessoa, update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(m.estado.pessoa, data) },
    folhaPagamento: { findUnique: async () => m.estado.folha, findUniqueOrThrow: async () => m.estado.folha, updateMany: m.atualizarFolha },
    despesa: { findUnique: async () => m.estado.despesa, updateMany: m.atualizarDespesa },
    auditoria: { findFirst: async () => ({ id: "auditoria-original", dados: { forma: "PIX", despesaId: "despesa-ficticia", liquido: 100 }, criadoEm: new Date("2026-11-03Z") }) },
    vinculoDespesaExterna: { count: async () => m.estado.vinculos },
    folhaLotePix: { findMany: async () => m.estado.lotes, update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(m.estado.lotes.find(l => l.id === where.id)!, data) },
    folhaRetificacaoTeste: { findUnique: async ({ where }: { where: { idempotencia?: string; folhaOriginalId?: string } }) => m.estado.evento && (m.estado.evento.idempotencia === where.idempotencia || m.estado.evento.folhaOriginalId === where.folhaOriginalId) ? m.estado.evento : null, create: m.criarEvento },
    remuneracaoVersao: { findFirst: async () => m.estado.futura ? { id: "versao-futura" } : null },
  };
  return { db: { ...tx, $transaction: async (f: (leitor: unknown) => Promise<unknown>) => {
    const anterior = structuredClone(m.estado);
    try { return await f(tx); } catch (e) { m.estado = anterior; throw e; }
  } } };
});
import { previaRetificacaoTeste, retificarTesteFolha } from "@/lib/rh/retificacao";
const dono = { usuarioId: "dono-ficticio", papel: "DONO", nome: "Fixture", sessaoVersao: 2 } as Sessao;
const body = (revisao: string) => ({ folhaId: "folha-ficticia", revisao, idempotencia: "173d07ec-335b-4d11-9af6-680cb8afc86d", motivo: "Registro interno de teste, sem transferência real, confirmado pelo dono.", salarioSubstitutivoCentavos: 600000, valorOriginalConfirmadoCentavos: 100 as const, declaracao: DECLARACAO_TESTE_FOLHA });
beforeEach(() => {
  vi.clearAllMocks(); m.falharAuditoria = false; const em = new Date("2026-11-03T21:49:00Z");
  m.estado = {
    folha: { id: "folha-ficticia", pessoaId: "pessoa-ficticia", competencia: "2026-11", ativa: true, versao: 1, status: "PAGA", salarioCentavos: 100, comissaoCentavos: 0, adicionaisCentavos: 0, descontosCentavos: 0, liquidoCentavos: 100, despesaId: "despesa-ficticia", pagoEm: em },
    despesa: { id: "despesa-ficticia", status: "PAGA", categoria: "FOLHA", valorCentavos: 100, formaPagamento: "PIX", movimentoCaixaId: null, recorrente: false, pagoEm: em },
    pessoa: { id: "pessoa-ficticia", nome: "Fixture", ativo: true, funcao: "BARBEIRO", cargo: "Fixture", barbeiroId: "cadeira-ficticia", salarioCentavos: 100 },
    usuario: { ativo: true, papel: "DONO", sessaoVersao: 2 }, evento: null, vinculos: 0, futura: false,
    lotes: [{ id: "lote-ficticio", estado: "CONFERIDO", enviadoEm: null, referenciaBancaria: null, snapshot: { envioHabilitado: false, itens: [] } }], auditorias: [], salarios: [],
  };
  m.atualizarFolha.mockImplementation(async ({ data }) => { Object.assign(m.estado.folha, data); return { count: 1 }; });
  m.atualizarDespesa.mockImplementation(async ({ data }) => { Object.assign(m.estado.despesa, data); return { count: 1 }; });
  m.criarEvento.mockImplementation(async ({ data }) => m.estado.evento = { id: "retificacao-ficticia", criadoEm: new Date(), ...data });
  m.auditar.mockImplementation(async (...args: unknown[]) => { if (m.falharAuditoria) throw Error("auditoria-ficticia-indisponivel"); m.estado.auditorias.push(args.slice(1)); });
});
afterEach(() => vi.restoreAllMocks());
describe("retificação interna transacional", () => {
  it("prévia confirma o original e propõe o fixo mais comissão, sem descontar o teste ou fechar", async () => {
    const p = await previaRetificacaoTeste(dono, "folha-ficticia", 600000);
    expect(p.podeRetificar).toBe(true); expect(p.folhaOriginal.liquidoCentavos).toBe(100);
    expect(p.substitutiva).toMatchObject({ salario: 600000, comissao: 20000, adicionais: 300, descontos: 50, liquido: 620250 });
    expect(p.propostaPendente).toBe(true); expect(m.criarEvento).not.toHaveBeenCalled();
  });
  it("preserva o retrato original e a despesa, anula apenas estado contábil e invalida preparações", async () => {
    const p = await previaRetificacaoTeste(dono, "folha-ficticia", 600000), original = structuredClone(m.estado.folha), despesa = structuredClone(m.estado.despesa);
    const r = await retificarTesteFolha(dono, body(p.revisao));
    expect(r).toMatchObject({ retificacaoId: "retificacao-ficticia", substitutivaFechada: false });
    expect(m.estado.folha).toEqual({ ...original, ativa: false }); expect(m.estado.despesa).toEqual({ ...despesa, status: "ANULADA_TESTE" });
    expect(m.estado.evento?.snapshotFolha).toEqual(JSON.parse(JSON.stringify(original))); expect(m.estado.evento?.snapshotDespesa).toEqual(JSON.parse(JSON.stringify(despesa)));
    expect(m.estado.pessoa.salarioCentavos).toBe(600000); expect(m.estado.salarios).toHaveLength(1); expect(m.estado.lotes[0].estado).toBe("INVALIDADO");
    expect(m.estado.auditorias).toHaveLength(1); expect(m.auditar.mock.calls[0][5]).toMatchObject({ transferenciaExecutada: false, valorAnuladoCentavos: 100 });
  });
  it("mesma tentativa reaproveita evento e rejeita reutilização com outro motivo", async () => {
    const p = await previaRetificacaoTeste(dono, "folha-ficticia", 600000), d = body(p.revisao);
    await retificarTesteFolha(dono, d); expect((await retificarTesteFolha(dono, d)).jaRegistrada).toBe(true);
    expect(m.criarEvento).toHaveBeenCalledTimes(1); expect(m.estado.auditorias).toHaveLength(1);
    await expect(retificarTesteFolha(dono, { ...d, motivo: "Outro motivo modifica a confirmação original do pedido." })).rejects.toMatchObject({ codigo: "retificacao_idempotencia" });
  });
  it("nova chave não repete retificação já registrada no mesmo original", async () => {
    const p = await previaRetificacaoTeste(dono, "folha-ficticia", 600000), d = body(p.revisao); await retificarTesteFolha(dono, d);
    await expect(retificarTesteFolha(dono, { ...d, idempotencia: "be5371e9-9f34-4e11-b98f-378e5b90e4dd" })).rejects.toMatchObject({ codigo: "folha_ja_retificada" });
  });
  it("revalida dono ativo e sessão, sem aceitar gerente com permissão de folha", async () => {
    await expect(previaRetificacaoTeste({ ...dono, papel: "GERENTE" }, "folha-ficticia", 600000)).rejects.toMatchObject({ status: 403 });
    for (const u of [{ ativo: false, papel: "DONO", sessaoVersao: 2 }, { ativo: true, papel: "GERENTE", sessaoVersao: 2 }, { ativo: true, papel: "DONO", sessaoVersao: 3 }]) {
      m.estado.usuario = u; await expect(retificarTesteFolha(dono, body("a".repeat(64)))).rejects.toMatchObject({ status: 403 });
    }
    expect(m.criarEvento).not.toHaveBeenCalled();
  });
  it("prévia antiga ou evidência bancária impede escrita", async () => {
    const p = await previaRetificacaoTeste(dono, "folha-ficticia", 600000); m.estado.pessoa.salarioCentavos = 200;
    await expect(retificarTesteFolha(dono, body(p.revisao))).rejects.toMatchObject({ codigo: "retificacao_mudou" });
    m.estado.vinculos = 1; const atual = await previaRetificacaoTeste(dono, "folha-ficticia", 600000);
    expect(atual.podeRetificar).toBe(false);
    await expect(retificarTesteFolha(dono, body(atual.revisao))).rejects.toMatchObject({ codigo: "retificacao_bloqueada" });
    expect(m.criarEvento).not.toHaveBeenCalled();
  });
  it("falha de auditoria desfaz evento, salário, estados e invalidação juntos", async () => {
    const p = await previaRetificacaoTeste(dono, "folha-ficticia", 600000), antes = structuredClone(m.estado); m.falharAuditoria = true;
    await expect(retificarTesteFolha(dono, body(p.revisao))).rejects.toThrow("auditoria-ficticia-indisponivel");
    expect(m.estado).toEqual(antes);
  });
  it("não sobrescreve rascunho salarial de competência futura", async () => {
    m.estado.futura = true; m.estado.pessoa.salarioCentavos = 700000;
    const p = await previaRetificacaoTeste(dono, "folha-ficticia", 600000); await retificarTesteFolha(dono, body(p.revisao));
    expect(m.estado.pessoa.salarioCentavos).toBe(700000); expect(m.estado.salarios[0]).toMatchObject({ competencia: "2026-11", conteudo: { salarioCentavos: 600000 } });
  });
});
