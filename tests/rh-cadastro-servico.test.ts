import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";

type Ator = { ativo: boolean; papel: string; sessaoVersao: number };
type Pessoa = { id: string; telefone: string; [campo: string]: unknown };
type RegistroAuditoria = { usuarioId: string; acao: string; entidadeId: string; dados: Record<string, unknown> };
type Estado = { ator: Ator | null; pessoas: Pessoa[]; baselines: unknown[]; vigencias: unknown[]; auditorias: RegistroAuditoria[] };
const m = vi.hoisted(() => ({
  estado: null as unknown as Estado, tx: null as unknown, falharBaseline: false, falharVigencia: false, falharAuditoria: false,
  transacao: vi.fn(), trava: vi.fn(), criar: vi.fn(), baseline: vi.fn(), vigencia: vi.fn(), auditar: vi.fn(), competencia: vi.fn(), fetch: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  m.tx = {
    $queryRaw: m.trava,
    usuario: { findUnique: async () => m.estado.ator },
    auditoria: { findFirst: async ({ where }: { where: { acao: string; usuarioId: string; dados: { equals: string } } }) =>
      m.estado.auditorias.find(a => a.acao === where.acao && a.usuarioId === where.usuarioId && a.dados.idempotencia === where.dados.equals) ?? null },
    checklistPessoa: { findMany: async () => m.estado.pessoas, create: m.criar },
  };
  return { db: { $transaction: m.transacao } };
});
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/rh/vigencias", () => ({
  competenciaSalario: m.competencia,
  garantirBaselineRemuneracao: m.baseline,
  gravarVigenciaRemuneracao: m.vigencia,
}));
import { criarPessoaRh, zPessoaRh } from "@/lib/rh/cadastro";

