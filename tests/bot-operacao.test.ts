import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmouHorario, duasVagas } from "@/lib/bot/escolha-horario";

const m = vi.hoisted(() => ({
  usuario: vi.fn(), produto: vi.fn(), comanda: vi.fn(), criar: vi.fn(), pode: vi.fn(),
  negocio: vi.fn(), barbeiro: vi.fn(), comissoes: vi.fn(), repor: vi.fn(), checklist: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  usuario: { findUnique: m.usuario }, produto: { findMany: m.produto }, comanda: { findMany: m.comanda },
} }));
vi.mock("@/lib/agenda/carregar", () => ({
  configuracao: async () => ({ fuso: "America/Sao_Paulo" }),
  limitesDoDia: () => ({ fim: Date.now() }),
}));
vi.mock("@/lib/auth/permissoes", () => ({ pode: m.pode }));
vi.mock("@/lib/financeiro/pessoal", () => ({ criarLancamentoPessoal: m.criar }));
vi.mock("@/lib/indicadores/negocio", () => ({ indicadoresDoNegocio: m.negocio }));
vi.mock("@/lib/indicadores/barbeiro", () => ({ indicadoresDoBarbeiro: m.barbeiro }));
vi.mock("@/lib/rh/comissoes", () => ({ relatorioComissoes: m.comissoes }));
vi.mock("@/lib/comandas/relatorio", () => ({ produtosAcabando: m.repor }));
vi.mock("@/lib/checklist/servico", () => ({ minhasTarefasDoDia: m.checklist }));

import { executarOperacao, valorDaDespesaWhatsApp } from "@/lib/bot/ferramentas-operacao";

const ctx = { conversaId: "conversa", telefone: "5547999999999", nomePerfil: "Nome que o remetente escolhe", entradaId: "e1" };
const pessoa = { id: "usuario1", papel: "BARBEIRO", ativo: true, telefoneVerificadoEm: new Date(), barbeiro: { id: "barbeiro1", ativo: true } };

beforeEach(() => {
  vi.resetAllMocks();
  m.usuario.mockResolvedValue(pessoa);
});

describe("escolha de horário", () => {
  const proposta = "Com o Tainan na quarta, tenho 10:30 ou 14:00. Qual fica melhor pra ti?";
  it("reserva uma vaga quando o cliente diz 'pô, pode marcar' e pede seleção se havia duas", () => {
    expect(confirmouHorario("Pô, pode marcar", "Tenho com o Fauli na quinta às 18h. Pode ser pra ti?", "18:00")).toBe(true);
    expect(confirmouHorario("Pô, pode marcar", proposta, "14:00")).toBe(false);
  });
  it("prioriza a hora pedida no período, sem repetir o mesmo horário para outro barbeiro", () => {
    const vagas = [660, 750, 840, 840, 855, 1080].map(minuto => ({ minuto }));
    expect(duasVagas(vagas, "TARDE", 840)).toEqual([{ minuto: 840 }, { minuto: 855 }]);
    expect(duasVagas(vagas, "NOITE")).toEqual([{ minuto: 1080 }]);
  });
  it.each(["a segunda", "a de 14:00", "pode marcar às 14h?", "vou de 14h"])("aceita escolha explícita %s", texto => {
    expect(confirmouHorario(texto, proposta, "14:00")).toBe(true);
    expect(confirmouHorario(texto, proposta, "10:30")).toBe(false);
  });
  it.each(["sim", "kkk", "vou ver", "não marca às 14h", "tem às 14h?"])("pede esclarecimento para %s", texto => {
    expect(confirmouHorario(texto, proposta, "14:00")).toBe(false);
  });
});

