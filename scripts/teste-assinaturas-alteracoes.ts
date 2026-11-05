/** Banco local dedicado e rede bloqueada; mantém somente suas fixtures identificadas. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || url.pathname !== "/barberos_cliente_teste_20261104") throw new Error("Use apenas o banco local dedicado à revisão do cliente.");
process.env.AMBIENTE = "teste";
process.env.PAGAMENTOS_PROVIDER = "simulado";
process.env.WHATSAPP_PROVIDER = "simulador";
globalThis.fetch = async () => { throw new Error("Rede externa bloqueada no teste"); };

async function main() {
  const { db } = await import("@/lib/db");
  const { solicitarAlteracaoPlano, aplicarAlteracaoPlano, cancelarAlteracaoPlano } = await import("@/lib/assinaturas/alteracao-plano");
  const { cancelarOperacaoInicial, reservarPagamentoInicial } = await import("@/lib/assinaturas/operacao-inicial");
  const { gerarPixDoMes } = await import("@/lib/assinaturas/cartao-pix");
  const tag = `teste-assinaturas-${randomUUID()}`;
  const originalAgora = Date.now;
  try {
    Date.now = () => +new Date("2031-01-20T12:00:00Z");
    const cliente = await db.cliente.create({ data: { nome: tag, telefone: tag } });
    const usuario = await db.usuario.create({ data: { nome: tag, telefone: `${tag}-equipe`, papel: "RECEPCAO" } });
    const antigo = await db.plano.create({ data: { nome: `${tag} antigo`, precoCentavos: 10000 } });
    const novo = await db.plano.create({ data: { nome: `${tag} novo`, precoCentavos: 15000 } });
    const a = await db.assinatura.create({ data: { clienteId: cliente.id, planoId: antigo.id, status: "ATIVA", formaPagamento: "PIX", precoCentavos: 10000, origem: "SITE", gatewayId: `pixrec_${tag}`, gatewayClienteId: `cus_${tag}`, cicloInicio: new Date("2031-01-01"), proximoVencimento: new Date("2031-02-01") } });
    const historica = await db.cobranca.create({ data: { assinaturaId: a.id, gatewayId: `fixture_${tag}`, valorCentavos: 10000, vencimento: new Date("2031-01-01"), forma: "PIX", status: "PAGA", pagaEm: new Date("2031-01-01T12:00:00Z") } });
    const solicitar = () => solicitarAlteracaoPlano({ assinaturaId: a.id, planoId: novo.id, origem: "SITE", usuarioId: usuario.id });
    const concorrentes = await Promise.all(Array.from({ length: 5 }, solicitar));
    assert.equal(new Set(concorrentes.map(p => p.id)).size, 1);
    assert.equal(await db.alteracaoPlanoAssinatura.count({ where: { assinaturaId: a.id } }), 1);
    assert.equal((await db.assinatura.findUniqueOrThrow({ where: { id: a.id } })).precoCentavos, 10000);
    await assert.rejects(() => aplicarAlteracaoPlano(a.id, usuario.id), /período atual/);
    await assert.rejects(() => gerarPixDoMes(a.id, "2031-02-01"), /troca de plano/);
    assert.equal(await db.emissaoPixMensal.count({ where: { assinaturaId: a.id } }), 0);
    Date.now = () => +new Date("2031-02-01T12:00:00Z");
    const aplicacoes = await Promise.allSettled([aplicarAlteracaoPlano(a.id, usuario.id), aplicarAlteracaoPlano(a.id, usuario.id)]);
    assert.equal(aplicacoes.filter(r => r.status === "fulfilled").length, 1);
    const depois = await db.assinatura.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(depois.planoId, novo.id); assert.equal(depois.precoCentavos, 15000);
    assert.equal(depois.proximoVencimento?.toISOString().slice(0, 10), "2031-02-01");
    assert.equal((await db.cobranca.findUniqueOrThrow({ where: { id: historica.id } })).valorCentavos, 10000);
    assert.equal(await db.auditoria.count({ where: { entidadeId: a.id, acao: "aplicar_troca_plano" } }), 1);
    assert.deepEqual(await cancelarAlteracaoPlano(a.id, usuario.id), { cancelada: false });

    const pendente = await db.assinatura.create({ data: { clienteId: cliente.id, planoId: antigo.id, status: "PENDENTE", formaPagamento: "CARTAO", precoCentavos: 10000, origem: "SITE", gatewayClienteId: `simcus_${tag}` } });
    assert.equal((await cancelarOperacaoInicial(pendente.id, usuario.id)).cancelada, true);
    assert.equal((await cancelarOperacaoInicial(pendente.id, usuario.id)).cancelada, true);
    assert.equal(await db.auditoria.count({ where: { entidadeId: pendente.id, acao: "cancelar_operacao_inicial" } }), 1);
    const tentativa = await db.assinatura.create({ data: { clienteId: cliente.id, planoId: antigo.id, status: "PENDENTE", formaPagamento: "CARTAO", precoCentavos: 10000, origem: "SITE", gatewayClienteId: `simcus_${tag}` } });
    const claims = await Promise.allSettled(Array.from({ length: 5 }, () => reservarPagamentoInicial(tentativa.id, "CARTAO")));
    assert.equal(claims.filter(r => r.status === "fulfilled").length, 1);
    await assert.rejects(() => cancelarOperacaoInicial(tentativa.id, usuario.id), /conferência/);
    assert.equal((await db.assinatura.findUniqueOrThrow({ where: { id: tentativa.id } })).operacaoInicial, "CARTAO");
    assert.equal(await db.cobranca.count({ where: { assinaturaId: tentativa.id } }), 0);
    console.log("OK PG: pedido concorrente único, preservação de ciclo/histórico, bloqueio de Pix antigo, aplicação única, cancelamento inicial idempotente e claim financeiro único. Nenhum pagamento ou rede externa.");
  } finally { Date.now = originalAgora; await db.$disconnect(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