const dono = { usuarioId: "dono-ficticio-cadastro", papel: "DONO", nome: "Dono sintético", sessaoVersao: 4 } as Sessao;
const pedido = () => ({
  nome: "Pessoa sintética do RH", telefone: "(11) 95555-1041", cargo: "Sócio fictício",
  salarioCentavos: 275000, competenciaSalario: "2032-07", idempotencia: "583edac1-b340-4c85-a57c-312b55e2efa3",
});
beforeEach(() => {
  vi.resetAllMocks();
  m.fetch.mockRejectedValue(Error("Rede externa bloqueada no cadastro sintético")); vi.stubGlobal("fetch", m.fetch);
  m.falharAuditoria = false; m.falharBaseline = false; m.falharVigencia = false;
  m.estado = { ator: { ativo: true, papel: "DONO", sessaoVersao: 4 }, pessoas: [], baselines: [], vigencias: [], auditorias: [] };
  m.transacao.mockImplementation(async (f: (tx: unknown) => Promise<unknown>) => {
    const antes = structuredClone(m.estado);
    try { return await f(m.tx); } catch (e) { m.estado = antes; throw e; }
  });
  m.competencia.mockImplementation((valor: string) => valor);
  m.criar.mockImplementation(async ({ data }: { data: Record<string, unknown> & { telefone: string } }) => {
    const pessoa = { id: `rh-ficticio-${m.estado.pessoas.length + 1}`, usuarioId: null, barbeiroId: null, ...data };
    m.estado.pessoas.push(pessoa); return pessoa;
  });
  m.baseline.mockImplementation(async (_tx: unknown, escopo: string, conteudo: unknown, atorId: string) => {
    if (m.falharBaseline) throw Error("baseline-ficticio-indisponivel");
    m.estado.baselines.push({ escopo, conteudo, atorId });
  });
  m.vigencia.mockImplementation(async (_tx: unknown, dados: unknown) => {
    if (m.falharVigencia) throw Error("vigencia-ficticia-indisponivel");
    m.estado.vigencias.push(dados);
  });
  m.auditar.mockImplementation(async (_tx: unknown, usuarioId: string, acao: string, _entidade: string, entidadeId: string, dados: Record<string, unknown>) => {
    if (m.falharAuditoria) throw Error("auditoria-ficticia-indisponivel");
    m.estado.auditorias.push({ usuarioId, acao, entidadeId, dados });
  });
});
afterEach(() => { expect(m.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("cadastro transacional de pessoa exclusiva do RH", () => {
  it("cria ficha neutra ativa, remuneração versionada e auditoria sem criar acesso ou cadeira", async () => {
    const r = await criarPessoaRh(dono, pedido());
    expect(r).toEqual({ pessoaId: "rh-ficticio-1", jaRegistrada: false });
    expect(m.estado.pessoas).toHaveLength(1);
    expect(m.estado.pessoas[0]).toMatchObject({ telefone: "5511955551041", funcao: null, ativo: true, usuarioId: null, barbeiroId: null, salarioCentavos: 275000 });
    expect(m.estado.pessoas[0].token).toMatch(/^[a-f0-9]{48}$/);
    expect(m.criar.mock.calls[0][0].data).not.toHaveProperty("usuarioId");
    expect(m.criar.mock.calls[0][0].data).not.toHaveProperty("barbeiroId");
    expect(m.estado.auditorias).toHaveLength(1);
    expect(m.estado.auditorias[0]).toMatchObject({ usuarioId: dono.usuarioId, acao: "rh_pessoa_criar", entidadeId: r.pessoaId,
      dados: { idempotencia: pedido().idempotencia, checklist: false, acessoCriado: false, cadeiraCriada: false, competenciaSalario: "2032-07" } });
    expect(m.estado.auditorias[0].dados.hashPedido).toMatch(/^[a-f0-9]{64}$/);
    expect(m.trava).toHaveBeenCalledBefore(m.criar);
    expect(m.transacao.mock.calls[0][1]).toEqual({ timeout: 30_000 });
  });

  it("usa baseline zero e a competência escolhida, sem antecipar a remuneração futura", async () => {
    const r = await criarPessoaRh(dono, pedido()), escopo = `salario:${r.pessoaId}`;
    expect(m.competencia).toHaveBeenCalledWith("2032-07");
    expect(m.estado.baselines).toEqual([{ escopo, conteudo: { salarioCentavos: 0 }, atorId: dono.usuarioId }]);
    expect(m.estado.vigencias).toEqual([{ escopo, competencia: "2032-07", conteudo: { salarioCentavos: 275000 }, atorId: dono.usuarioId }]);
    expect(m.baseline).toHaveBeenCalledBefore(m.vigencia); expect(m.vigencia).toHaveBeenCalledBefore(m.auditar);
  });

  it("reaproveita a mesma tentativa sem duplicar pessoa, versão ou auditoria", async () => {
    const d = pedido(), a = await criarPessoaRh(dono, d), b = await criarPessoaRh(dono, d);
    expect(b).toEqual({ pessoaId: a.pessoaId, jaRegistrada: true });
    expect(m.criar).toHaveBeenCalledTimes(1); expect(m.baseline).toHaveBeenCalledTimes(1);
    expect(m.vigencia).toHaveBeenCalledTimes(1); expect(m.auditar).toHaveBeenCalledTimes(1);
  });

  it("preserva a resposta idempotente quando a competência original já não admite novas criações", async () => {
    const d = pedido(), a = await criarPessoaRh(dono, d);
    m.competencia.mockImplementation(() => { throw Error("competencia-ficticia-agora-passada"); });
    expect(await criarPessoaRh(dono, d)).toEqual({ pessoaId: a.pessoaId, jaRegistrada: true });
    expect(m.competencia).toHaveBeenCalledTimes(1);
    expect(m.criar).toHaveBeenCalledTimes(1); expect(m.auditar).toHaveBeenCalledTimes(1);
  });

  it("recusa reutilizar a tentativa com outro conteúdo, preservando a criação original", async () => {
    const d = pedido(); await criarPessoaRh(dono, d); const antes = structuredClone(m.estado);
    await expect(criarPessoaRh(dono, { ...d, salarioCentavos: 280000 })).rejects.toMatchObject({ status: 409, codigo: "rh_cadastro_idempotencia" });
    expect(m.estado).toEqual(antes); expect(m.criar).toHaveBeenCalledTimes(1);
  });

  it("recusa contato já existente mesmo com formatação diferente e chave nova", async () => {
    m.estado.pessoas.push({ id: "legado-ficticio", telefone: "+55 (11) 95555-1041", funcao: "DIARISTA", ativo: false });
    const antes = structuredClone(m.estado);
    await expect(criarPessoaRh(dono, pedido())).rejects.toMatchObject({ status: 409, codigo: "rh_cadastro_duplicado" });
    expect(m.estado).toEqual(antes); expect(m.criar).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
  });

  it("exige DONO antes da transação, mesmo para gerente autorizado a consultar folha", async () => {
    await expect(criarPessoaRh({ ...dono, papel: "GERENTE" }, pedido())).rejects.toMatchObject({ status: 403 });
    expect(m.transacao).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
  });

  it.each([
    ["inexistente", null],
    ["inativo", { ativo: false, papel: "DONO", sessaoVersao: 4 }],
    ["rebaixado", { ativo: true, papel: "GERENTE", sessaoVersao: 4 }],
    ["sessão revogada", { ativo: true, papel: "DONO", sessaoVersao: 5 }],
  ] as const)("revalida dono %s no banco antes de escrever ou reaproveitar tentativa", async (_caso, ator) => {
    await criarPessoaRh(dono, pedido()); m.estado.ator = ator; const antes = structuredClone(m.estado);
    await expect(criarPessoaRh(dono, pedido())).rejects.toMatchObject({ status: 403 });
    expect(m.estado).toEqual(antes); expect(m.criar).toHaveBeenCalledTimes(1);
  });

  it.each(["baseline", "vigencia", "auditoria"] as const)("falha de %s desfaz ficha e todos os registros da mesma transação", async etapa => {
    const antes = structuredClone(m.estado);
    if (etapa === "baseline") m.falharBaseline = true;
    if (etapa === "vigencia") m.falharVigencia = true;
    if (etapa === "auditoria") m.falharAuditoria = true;
    await expect(criarPessoaRh(dono, pedido())).rejects.toThrow("indisponivel");
    expect(m.estado).toEqual(antes);
    m.falharBaseline = false; m.falharVigencia = false; m.falharAuditoria = false;
    expect(await criarPessoaRh(dono, pedido())).toMatchObject({ jaRegistrada: false });
    expect(m.estado.pessoas).toHaveLength(1); expect(m.estado.auditorias).toHaveLength(1);
  });

  it("nega função, vínculo ou chave Pix extras no contrato de criação", () => {
    for (const campo of [{ funcao: "GERENTE" }, { usuarioId: "acesso-ficticio" }, { barbeiroId: "cadeira-ficticia" }, { chavePix: "fixture@example.invalid" }]) {
      expect(zPessoaRh.safeParse({ ...pedido(), ...campo }).success).toBe(false);
    }
    expect(m.transacao).not.toHaveBeenCalled();
  });

  it("telefone inválido e competência recusada não iniciam escrita", async () => {
    await expect(criarPessoaRh(dono, { ...pedido(), telefone: "telefone-invalido" })).rejects.toThrow("Telefone inválido");
    expect(m.transacao).not.toHaveBeenCalled();
    m.competencia.mockImplementation(() => { throw Error("competencia-ficticia-recusada"); });
    await expect(criarPessoaRh(dono, pedido())).rejects.toThrow("competencia-ficticia-recusada");
    expect(m.criar).not.toHaveBeenCalled(); expect(m.baseline).not.toHaveBeenCalled();
    expect(m.vigencia).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
  });
});
