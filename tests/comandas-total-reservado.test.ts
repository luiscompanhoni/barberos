import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";
import type { PagamentoRegra } from "@/lib/comandas/regras";

type Item = { id: string; quantidade: number; precoUnitCentavos: number; agendamentoId: string | null; produtoId: null; descricao: string };
type Link = { status: string; valorCentavos: number; expiraEm: Date; gatewayId: string | null; tentativaChave: string | null };
type Comanda = { id: string; numero: number; status: string; descontoCentavos: number; clienteId: string | null; itens: Item[]; pagamentos: PagamentoRegra[]; linksPagamento: Link[] };
const m = vi.hoisted(() => ({ c: null as Comanda | null, antesTrava: vi.fn(), atualizar: vi.fn(), itemAtualizar: vi.fn(), itemExcluir: vi.fn(), auditar: vi.fn(), adicional: vi.fn(), publicar: vi.fn(), cancelarLinks: vi.fn(), beneficioCriar: vi.fn(), beneficioAtualizar: vi.fn(), premioAtualizar: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = {
    $queryRaw: async () => { m.antesTrava(); return []; },
    comanda: { findUnique: async () => m.c, update: async ({ data }: { data: Partial<Comanda> }) => { m.atualizar(data); return Object.assign(m.c!, data); } },
    itemComanda: {
      update: async ({ where, data }: { where: { id: string }; data: { quantidade: number } }) => { m.itemAtualizar(); return Object.assign(m.c!.itens.find(i => i.id === where.id)!, data); },
      delete: async ({ where }: { where: { id: string } }) => { m.itemExcluir(); m.c!.itens = m.c!.itens.filter(i => i.id !== where.id); },
    },
    beneficio: { findMany: async () => [{ id: "credito1", valorCentavos: 5000, expiraEm: null, criadoEm: new Date(0), status: "DISPONIVEL" }], create: m.beneficioCriar, update: m.beneficioAtualizar },
    premioGanho: { findUnique: async () => ({ id: "premio1", clienteId: "cliente1", tipo: "DESCONTO", status: "DISPONIVEL", valorCentavos: 5000, percentual: 50, expiraEm: null, servicoId: null }), update: m.premioAtualizar },
  };
  return { db: { ...tx, itemComanda: { ...tx.itemComanda, findUnique: async () => ({ comandaId: "cmd1" }) }, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirPermissao: vi.fn(), permissoesDoUsuario: async () => ({ excluir: true }) }));
vi.mock("@/lib/eventos", () => ({ publicar: m.publicar }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ cashbackAtivo: false }) }));
vi.mock("@/lib/comandas/estoque", () => ({ movimentar: vi.fn() }));
vi.mock("@/lib/comandas/adicional", () => ({ cancelarAdicionalDoItem: m.adicional }));
vi.mock("@/lib/links/servico", () => ({ cancelarLinksDaComanda: m.cancelarLinks }));
vi.mock("@/lib/jogos/motor", () => ({ premioParaCliente: vi.fn() }));

import { alterarItem, cancelarComanda, definirDesconto, fecharComanda } from "@/lib/comandas/servico";
import { conferirNovoTotal, valoresProtegidos } from "@/lib/comandas/total-reservado";
import { usarSaldo } from "@/lib/crescimento/saldo";
import { validarPremio } from "@/lib/jogos/premios";
const s = { usuarioId: "dono-sintetico", papel: "DONO", nome: "Dono", barbeiroId: null, clienteId: null } as Sessao;
const pg = (forma: PagamentoRegra["forma"], valorCentavos: number, status: PagamentoRegra["status"] = "PAGO", estornadoCentavos = 0): PagamentoRegra => ({ forma, valorCentavos, status, estornadoCentavos });
const link = (extra: Partial<Link> = {}): Link => ({ status: "PENDENTE", valorCentavos: 4000, expiraEm: new Date(Date.now() + 60000), gatewayId: null, tentativaChave: null, ...extra });
beforeEach(() => {
  vi.clearAllMocks();
  m.c = { id: "cmd1", numero: 1, status: "ABERTA", descontoCentavos: 0, clienteId: null, itens: [{ id: "item1", quantidade: 2, precoUnitCentavos: 5000, descricao: "Item sintético", agendamentoId: null, produtoId: null }], pagamentos: [], linksPagamento: [] };
});

