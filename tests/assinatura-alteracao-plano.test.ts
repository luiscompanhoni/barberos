import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ assinatura: vi.fn(), plano: vi.fn(), pedido: vi.fn(), criar: vi.fn(), atualizar: vi.fn(), aplicar: vi.fn(), vagas: vi.fn(), agenda: vi.fn(), cobranca: vi.fn(), emissao: vi.fn(), tx: vi.fn(), audit: vi.fn(), gateway: vi.fn(), lista: vi.fn(), prova: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.tx, assinatura: { findUniqueOrThrow: m.assinatura }, alteracaoPlanoAssinatura: { findFirst: m.pedido } } }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.audit }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gatewayPorId: m.gateway }));
import { aplicarAlteracaoPlano, cancelarAlteracaoPlano, classificacaoTroca, condicoesIguais, solicitarAlteracaoPlano } from "@/lib/assinaturas/alteracao-plano";

const condicoes = { nome: "Completo", precoCentavos: 15000, diasSemana: [], intervaloMinDias: null, descontoExtrasPct: 10, formasPagamento: ["PIX", "CARTAO"], maxAgendamentosAbertos: 2, servicos: [], barbeiros: [] };
const a = () => ({ id: "a", clienteId: "cliente-a", planoId: "antigo", precoCentavos: 10000, formaPagamento: "PIX", status: "ATIVA", gatewayId: "pixrec_a", proximoVencimento: new Date("2030-02-01"), cicloInicio: new Date("2030-01-01"), pausadaEm: null, encerraEm: null, operacaoInicial: null });
const pedido = () => ({ id: "p", assinaturaId: "a", planoAnteriorId: "antigo", planoDestinoId: "novo", precoAnteriorCentavos: 10000, precoNovoCentavos: 15000, efetivaEm: new Date("2030-02-01"), estado: "SOLICITADA", condicoes });
const plano = () => ({ ...condicoes, id: "novo", ativo: true, compravel: true, visivel: true, vagas: null });
const solicitar = () => solicitarAlteracaoPlano({ assinaturaId: "a", planoId: "novo", origem: "SITE", usuarioId: "u" });
beforeEach(() => {
  vi.clearAllMocks(); vi.spyOn(Date, "now").mockReturnValue(+new Date("2030-01-20T12:00:00Z"));
  m.assinatura.mockResolvedValue(a()); m.plano.mockResolvedValue(plano()); m.pedido.mockResolvedValue(null); m.criar.mockImplementation(async ({ data }) => ({ id: "p", ...data }));
  m.agenda.mockResolvedValue(null); m.cobranca.mockResolvedValue(null); m.emissao.mockResolvedValue(null); m.vagas.mockResolvedValue(0);
  m.tx.mockImplementation(async cb => cb({ $executeRaw: vi.fn(), $queryRaw: vi.fn(), assinatura: { findUnique: m.assinatura, findUniqueOrThrow: m.assinatura, update: m.aplicar, count: m.vagas }, plano: { findUnique: m.plano }, alteracaoPlanoAssinatura: { findFirst: m.pedido, findUniqueOrThrow: m.pedido, create: m.criar, update: m.atualizar }, agendamento: { findFirst: m.agenda }, cobranca: { findFirst: m.cobranca }, emissaoPixMensal: { findFirst: m.emissao } }));
  m.gateway.mockResolvedValue({ cobrancasDaAssinatura: m.lista, buscarCobrancaAvulsa: m.prova });
});

