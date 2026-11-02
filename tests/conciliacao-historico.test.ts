import { describe, expect, it } from "vitest";
import { backupApto, cpfsParaBusca, identidadeComprovada, planejarHistorico, type ContextoHistorico } from "@/lib/conciliacao/historico/regras";
import { zEscolhaHistorico, type EscolhaHistorico } from "@/lib/conciliacao/historico/schemas";

const data = new Date("2026-10-23T13:00:00Z");
const escolha = (extra: Partial<EscolhaHistorico> = {}): EscolhaHistorico => ({ transacaoId: "91001", assinaturaId: "a", operacao: "IMPORTAR", motivo: "Comprovantes conferidos", identidadeConfirmada: false, ...extra });
function contexto(): ContextoHistorico {
  return {
    fonte: { id: "91001", contratoId: "101", valorCentavos: 11800, vencimento: "2026-10-23", status: "captured", cliente: { nome: "Cliente Fictício", cpf: "", telefones: ["11999990001"] } },
    assinatura: { id: "a", clienteId: "c", status: "CANCELADA", gatewayId: "celcash:hist:c", cliente: { id: "c", nome: "Cliente Fictício", cpf: null, telefone: "5511999990001" } },
    movimentos: [{ id: "m", fonte: "CELCASH", tipo: "RECEBIMENTO", transacaoId: "91001", valorCentavos: 11800, data }],
    cobrancas: [], canonicas: [], vinculos: [], pedidos: [], clientesMesmoCpf: [],
  };
}
function existente(c: ContextoHistorico) {
  const cob = { id: "cob", assinaturaId: "a", gatewayId: "cashbarber:pag:exemplo", valorCentavos: 11800, vencimento: new Date("2026-10-23"), status: "PAGA", pagaEm: data, atualizadaEm: data };
  c.cobrancas.push(cob); return cob;
}
const bloqueado = (c: ContextoHistorico, p = escolha()) => expect(planejarHistorico(p, c).bloqueios.length).toBeGreaterThan(0);

