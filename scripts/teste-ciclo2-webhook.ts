/** Integração isolada de webhooks: banco descartável e transporte fictício. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { processarWebhookEntrada, recuperarWebhooksPagamento, registrarWebhookPagamento } from "@/lib/pagamentos/webhook-entrada";
import { despacharCobrancaAutomatica, prepararCobrancaAutomatica, reservarCobrancaManual } from "@/lib/assinaturas/cobranca-automatica";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/barberos_ciclo2_review_20261103") throw new Error("Use apenas o banco local descartável de revisão.");
globalThis.fetch = async () => { throw new Error("Rede bloqueada no teste"); };

async function main() {
  const tag = randomUUID();
  const entrada = { fonte: "asaas" as const, evento: `evento-${tag}`, tipo: "PAYMENT_RECEIVED", cobranca: `pay-${tag}` };
  const ids = await Promise.all(Array.from({ length: 4 }, () => registrarWebhookPagamento(entrada)));
  assert.equal(new Set(ids).size, 1);
  await assert.rejects(() => registrarWebhookPagamento({ ...entrada, cobranca: `outra-${tag}` }));
  let chamadas = 0;
  await Promise.all(Array.from({ length: 4 }, () => processarWebhookEntrada(ids[0], async () => { chamadas++; })));
  assert.equal(chamadas, 1);
  assert.equal((await db.webhookPagamentoEntrada.findUniqueOrThrow({ where: { id: ids[0] } })).estado, "CONCLUIDO");
  const pendente = await registrarWebhookPagamento({ ...entrada, evento: `sem-callback-${tag}` });
  let recuperadas = 0;
  await recuperarWebhooksPagamento(new Date(), async () => { recuperadas++; });
  assert.equal(recuperadas, 1);
  assert.equal((await db.webhookPagamentoEntrada.findUniqueOrThrow({ where: { id: pendente } })).estado, "CONCLUIDO");
  const recuperacao = await registrarWebhookPagamento({ ...entrada, evento: `copia-restaurada-${tag}`, cobranca: `restaurada-${tag}` });
  process.env.BARBEROS_QUARENTENA_RESTAURACAO = "true";
  assert.equal(await recuperarWebhooksPagamento(new Date(), async () => { throw new Error("quarentena violada"); }), 0);
  assert.equal(await processarWebhookEntrada(recuperacao, async () => { throw new Error("quarentena violada"); }), false);
  assert.equal((await db.webhookPagamentoEntrada.findUniqueOrThrow({ where: { id: recuperacao } })).estado, "PENDENTE");
  await assert.rejects(() => registrarWebhookPagamento({ ...entrada, evento: `nao-receber-${tag}` }));
  delete process.env.BARBEROS_QUARENTENA_RESTAURACAO;
  assert.equal(await processarWebhookEntrada(recuperacao, async () => {}), true);
  const falho = await registrarWebhookPagamento({ ...entrada, evento: `falho-${tag}` });
  await processarWebhookEntrada(falho, async () => { throw new Error("falha fictícia"); });
  assert.equal((await db.webhookPagamentoEntrada.findUniqueOrThrow({ where: { id: falho } })).estado, "REVISAO");
  assert.equal(await processarWebhookEntrada(falho, async () => { throw new Error("não deveria repetir"); }), false);
  const interrompido = await registrarWebhookPagamento({ ...entrada, evento: `interrompido-${tag}` });
  await db.webhookPagamentoEntrada.update({ where: { id: interrompido }, data: { estado: "PROCESSANDO", atualizadoEm: new Date("2020-01-01") } });
  await recuperarWebhooksPagamento(new Date("2021-01-01"), async () => { throw new Error("não deveria repetir"); });
  assert.equal((await db.webhookPagamentoEntrada.findUniqueOrThrow({ where: { id: interrompido } })).estado, "REVISAO");
  // Duas entregas distintas da mesma transação são preservadas, mas nunca executadas simultaneamente.
  const primeira = await registrarWebhookPagamento({ fonte: "celcash", evento: `entrega-1-${tag}`, tipo: "transaction.updateStatus", cobranca: `celtx-${tag}` });
  const segunda = await registrarWebhookPagamento({ fonte: "celcash", evento: `entrega-2-${tag}`, tipo: "transaction.updateStatus", cobranca: `celtx-${tag}` });
  assert.notEqual(primeira, segunda);
  assert.equal(await processarWebhookEntrada(segunda, async () => { throw new Error("não ultrapassar entrada anterior"); }), false);
  let comecou!: () => void, liberar!: () => void;
  const iniciada = new Promise<void>((r) => { comecou = r; });
  const espera = new Promise<void>((r) => { liberar = r; });
  const emCurso = processarWebhookEntrada(primeira, async () => { comecou(); await espera; });
  await iniciada;
  assert.equal(await processarWebhookEntrada(segunda, async () => { throw new Error("não executar em paralelo"); }), false);
  liberar(); await emCurso;
  let segundaExecutada = 0;
  assert.equal(await processarWebhookEntrada(segunda, async () => { segundaExecutada++; }), true);
  assert.equal(segundaExecutada, 1);
  const bloqueada = await registrarWebhookPagamento({ fonte: "celcash", evento: `entrega-3-${tag}`, tipo: "transaction.updateStatus", cobranca: `celtx-${tag}` });
  const depoisDaFalha = await registrarWebhookPagamento({ fonte: "celcash", evento: `entrega-4-${tag}`, tipo: "transaction.updateStatus", cobranca: `celtx-${tag}` });
  await processarWebhookEntrada(bloqueada, async () => { throw new Error("falha fictícia"); });
  assert.equal(await processarWebhookEntrada(depoisDaFalha, async () => { throw new Error("não ultrapassar revisão"); }), false);

  const cliente = await db.cliente.create({ data: { nome: "Teste", telefone: tag, aceitaMensagens: true } });
  const plano = await db.plano.create({ data: { nome: "Teste", precoCentavos: 10000 } });
  async function criar(nome: string) {
    const a = await db.assinatura.create({ data: { clienteId: cliente.id, planoId: plano.id, gatewayId: `sub_${tag}-${nome}`, status: "ATIVA", formaPagamento: "CARTAO", precoCentavos: 10000, origem: "SITE" } });
    const token = `${tag}-${nome}`;
    const c = await db.cobranca.create({ data: { assinaturaId: a.id, gatewayId: `gw-${tag}-${nome}`, valorCentavos: 10000, vencimento: new Date("2031-04-14T00:00:00Z"), status: "PENDENTE", forma: "CARTAO", tokenPublico: token, link: `/c/pagar/${token}` } });
    return { a, c };
  }
  process.env.COBRANCA_AUTOMATICA_WHATSAPP_ATIVA = "true";
  const agora = new Date("2031-04-15T15:00:00Z");
  const pausada = await criar("pausada");
  await db.assinatura.update({ where: { id: pausada.a.id }, data: { pausadaEm: agora, pausadaAte: new Date("2031-05-15T00:00:00Z") } });
  const rp = await prepararCobrancaAutomatica(pausada.c.id, agora);
  assert("tentativa" in rp && rp.tentativa?.estado === "REVISAO");
  assert.equal(await reservarCobrancaManual(pausada.c.id), null);
  const encerrando = await criar("encerrando");
  await db.assinatura.update({ where: { id: encerrando.a.id }, data: { encerraEm: new Date("2031-05-01T00:00:00Z") } });
  const re = await prepararCobrancaAutomatica(encerrando.c.id, agora);
  assert("tentativa" in re && re.tentativa?.estado === "REVISAO");
  assert.equal(await reservarCobrancaManual(encerrando.c.id), null);
  const corrida = await criar("corrida");
  await prepararCobrancaAutomatica(corrida.c.id, agora);
  const tentativa = await db.tentativaCobrancaAutomatica.findFirstOrThrow({ where: { cobrancaId: corrida.c.id } });
  let envios = 0;
  const remoto = async () => {
    await db.assinatura.update({ where: { id: corrida.a.id }, data: { pausadaEm: agora } });
    return { id: corrida.c.gatewayId, assinaturaGatewayId: corrida.a.gatewayId, forma: "CARTAO" as const, status: "PENDENTE" as const, abertaConfirmada: true, vencimentoConfirmado: true, valorCentavos: 10000, vencimento: "2031-04-14", pagaEm: null, link: null };
  };
  const resultado = await despacharCobrancaAutomatica(tentativa.id, async () => { envios++; return { idProvedor: "fake" }; }, remoto, agora, () => agora);
  assert.equal(resultado.estado, "VERIFICAR");
  assert.equal(envios, 0);
  assert.equal((await db.tentativaCobrancaAutomatica.findUniqueOrThrow({ where: { id: tentativa.id } })).estado, "REVISAO");
  console.log("OK webhook persistido, deduplicação, recuperação, falha/incerteza e pausa de cobrança");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