describe("pedido de upgrade e downgrade", () => {
  it("mantém preço e benefícios atuais; registra valor e data da próxima renovação", async () => {
    await solicitar();
    expect(m.aplicar).not.toHaveBeenCalled(); expect(m.gateway).not.toHaveBeenCalled();
    expect(m.criar).toHaveBeenCalledWith({ data: expect.objectContaining({ precoAnteriorCentavos: 10000, precoNovoCentavos: 15000, efetivaEm: new Date("2030-02-01"), condicoes, usuarioId: "u", origem: "SITE" }) });
    expect(m.audit).toHaveBeenCalledTimes(1);
  });
  it("repetir a mesma escolha não cria dois pedidos", async () => {
    m.pedido.mockResolvedValue(pedido());
    expect((await solicitar()).id).toBe("p"); expect(m.criar).not.toHaveBeenCalled();
  });
  it("bloqueia escolhas concorrentes de outro plano", async () => {
    m.pedido.mockResolvedValue({ ...pedido(), planoDestinoId: "outro" });
    await expect(solicitar()).rejects.toMatchObject({ codigo: "troca_existente" });
  });
  it.each([{ status: "ATRASADA" }, { pausadaEm: new Date() }, { operacaoInicial: "INCERTA" }, { proximoVencimento: null }])("recusa assinatura sem condições para troca: %j", async mudanca => {
    m.assinatura.mockResolvedValue({ ...a(), ...mudanca });
    await expect(solicitar()).rejects.toMatchObject({ codigo: "troca_indisponivel" });
    expect(m.criar).not.toHaveBeenCalled();
  });
  it.each([{ visivel: false }, { compravel: false }, { ativo: false }, { vendaSomenteEquipe: true }])("cliente não escolhe plano indisponível: %j", async mudanca => {
    m.plano.mockResolvedValue({ ...plano(), ...mudanca });
    await expect(solicitar()).rejects.toMatchObject({ status: 404 });
  });
  it("cancela só pedido ainda não enviado para conferência", async () => {
    m.pedido.mockResolvedValue({ ...pedido(), estado: "EM_CONFERENCIA" });
    await expect(cancelarAlteracaoPlano("a", "u")).rejects.toMatchObject({ status: 409 });
    expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("permite à recepção solicitar Business visível com venda restrita", async () => {
    m.plano.mockResolvedValue({ ...plano(), vendaSomenteEquipe: true });
    await solicitarAlteracaoPlano({ assinaturaId: "a", planoId: "novo", origem: "RECEPCAO", usuarioId: "u" });
    expect(m.criar).toHaveBeenCalledWith({ data: expect.objectContaining({ origem: "RECEPCAO", planoDestinoId: "novo" }) });
  });
});

describe("aplicação da troca pela recepção", () => {
  beforeEach(() => { m.pedido.mockResolvedValue(pedido()); });
  it("rejeita pedido autônomo quando o plano passa a ser exclusivo da equipe", async () => {
    vi.mocked(Date.now).mockReturnValue(+new Date("2030-02-01T12:00:00Z"));
    m.pedido.mockResolvedValue({ ...pedido(), origem: "SITE" });
    m.plano.mockResolvedValue({ ...plano(), vendaSomenteEquipe: true });
    await expect(aplicarAlteracaoPlano("a", "u")).rejects.toMatchObject({ status: 409 });
    expect(m.aplicar).not.toHaveBeenCalled();
  });
  it("não antecipa alteração dentro do ciclo pago", async () => {
    await expect(aplicarAlteracaoPlano("a", "u")).rejects.toMatchObject({ status: 409 });
    expect(m.aplicar).not.toHaveBeenCalled(); expect(m.gateway).not.toHaveBeenCalled();
  });
  it("aplica Pix local sem emitir cobrança ou alterar a duração do ciclo", async () => {
    vi.mocked(Date.now).mockReturnValue(+new Date("2030-02-01T12:00:00Z"));
    expect(await aplicarAlteracaoPlano("a", "u")).toEqual({ aplicada: true });
    expect(m.aplicar).toHaveBeenCalledWith({ where: { id: "a" }, data: { planoId: "novo", precoCentavos: 15000, descontoRetencaoPct: null, descontoRetencaoAte: null } });
    expect(m.gateway).not.toHaveBeenCalled();
    expect(m.agenda).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ inicio: { gte: new Date("2030-02-01T03:00:00Z") } }) }));
  });
  it.each(["cobrança", "emissão", "agenda", "ciclo", "condições", "vagas"])("bloqueia aplicação se mudou %s", async caso => {
    vi.mocked(Date.now).mockReturnValue(+new Date("2030-02-01T12:00:00Z"));
    if (caso === "cobrança") m.cobranca.mockResolvedValue({ id: "c" });
    if (caso === "emissão") m.emissao.mockResolvedValue({ id: "e" });
    if (caso === "agenda") m.agenda.mockResolvedValue({ id: "g" });
    if (caso === "ciclo") m.assinatura.mockResolvedValue({ ...a(), proximoVencimento: new Date("2030-03-01") });
    if (caso === "condições") m.plano.mockResolvedValue({ ...plano(), maxAgendamentosAbertos: 1 });
    if (caso === "vagas") { m.plano.mockResolvedValue({ ...plano(), vagas: 1 }); m.vagas.mockResolvedValue(1); }
    await expect(aplicarAlteracaoPlano("a", "u")).rejects.toMatchObject({ status: 409 }); expect(m.aplicar).not.toHaveBeenCalled();
  });
  it("exige evidência BRL integral da renovação externa e vínculo com o contrato", async () => {
    vi.mocked(Date.now).mockReturnValue(+new Date("2030-02-01T12:00:00Z"));
    m.assinatura.mockResolvedValue({ ...a(), gatewayId: "sub_a", cicloInicio: new Date("2030-02-01"), proximoVencimento: new Date("2030-03-01") });
    m.lista.mockResolvedValue([{ id: "ch_1", assinaturaGatewayId: "sub_a", vencimentoConfirmado: true, vencimento: "2030-02-01", valorCentavos: 15000, status: "PAGA" }]);
    m.prova.mockResolvedValue({ id: "ch_1", status: "PAGA", valorCentavos: 15000, moeda: "BRL", liquidadoCentavos: 14999 });
    await expect(aplicarAlteracaoPlano("a", "u")).rejects.toMatchObject({ codigo: "troca_em_conferencia" }); expect(m.aplicar).not.toHaveBeenCalled();
    m.prova.mockResolvedValue({ id: "ch_1", status: "PAGA", valorCentavos: 15000, moeda: "BRL", liquidadoCentavos: 15000 });
    await expect(aplicarAlteracaoPlano("a", "u")).resolves.toEqual({ aplicada: true });
  });
  it("não usa vencimento inferido ou cobrança de outro contrato como prova da renovação", async () => {
    vi.mocked(Date.now).mockReturnValue(+new Date("2030-02-01T12:00:00Z"));
    m.assinatura.mockResolvedValue({ ...a(), gatewayId: "sub_a", cicloInicio: new Date("2030-02-01") });
    for (const mudanca of [{ vencimentoConfirmado: false }, { assinaturaGatewayId: "sub_outro" }]) {
      m.lista.mockResolvedValue([{ id: "ch_1", assinaturaGatewayId: "sub_a", vencimentoConfirmado: true, vencimento: "2030-02-01", valorCentavos: 15000, status: "PAGA", ...mudanca }]);
      await expect(aplicarAlteracaoPlano("a", "u")).rejects.toMatchObject({ codigo: "troca_em_conferencia" });
    }
    expect(m.prova).not.toHaveBeenCalled(); expect(m.aplicar).not.toHaveBeenCalled();
  });
  it("distingue upgrade, downgrade e condições JSON independentemente da ordem das chaves", () => {
    expect(classificacaoTroca(100, 200)).toBe("UPGRADE"); expect(classificacaoTroca(200, 100)).toBe("DOWNGRADE"); expect(classificacaoTroca(100, 100)).toBe("TROCA");
    expect(condicoesIguais({ a: { x: 1, y: 2 }, b: [3] }, { b: [3], a: { y: 2, x: 1 } })).toBe(true);
    expect(condicoesIguais({ a: 1 }, { a: "1" })).toBe(false);
  });
});