describe("consultas e lançamentos operacionais", () => {
  it("só consulta comanda a pedido e prende a consulta ao telefone do remetente", async () => {
    expect((await executarOperacao("minhas_comandas_abertas", {}, { ...ctx, textoEntrada: "Oi" })).erro).toBe(true);
    expect(m.comanda).not.toHaveBeenCalled();
    m.comanda.mockResolvedValue([]);
    await executarOperacao("minhas_comandas_abertas", {}, { ...ctx, textoEntrada: "Quanto ficou minha comanda?" });
    expect(m.comanda).toHaveBeenCalledWith(expect.objectContaining({
      where: { cliente: { telefone: ctx.telefone, excluidoEm: null }, status: "ABERTA" },
    }));
  });

  it("responde estoque de venda sem expor custo ou níveis internos", async () => {
    m.produto.mockResolvedValue([{ nome: "Guaraná", estoque: 5, precoCentavos: 700, custoCentavos: 280 }]);
    const r = await executarOperacao("consultar_produto", { nome: "Guaraná" }, ctx);
    expect(JSON.parse(r.texto)).toEqual([{ nome: "Guaraná", disponivel: true, precoCentavos: 700 }]);
  });

  it.each([{ papel: "CLIENTE" }, { papel: "BARBEIRO" }, { papel: "GERENTE", telefoneVerificadoEm: null }, { papel: "DONO", ativo: false }])
    ("nega indicadores fora do acesso permitido (%j)", async alteracao => {
      m.usuario.mockResolvedValue({ ...pessoa, ...alteracao });
      expect((await executarOperacao("indicadores_da_barbearia", {}, ctx)).erro).toBe(true);
      expect(m.negocio).not.toHaveBeenCalled();
    });

  it("consulta só o barbeiro associado ao número e mantém a distinção de prévia", async () => {
    m.barbeiro.mockResolvedValue({ receitaServicosCentavos: 8000, vendasProdutosCentavos: 700 });
    m.comissoes.mockResolvedValue({ competencia: "2026-11", barbeiros: [
      { barbeiroId: "outro", total: 1000000 }, { barbeiroId: "barbeiro1", total: 3000, fonte: "APURACAO_ATUAL" },
    ], recebimentos: { pendentes: 1 } });
    const r = await executarOperacao("minha_receita_e_comissao", { barbeiro_id: "outro" }, ctx);
    expect(m.comissoes).toHaveBeenCalledWith(expect.any(String), expect.any(String), "barbeiro1");
    expect(JSON.parse(r.texto)).toMatchObject({ comissaoCentavos: 3000, apuracao: expect.stringContaining("Prévia") });
  });

  it("rejeita valor diferente ou hipotético e lança o valor escrito no financeiro do próprio remetente", async () => {
    const entrada = { valor_centavos: 4000, descricao: "Farmácia", categoria: "Saúde" };
    expect(valorDaDespesaWhatsApp("Gastei R$ 40,50 com farmácia")).toBe(4050);
    expect(valorDaDespesaWhatsApp("E se eu gastei 40 reais?")).toBeNull();
    expect((await executarOperacao("registrar_minha_despesa", { ...entrada, valor_centavos: 4500 }, { ...ctx, textoEntrada: "Gastei 40 reais com farmácia" })).erro).toBe(true);
    expect(m.criar).not.toHaveBeenCalled();
    m.criar.mockResolvedValue({ descricao: "Farmácia", valorCentavos: 4000 });
    await executarOperacao("registrar_minha_despesa", entrada, { ...ctx, textoEntrada: "Gastei 40 reais com farmácia" });
    expect(m.criar).toHaveBeenCalledWith("usuario1", expect.objectContaining({ valorCentavos: 4000, tipo: "DESPESA" }), { id: "e1", telefone: ctx.telefone });
  });

  it.each([
    ["Gastei 1.200 reais com a farmácia", 120000],
    ["Gastei R$ 1.200,35 com a farmácia", 120035],
    ["Gastei 1.20 reais com a farmácia", null],
    ["Gastei 40,123 reais com a farmácia", null],
    ["Gastei -40 reais com a farmácia", null],
    ["Gastei R$ 40 reais com a farmácia", 4000],
    ["Gastei 40 reais e 25 reais", null],
  ])("interpreta a quantia completa em %s", (texto, centavos) => {
    expect(valorDaDespesaWhatsApp(texto)).toBe(centavos);
  });
});