describe("comanda: piso financeiro sob a trava", () => {
  it.each(["CREDITO", "DEBITO", "PIX"] as const)("desconto não reduz abaixo do recebido em %s", async forma => {
    m.c!.pagamentos = [pg(forma, 7000)];
    await expect(definirDesconto(s, "cmd1", 4000)).rejects.toMatchObject({ codigo: "total_reservado" });
    expect(m.atualizar).not.toHaveBeenCalled(); expect(m.c!.descontoCentavos).toBe(0);
    await definirDesconto(s, "cmd1", 3000); expect(m.c!.descontoCentavos).toBe(3000);
  });
  it("valor recebido parcialmente estornado reduz o piso, dinheiro preserva troco", async () => {
    m.c!.pagamentos = [pg("CREDITO", 7000, "PAGO", 2000), pg("DINHEIRO", 10000)];
    await definirDesconto(s, "cmd1", 5000); expect(m.c!.descontoCentavos).toBe(5000);
  });
  it("reserva POS sem gateway e link remoto somam ao recebido", async () => {
    m.c!.pagamentos = [pg("PIX", 2000), pg("CREDITO", 3000, "AGUARDANDO")]; m.c!.linksPagamento = [link({ valorCentavos: 2000 })];
    expect(valoresProtegidos(m.c!).piso).toBe(7000);
    await expect(definirDesconto(s, "cmd1", 4000)).rejects.toMatchObject({ codigo: "total_reservado" });
    await definirDesconto(s, "cmd1", 3000); expect(m.c!.descontoCentavos).toBe(3000);
  });
  it.each([{ gatewayId: "or_remoto" }, { tentativaChave: "tentativa-sem-resposta" }])("link expirado incerto mantém a reserva %j", async extra => {
    m.c!.linksPagamento = [link({ expiraEm: new Date(0), valorCentavos: 9000, ...extra })];
    await expect(definirDesconto(s, "cmd1", 2000)).rejects.toMatchObject({ codigo: "total_reservado" });
  });
  it("link expirado sem intenção ou pedido não segura o total", async () => {
    m.c!.linksPagamento = [link({ expiraEm: new Date(0) })];
    await definirDesconto(s, "cmd1", 10000); expect(m.c!.descontoCentavos).toBe(10000);
  });
  it("remover ou reduzir item não reduz abaixo do reservado", async () => {
    m.c!.pagamentos = [pg("CREDITO", 10000, "AGUARDANDO")];
    await expect(alterarItem(s, "item1", 0)).rejects.toMatchObject({ codigo: "total_reservado" });
    await expect(alterarItem(s, "item1", 1)).rejects.toMatchObject({ codigo: "total_reservado" });
    expect(m.itemExcluir).not.toHaveBeenCalled(); expect(m.itemAtualizar).not.toHaveBeenCalled(); expect(m.adicional).not.toHaveBeenCalled();
  });
  it("alteração legítima acima do piso continua disponível", async () => {
    m.c!.pagamentos = [pg("PIX", 4000)];
    await alterarItem(s, "item1", 1); expect(m.c!.itens[0].quantidade).toBe(1);
    await alterarItem(s, "item1", 3); expect(m.c!.itens[0].quantidade).toBe(3);
  });
  it("item removido enquanto aguardava a trava não usa a leitura antiga", async () => {
    m.antesTrava.mockImplementationOnce(() => { m.c!.itens = []; });
    await expect(alterarItem(s, "item1", 1)).rejects.toMatchObject({ status: 404 }); expect(m.itemAtualizar).not.toHaveBeenCalled();
  });
  it("reserva inserida antes da aquisição da trava participa da validação", async () => {
    m.antesTrava.mockImplementationOnce(() => { m.c!.pagamentos = [pg("PIX", 9000, "AGUARDANDO")]; });
    await expect(definirDesconto(s, "cmd1", 2000)).rejects.toMatchObject({ codigo: "total_reservado" });
  });
  it("pagamento cancelado sem estorno e link encerrado não entram no piso", () => {
    m.c!.pagamentos = [pg("CREDITO", 10000, "CANCELADO")]; m.c!.linksPagamento = [link({ status: "CANCELADO" })];
    expect(() => conferirNovoTotal(m.c!, [], 0)).not.toThrow();
  });
});

