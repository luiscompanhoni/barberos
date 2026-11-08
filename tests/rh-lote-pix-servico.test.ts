import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ perm: vi.fn(), audit: vi.fn(), folhas: vi.fn(), lotes: vi.fn(), criar: vi.fn(), atualizar: vi.fn(), usuario: vi.fn(), trava: vi.fn(), transacao: vi.fn() }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirPermissao: m.perm }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.audit }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transacao } }));
import { prepararLotePix, previaLotePix } from "@/lib/rh/lote-pix";
import { planejarLotePix } from "@/lib/rh/lote-pix-regras";
import { ErroNegocio } from "@/lib/erros";
import type { Sessao } from "@/lib/auth/sessao";
import { protegerChavePix } from "@/lib/rh/pix-protegido";
const sessao = { usuarioId: "dono-teste", papel: "DONO", nome: "Dono", barbeiroId: null, clienteId: null } as Sessao;
const folha = { id: "f1", pessoaId: "p1", criadoEm: new Date("2026-11-01"), status: "FECHADA", salarioCentavos: 10000, comissaoCentavos: 0, adicionaisCentavos: 0, descontosCentavos: 0, liquidoCentavos: 10000, pessoa: { nome: "Pessoa sintética", chavePix: null as string | null, chavePixCifrada: null as string | null, chavePixMascarada: null as string | null, chavePixTipo: null as string | null, chavePixHash: null as string | null, revisaoPix: 0, ativo: true } };
const tx = { $queryRaw: m.trava, usuario: { findUnique: m.usuario }, folhaPagamento: { findMany: m.folhas }, folhaLotePix: { findUnique: m.lotes, create: m.criar, update: m.atualizar } };
let lote: { id: string; criadoEm: Date; conferidoEm: Date | null } | null;
const dados = () => ({ competencia: "2026-11", revisao: planejarLotePix("2026-11", [folha]).revisao, acao: "preparar" as const });
beforeEach(() => {
  vi.resetAllMocks(); lote = null;
  vi.stubEnv("RH_PIX_ENCRYPTION_KEY", Buffer.alloc(32, 71).toString("base64"));
  Object.assign(folha.pessoa, protegerChavePix(folha.pessoaId, "pessoa@example.com"));
  m.transacao.mockImplementation(async f => f(tx)); m.usuario.mockResolvedValue({ ativo: true, papel: "DONO" }); m.folhas.mockResolvedValue([folha]);
  m.lotes.mockImplementation(async () => lote);
  m.criar.mockImplementation(async () => lote = { id: "lote1", criadoEm: new Date(), conferidoEm: null });
  m.atualizar.mockImplementation(async ({ data }) => lote = { ...lote!, conferidoEm: data.conferidoEm });
});
afterEach(() => vi.unstubAllEnvs());
describe("lote Pix local: serviço", () => {
  it("prévia devolve apenas chave mascarada, sem hash individual ou chave inteira", async () => {
    const r = await previaLotePix(sessao, "2026-11");
    expect(r.itens[0].chaveMascarada).toBeTruthy(); expect(r.itens[0]).not.toHaveProperty("chaveHash");
    expect(JSON.stringify(r)).not.toContain("pessoa@example.com");
  });
  it("sem permissão não consulta folha nem cria preparação", async () => {
    m.perm.mockRejectedValue(new ErroNegocio("Sem acesso", 403));
    await expect(previaLotePix(sessao, "2026-11")).rejects.toMatchObject({ status: 403 });
    await expect(prepararLotePix(sessao, dados())).rejects.toMatchObject({ status: 403 }); expect(m.transacao).not.toHaveBeenCalled();
  });
  it("preparar duas vezes reaproveita o lote e não duplica auditoria", async () => {
    const a = await prepararLotePix(sessao, dados()), b = await prepararLotePix(sessao, dados());
    expect(a.lote?.id).toBe(b.lote?.id); expect(m.criar).toHaveBeenCalledTimes(1); expect(m.audit).toHaveBeenCalledTimes(1);
    expect(a.envioHabilitado).toBe(false); expect(tx).not.toHaveProperty("despesa"); expect(tx.folhaPagamento).not.toHaveProperty("update");
  });
  it("revisão desatualizada não salva nem confere", async () => {
    await expect(prepararLotePix(sessao, { ...dados(), revisao: "0".repeat(64) })).rejects.toMatchObject({ status: 409, codigo: "lote_mudou" });
    expect(m.criar).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("conferência exige dono ativo e preparação existente", async () => {
    await expect(prepararLotePix(sessao, { ...dados(), acao: "conferir" })).rejects.toMatchObject({ codigo: "lote_nao_preparado" });
    m.usuario.mockResolvedValue({ ativo: true, papel: "GERENTE" });
    await expect(prepararLotePix(sessao, { ...dados(), acao: "conferir" })).rejects.toMatchObject({ status: 403 });
    m.usuario.mockResolvedValue({ ativo: false, papel: "DONO" });
    await expect(prepararLotePix(sessao, dados())).rejects.toMatchObject({ status: 403 });
  });
  it("conferir é idempotente e deixa explícita a ausência de autorização de envio", async () => {
    await prepararLotePix(sessao, dados());
    const a = await prepararLotePix(sessao, { ...dados(), acao: "conferir" });
    await prepararLotePix(sessao, { ...dados(), acao: "conferir" });
    expect(m.atualizar).toHaveBeenCalledTimes(1); expect(a.envioHabilitado).toBe(false); expect(a.lote?.conferidoEm).toBeTruthy();
    expect(m.audit.mock.calls.at(-1)?.[5]).toMatchObject({ autorizaEnvio: false });
  });
  it("folha já paga deixa o lote vazio e impede nova preparação", async () => {
    m.folhas.mockResolvedValue([{ ...folha, status: "PAGA" }]);
    const revisao = (await previaLotePix(sessao, "2026-11")).revisao;
    await expect(prepararLotePix(sessao, { ...dados(), revisao })).rejects.toMatchObject({ codigo: "lote_vazio" }); expect(m.criar).not.toHaveBeenCalled();
  });
});