describe("conciliação histórica: prova e preservação", () => {
  it("aceita um crédito comprovado e mantém a assinatura cancelada", () => {
    const c = contexto(); const antes = structuredClone(c);
    const r = planejarHistorico(escolha(), c);
    expect(r.bloqueios).toEqual([]); expect(r.avisos).toContainEqual(expect.stringContaining("continuará cancelada")); expect(c).toEqual(antes);
  });
  it.each(["TAXA", "TRANSFERENCIA", "PAGAMENTO"])("não usa %s como receita", (tipo) => { const c = contexto(); c.movimentos[0].tipo = tipo; bloqueado(c); });
  it.each(["payExternal", "free", "pendingPix", "cancel", "novoStatus"])("não importa status %s sem prova de liquidação", (status) => { const c = contexto(); c.fonte.status = status; bloqueado(c); });
  it("recusa duas entradas para o mesmo ID e valores divergentes", () => {
    const c = contexto(); c.movimentos.push({ ...c.movimentos[0], id: "m2" }); bloqueado(c);
    c.movimentos.pop(); c.movimentos[0].valorCentavos--; bloqueado(c);
  });
  it("telefone sozinho não une nomes diferentes", () => { const c = contexto(); c.assinatura.cliente.nome = "Outra Pessoa"; bloqueado(c); expect(planejarHistorico(escolha({ identidadeConfirmada: true }), c).bloqueios).toEqual([]); });
  it("CPF divergente prevalece sobre nome/telefone iguais", () => {
    const c = contexto(); c.fonte.cliente.cpf = "11111111111"; c.assinatura.cliente.cpf = "22222222222";
    expect(identidadeComprovada(c.fonte, c.assinatura.cliente)).toBe(false);
    c.fonte.cliente.cpf = "52998224725"; c.assinatura.cliente.cpf = "529.982.247-25"; c.assinatura.cliente.nome = "Apelido";
    expect(identidadeComprovada(c.fonte, c.assinatura.cliente)).toBe(true);
  });
  it("CPF inválido repetido não comprova identidade de nomes diferentes", () => {
    const c = contexto(); c.fonte.cliente.cpf = "00000000000"; c.assinatura.cliente.cpf = "00000000000";
    c.assinatura.cliente.nome = "Outra Pessoa"; bloqueado(c);
  });
  it("recusa assinatura que representa outro contrato Celcash", () => { const c = contexto(); c.assinatura.gatewayId = "celsub_999"; bloqueado(c); });
  it("recusa cobrança avulsa ou contrato sem titular mesmo com confirmação manual", () => {
    const c = contexto(); c.fonte.contratoId = null; bloqueado(c, escolha({ identidadeConfirmada: true }));
    c.fonte.contratoId = "101"; c.fonte.cliente.nome = ""; bloqueado(c, escolha({ identidadeConfirmada: true }));
  });
  it("encontra CPF formatado e bloqueia cadastros duplicados mesmo com confirmação manual", () => {
    expect(cpfsParaBusca("52998224725")).toContain("529.982.247-25"); expect(cpfsParaBusca("00000000000")).toEqual([]);
    const c = contexto(); c.clientesMesmoCpf = [{ id: "c" }, { id: "outro" }]; bloqueado(c, escolha({ identidadeConfirmada: true }));
  });
  it("não repete código que já existe em qualquer cliente", () => { const c = contexto(); c.canonicas.push(existente(contexto())); bloqueado(c); });
  it("não usa proximidade de 45 dias para excluir outro ciclo", () => {
    const c = contexto(); const a = existente(c); a.vencimento = new Date("2026-09-23"); a.pagaEm = new Date("2026-09-23T13:00Z");
    expect(planejarHistorico(escolha(), c).bloqueios).toEqual([]);
  });
  it("bloqueia duplicata por vencimento ou data de crédito em outra assinatura do cliente", () => {
    const c = contexto(); const cob = existente(c); cob.assinaturaId = "outra"; bloqueado(c);
    cob.vencimento = new Date("2026-09-23"); bloqueado(c);
  });
  it("vínculo conserva gateway, valor, pagamento e vencimento originais", () => {
    const c = contexto(); const cob = existente(c); cob.gatewayId = "celcash:pag:91001"; cob.pagaEm = new Date("2026-10-22T13:00Z"); const antes = structuredClone(cob);
    const r = planejarHistorico(escolha({ operacao: "VINCULAR", cobrancaId: cob.id }), c);
    expect(r.bloqueios).toEqual([]); expect(r.avisos).toContainEqual(expect.stringContaining("data paga")); expect(cob).toEqual(antes);
  });
  it("Cash Barber exige as duas datas e um único candidato", () => {
    const c = contexto(); const cob = existente(c); const p = escolha({ operacao: "VINCULAR", cobrancaId: cob.id });
    cob.pagaEm = new Date("2026-10-22T13:00Z"); bloqueado(c, p);
    cob.pagaEm = data; cob.vencimento = new Date("2026-09-23"); bloqueado(c, p);
    cob.vencimento = new Date("2026-10-23"); c.cobrancas.push({ ...cob, id: "duplicada" }); bloqueado(c, p);
  });
  it("bloqueia cobrança sem correspondência de datas, de outra origem ou sem data paga", () => {
    const c = contexto(); const cob = existente(c); const p = escolha({ operacao: "VINCULAR", cobrancaId: cob.id });
    cob.vencimento = new Date("2026-09-23"); cob.pagaEm = new Date("2026-09-23T13:00Z"); bloqueado(c, p);
    cob.gatewayId = "pagarme:outra"; bloqueado(c, p); cob.gatewayId = "celcash:pag:91001"; cob.pagaEm = null as unknown as Date; bloqueado(c, p);
  });
  it("não move cobrança para outro cliente nem une duas transações na mesma cobrança", () => {
    const c = contexto(); bloqueado(c, escolha({ operacao: "VINCULAR", cobrancaId: "nao-pertence" }));
    const cob = existente(c); c.vinculos.push({ id: "v", transacaoId: "999", cobrancaId: cob.id, estornoMovimentoId: null, pedidoEstornoId: null });
    bloqueado(c, escolha({ operacao: "VINCULAR", cobrancaId: cob.id }));
  });
  it("estorno exige saída integral, mesmo ID e data coerente", () => {
    const c = contexto(); const cob = existente(c); c.fonte.status = "reversed";
    const p = escolha({ operacao: "ESTORNO", cobrancaId: cob.id }); bloqueado(c, p);
    c.movimentos.push({ ...c.movimentos[0], id: "est", tipo: "ESTORNO", valorCentavos: -11800 });
    expect(planejarHistorico(p, c).bloqueios).toEqual([]);
    c.movimentos[1].valorCentavos = -100; bloqueado(c, p);
    c.movimentos[1].valorCentavos = -11800; c.movimentos[1].data = new Date("2026-09-01"); bloqueado(c, p);
  });
  it("não ignora estorno da fonte e não duplica pedido de devolução", () => {
    const c = contexto(); const cob = existente(c); c.fonte.status = "reversed";
    c.movimentos.push({ ...c.movimentos[0], id: "est", tipo: "ESTORNO", valorCentavos: -11800 });
    bloqueado(c, escolha({ operacao: "VINCULAR", cobrancaId: cob.id }));
    c.pedidos.push({ id: "p", referenciaId: cob.id, status: "EXECUTADO", valorCentavos: 11800, executadoEm: data });
    bloqueado(c, escolha({ operacao: "ESTORNO", cobrancaId: cob.id }));
  });
  it("estorno falho ainda pode ser tentado novamente; não cria uma segunda devolução", () => {
    const c = contexto(); const cob = existente(c); c.fonte.status = "reversed";
    c.movimentos.push({ ...c.movimentos[0], id: "est", tipo: "ESTORNO", valorCentavos: -11800 });
    c.pedidos.push({ id: "p", referenciaId: cob.id, status: "FALHOU", valorCentavos: 11800, executadoEm: null });
    bloqueado(c, escolha({ operacao: "ESTORNO", cobrancaId: cob.id }));
    cob.status = "ESTORNADA"; bloqueado(c, escolha({ operacao: "VINCULAR", cobrancaId: cob.id }));
  });
  it("não vincula pagamento durante pedido de estorno nem trata estornada como paga", () => {
    const c = contexto(); const cob = existente(c); const p = escolha({ operacao: "VINCULAR", cobrancaId: cob.id });
    c.pedidos.push({ id: "p", referenciaId: cob.id, status: "PENDENTE", valorCentavos: 11800, executadoEm: null });
    bloqueado(c, p); c.pedidos = []; cob.status = "ESTORNADA"; bloqueado(c, p);
  });
  it("backup precisa ser recente, íntegro e restaurado", () => {
    const b = { restaurado: true, erro: null, criadoEm: data, bytes: BigInt(1024) };
    expect(backupApto(b, +data + 3600000)).toBe(true);
    expect(backupApto(b, +data + 7200001)).toBe(false);
    expect(backupApto(b, +data - 1)).toBe(false);
    expect(backupApto({ ...b, restaurado: false }, +data)).toBe(false);
    expect(backupApto({ ...b, erro: "falha" }, +data)).toBe(false);
    expect(backupApto({ ...b, bytes: BigInt(0) }, +data)).toBe(false);
  });
  it("recusa alterações de valor ou data vindas do navegador", () => {
    expect(zEscolhaHistorico.safeParse({ ...escolha(), valorCentavos: 1 }).success).toBe(false);
    expect(zEscolhaHistorico.safeParse(escolha({ transacaoId: "1&limit=100" })).success).toBe(false);
  });
});