describe("fechamento da comanda com ordens em voo", () => {
  it("cancelamento não esconde link em voo nem altera comanda ou benefícios", async () => {
    m.c!.linksPagamento = [link({ tentativaChave: "envio-incerto", expiraEm: new Date(0) })];
    await expect(cancelarComanda(s, "cmd1", "Cancelamento sintético")).rejects.toMatchObject({ codigo: "link_pendente" });
    expect(m.atualizar).not.toHaveBeenCalled(); expect(m.beneficioCriar).not.toHaveBeenCalled(); expect(m.beneficioAtualizar).not.toHaveBeenCalled(); expect(m.premioAtualizar).not.toHaveBeenCalled();
  });
  it.each([{ gatewayId: "or_remoto" }, { tentativaChave: "incerta" }])("não fecha com link em voo, mesmo expirado %j", async extra => {
    m.c!.pagamentos = [pg("DINHEIRO", 10000)]; m.c!.linksPagamento = [link({ expiraEm: new Date(0), ...extra })];
    await expect(fecharComanda(s, "cmd1")).rejects.toMatchObject({ codigo: "link_pendente" }); expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("pagamento remoto reservado enquanto aguardava a trava impede fechamento", async () => {
    m.c!.pagamentos = [pg("DINHEIRO", 10000)];
    m.antesTrava.mockImplementationOnce(() => { m.c!.linksPagamento = [link({ tentativaChave: "em-http" })]; });
    await expect(fecharComanda(s, "cmd1")).rejects.toMatchObject({ codigo: "link_pendente" });
  });
  it("não fecha com recebimento não dinheiro acima do total", async () => {
    m.c!.pagamentos = [pg("CREDITO", 15000)];
    await expect(fecharComanda(s, "cmd1")).rejects.toMatchObject({ codigo: "recebimento_excedente" }); expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("mantém troco em dinheiro e aceita link expirado sem tentativa", async () => {
    m.c!.pagamentos = [pg("PIX", 4000), pg("DINHEIRO", 10000)]; m.c!.linksPagamento = [link({ expiraEm: new Date(0) })];
    const r = await fecharComanda(s, "cmd1"); expect(r.troco).toBe(4000); expect(m.c!.status).toBe("FECHADA");
  });
});

describe("saldo e prêmio preservam o piso antes de consumir créditos", () => {
  it("saldo não reduz comanda coberta por POS pendente nem consome benefício", async () => {
    m.c!.clienteId = "cliente1"; m.c!.pagamentos = [pg("CREDITO", 10000, "AGUARDANDO")];
    await expect(usarSaldo(s, "cmd1")).rejects.toMatchObject({ codigo: "total_reservado" });
    expect(m.beneficioCriar).not.toHaveBeenCalled(); expect(m.beneficioAtualizar).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("prêmio não reduz comanda com link expirado incerto nem muda seu estado", async () => {
    m.c!.clienteId = "cliente1"; m.c!.linksPagamento = [link({ valorCentavos: 10000, expiraEm: new Date(0), tentativaChave: "em-voo" })];
    await expect(validarPremio(s, "premio1", { comandaId: "cmd1" })).rejects.toMatchObject({ codigo: "total_reservado" });
    expect(m.premioAtualizar).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("saldo acima do piso continua consumindo os mesmos créditos", async () => {
    m.c!.clienteId = "cliente1"; m.c!.pagamentos = [pg("PIX", 4000)];
    const r = await usarSaldo(s, "cmd1"); expect(r.usadoCentavos).toBe(5000); expect(m.beneficioAtualizar).toHaveBeenCalledTimes(1); expect(m.c!.descontoCentavos).toBe(5000);
  });
  it("prêmio acima do piso mantém o mesmo desconto e validação", async () => {
    m.c!.clienteId = "cliente1"; m.c!.pagamentos = [pg("PIX", 4000)];
    const r = await validarPremio(s, "premio1", { comandaId: "cmd1" }); expect(r.descontoCentavos).toBe(5000); expect(m.premioAtualizar).toHaveBeenCalledTimes(1); expect(m.c!.descontoCentavos).toBe(5000);
  });
});
