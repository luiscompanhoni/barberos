import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";

type Pessoa = { id: string; nome: string; funcao: "BARBEIRO" | "GERENTE"; ativo: boolean; cargo: string | null; salarioCentavos: number; barbeiroId: string | null; barbeiro: { nome: string } | null; revisaoPix: number };
type Folha = { id: string; pessoaId: string; barbeiroIdCongelado: string | null; salarioCentavos: number; comissaoCentavos: number; adicionaisCentavos: number; descontosCentavos: number; liquidoCentavos: number; status: "FECHADA" | "PAGA"; detalhe: unknown; pagoEm: Date | null; despesaId: string | null };
const m = vi.hoisted(() => ({ pessoas: [] as Pessoa[], folhas: [] as Folha[], relatorio: vi.fn(), criar: vi.fn(), auditar: vi.fn(), sessao: vi.fn() }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/financeiro/caixa", () => ({ movimentarCaixaNaTransacao: vi.fn() }));
vi.mock("@/lib/rh/comissoes", () => ({ relatorioComissoes: m.relatorio }));
vi.mock("@/lib/rh/vigencias", () => ({ lerVigenciaRemuneracao: async () => null }));
vi.mock("@/lib/rh/trava-regras-folha", () => ({ tocarPessoasDaFolha: vi.fn() }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirSessaoCom: m.sessao }));
vi.mock("@/lib/db", () => {
  const tx = { $queryRaw: vi.fn(), checklistPessoa: { findMany: async () => m.pessoas }, folhaLancamento: { findMany: async () => [] }, folhaPagamento: { findMany: async () => m.folhas, findFirst: async () => null, create: m.criar } };
  return { db: { ...tx, $transaction: async (f: (leitor: unknown) => unknown) => f(tx) } };
});
import { exportarCsv, fecharFolha, previaFolha } from "@/lib/rh/folha";
import { GET, POST } from "@/app/api/rh/folha/route";
import { GET as CSV } from "@/app/api/rh/folha/csv/route";
import { ErroNegocio } from "@/lib/erros";

const comp = "2026-11", base = "https://painel.example";
const dono = { usuarioId: "dono-ficticio", papel: "DONO", nome: "Dono fictício", barbeiroId: null, clienteId: null } as Sessao;
const pessoa = (extra: Partial<Pessoa> = {}): Pessoa => ({ id: "pessoa-ficticia", nome: "Pessoa fictícia", funcao: "BARBEIRO", ativo: true, cargo: "Barbeiro", salarioCentavos: 0, barbeiroId: null, barbeiro: null, revisaoPix: 0, ...extra });
const soma = (qtd = 0, comissao = 0) => ({ qtd, base: qtd * 10000, comissao, adicional: 0 });
const cadeira = (extra = {}) => ({ barbeiroId: "cadeira-ficticia", nome: "Cadeira fictícia", total: 2000, semRegra: 0, avulso: soma(1, 2000), plano: soma(), assinaturas: null, produtos: null,
  recalculoAtual: { total: 2000, avulso: soma(1, 2000), plano: soma(), assinaturas: null, produtos: null }, ...extra });
const relatorio = (barbeiros = [cadeira()]) => ({ barbeiros, recebimentos: { completo: true, pendentes: 0, nominalPendente: 0 }, revisao: "origem-sintetica" });
const memoria = (barbeiroId: string | null) => ({ versao: 2, nome: "Nome congelado", cargo: "Cargo congelado", barbeiro: "Cadeira congelada", barbeiroId,
  comissao: { avulso: soma(1, 500), plano: soma(), semRegra: 0, assinaturas: null, produtos: null }, lancamentos: [] });
const folha = (extra: Partial<Folha> = {}): Folha => ({ id: "folha-ficticia", pessoaId: "pessoa-ficticia", barbeiroIdCongelado: "cadeira-ficticia", salarioCentavos: 1000, comissaoCentavos: 500, adicionaisCentavos: 0, descontosCentavos: 0, liquidoCentavos: 1500, status: "FECHADA", detalhe: memoria("cadeira-ficticia"), pagoEm: null, despesaId: null, ...extra });
beforeEach(() => {
  vi.clearAllMocks(); m.pessoas = []; m.folhas = [];
  m.relatorio.mockResolvedValue(relatorio()); m.criar.mockResolvedValue({ id: "nova-folha" }); m.sessao.mockResolvedValue(dono);
  vi.stubEnv("PAINEL_URL", base);
});

describe("cobertura das comissões antes de fechar a folha", () => {
  it("expõe produção sem vínculo, mesmo com comissão zero, e recusa lote/CSV sem gravar", async () => {
    m.pessoas = [pessoa()];
    m.relatorio.mockResolvedValue(relatorio([cadeira({ total: 0, recalculoAtual: { total: 0, avulso: soma(1), plano: soma(), assinaturas: null, produtos: null } })]));
    const previa = await previaFolha(comp);
    expect(previa.pendenciasVinculos).toEqual([{ barbeiroId: "cadeira-ficticia", nome: "Cadeira fictícia", comissaoCentavos: 0, motivo: "SEM_VINCULO" }]);
    expect(previa.linhas[0]).toMatchObject({ comissao: 0, vinculoPendente: true });
    await expect(fecharFolha(dono, comp, undefined, previa.revisao)).rejects.toMatchObject({ codigo: "vinculo_comissao_pendente" });
    await expect(exportarCsv(comp)).rejects.toMatchObject({ codigo: "vinculo_comissao_pendente" });
    expect(m.criar).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
  });
  it("não congela somente o fixo de um barbeiro sem vínculo, mesmo sem outra cadeira com atividade", async () => {
    m.pessoas = [pessoa({ salarioCentavos: 10000 })]; m.relatorio.mockResolvedValue(relatorio([]));
    const previa = await previaFolha(comp);
    expect(previa.pendenciasVinculos).toEqual([]); expect(previa.linhas[0].vinculoPendente).toBe(true);
    await expect(fecharFolha(dono, comp, m.pessoas[0].id, previa.revisao)).rejects.toMatchObject({ codigo: "vinculo_comissao_pendente" });
    await expect(fecharFolha(dono, comp, undefined, previa.revisao)).rejects.toMatchObject({ codigo: "vinculo_comissao_pendente" });
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("permite fechar só a recepção apesar da comissão pendente de outra cadeira", async () => {
    m.pessoas = [pessoa({ id: "recepcao-ficticia", funcao: "GERENTE", cargo: "Recepção", salarioCentavos: 10000 })];
    const previa = await previaFolha(comp);
    expect(previa.linhas[0].vinculoPendente).toBe(false);
    expect(await fecharFolha(dono, comp, "recepcao-ficticia", previa.revisao)).toBe(1);
    expect(m.criar.mock.calls[0][0].data).toMatchObject({ pessoaId: "recepcao-ficticia", salarioCentavos: 10000, comissaoCentavos: 0 });
    expect(m.auditar).toHaveBeenCalledTimes(1);
  });
  it("ficha inativa com produção não desaparece silenciosamente e cadeira vazia não exige ficha", async () => {
    m.pessoas = [pessoa({ ativo: false, barbeiroId: "cadeira-ficticia" })];
    const previa = await previaFolha(comp);
    expect(previa.linhas).toEqual([]); expect(previa.pendenciasVinculos[0].motivo).toBe("INATIVO");
    await expect(fecharFolha(dono, comp, undefined, previa.revisao)).rejects.toMatchObject({ codigo: "vinculo_comissao_pendente" });
    m.relatorio.mockResolvedValue(relatorio([cadeira({ total: 0, recalculoAtual: { total: 0, avulso: soma(), plano: soma(), assinaturas: null, produtos: null } })]));
    expect((await previaFolha(comp)).pendenciasVinculos).toEqual([]);
  });
  it.each(["FECHADA", "PAGA"] as const)("preserva retrato %s após desvincular a ficha sem converter recálculo em histórico", async status => {
    m.pessoas = [pessoa({ ativo: false, barbeiroId: "outra-cadeira" })]; m.folhas = [folha({ status })];
    const previa = await previaFolha(comp);
    expect(previa.pendenciasVinculos).toEqual([]);
    expect(previa.linhas[0]).toMatchObject({ nome: "Nome congelado", barbeiroId: "cadeira-ficticia", salario: 1000, comissao: 500, liquido: 1500, status, vinculoPendente: false });
    expect(previa.linhas[0].comissaoDetalhe?.avulso.comissao).toBe(500);
    expect(m.criar).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
  });
  it("aceita identidade histórica comprovada somente pela memória validada", async () => {
    m.pessoas = [pessoa()]; m.folhas = [folha({ barbeiroIdCongelado: null })];
    const previa = await previaFolha(comp);
    expect(previa.pendenciasVinculos).toEqual([]); expect(previa.linhas[0].barbeiroId).toBe("cadeira-ficticia");
  });
  it("expõe ambiguidade quando outra ficha aberta reivindica a cadeira já congelada", async () => {
    m.pessoas = [pessoa(), pessoa({ id: "outra-ficha", barbeiroId: "cadeira-ficticia" })]; m.folhas = [folha()];
    const previa = await previaFolha(comp);
    expect(previa.pendenciasVinculos[0].motivo).toBe("AMBIGUO");
    expect(previa.linhas.find(l => l.pessoaId === "pessoa-ficticia")).toMatchObject({ vinculoPendente: false, comissao: 500 });
    expect(previa.linhas.find(l => l.pessoaId === "outra-ficha")?.vinculoPendente).toBe(true);
    await expect(fecharFolha(dono, comp, "outra-ficha", previa.revisao)).rejects.toMatchObject({ codigo: "cadeira_folha_duplicada" });
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("história com comissão sem identidade comprovada expõe ambiguidade e não atribui ID atual ao retrato", async () => {
    m.pessoas = [pessoa({ barbeiroId: "cadeira-ficticia" })]; m.folhas = [folha({ barbeiroIdCongelado: null, detalhe: null })];
    const previa = await previaFolha(comp);
    expect(previa.pendenciasVinculos[0]).toMatchObject({ motivo: "AMBIGUO", comissaoCentavos: 2000 });
    expect(previa.linhas[0]).toMatchObject({ barbeiroId: null, comissao: 500, memoriaDisponivel: false });
  });
  it("incluir ou remover vínculo invalida a prévia antiga antes de gravar", async () => {
    m.pessoas = [pessoa()]; const antes = await previaFolha(comp);
    m.pessoas[0] = pessoa({ barbeiroId: "cadeira-ficticia", barbeiro: { nome: "Cadeira fictícia" } });
    const depois = await previaFolha(comp);
    expect(depois.revisao).not.toBe(antes.revisao); expect(depois.pendenciasVinculos).toEqual([]); expect(depois.linhas[0].comissao).toBe(2000);
    await expect(fecharFolha(dono, comp, undefined, antes.revisao)).rejects.toMatchObject({ codigo: "folha_mudou" });
    m.pessoas[0] = pessoa();
    await expect(fecharFolha(dono, comp, undefined, depois.revisao)).rejects.toMatchObject({ codigo: "folha_mudou" });
    expect(m.criar).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
  });
  it("revalida destinatários na transação mesmo sem revisão fornecida pela chamada interna", async () => {
    m.pessoas = [pessoa({ barbeiroId: "cadeira-ficticia" })]; await previaFolha(comp);
    m.pessoas[0].barbeiroId = null;
    await expect(fecharFolha(dono, comp)).rejects.toMatchObject({ codigo: "vinculo_comissao_pendente" });
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("conciliação de rateio entra na revisão e bloqueia lote/assinatura, preservando recepção individual", async () => {
    const assinaturas = { qtd: 1, creditos: 1, receitaAtribuida: 10000, comissao: 2000 };
    const com = cadeira({ assinaturas });
    m.pessoas = [pessoa({ barbeiroId: "cadeira-ficticia" }), pessoa({ id: "recepcao", funcao: "GERENTE", salarioCentavos: 10000 })];
    m.relatorio.mockResolvedValue({ ...relatorio([com]), assinaturas: { conciliacao: { pendente: false, status: "OK" } } });
    const antes = await previaFolha(comp);
    m.relatorio.mockResolvedValue({ ...relatorio([com]), assinaturas: { conciliacao: { pendente: true, status: "REVISAO" } } });
    const atual = await previaFolha(comp);
    expect(atual.revisao).not.toBe(antes.revisao);
    await expect(fecharFolha(dono, comp, undefined, atual.revisao)).rejects.toMatchObject({ codigo: "rateio_pendente" });
    await expect(fecharFolha(dono, comp, "pessoa-ficticia", atual.revisao)).rejects.toMatchObject({ codigo: "rateio_pendente" });
    await expect(exportarCsv(comp)).rejects.toMatchObject({ codigo: "rateio_pendente" });
    expect(await fecharFolha(dono, comp, "recepcao", atual.revisao)).toBe(1);
  });
  it("CSV de mês todo congelado preserva históricos mesmo com recálculo e rateio atuais divergentes", async () => {
    m.pessoas = [pessoa({ ativo: false })]; m.folhas = [folha({ status: "PAGA" })];
    m.relatorio.mockResolvedValue({ ...relatorio(), assinaturas: { conciliacao: { pendente: true, status: "REVISAO" } } });
    const csv = await exportarCsv(comp);
    expect(csv).toContain("Nome congelado"); expect(csv).toContain("15,00"); expect(csv).toContain("Paga");
    await expect(fecharFolha(dono, comp)).rejects.toMatchObject({ codigo: "nada_para_fechar" });
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("permissão negada impede leitura, fechamento e CSV antes do serviço", async () => {
    m.sessao.mockRejectedValue(new ErroNegocio("Sem permissão", 403));
    const req = new Request(`${base}/api/rh/folha`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ acao: "fechar", competencia: comp, revisao: "a".repeat(64) }) });
    expect((await GET(new Request(`${base}/api/rh/folha?competencia=${comp}`))).status).toBe(403);
    expect((await POST(req)).status).toBe(403);
    expect((await CSV(new Request(`${base}/api/rh/folha/csv?competencia=${comp}`))).status).toBe(403);
    expect(m.relatorio).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
  });
});
