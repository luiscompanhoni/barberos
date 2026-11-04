/** Prova com dados fictícios e transportes simulados em banco descartável exclusivo. */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { registrarEntrada, enviarNaConversa, notificarCliente } from "@/lib/whatsapp/conversas";
import { enviarCodigoAcesso } from "@/lib/whatsapp/canal";
import { mudarMensagens } from "@/lib/lgpd/titular";
import { travarPreferencia } from "@/lib/whatsapp/preferencia";

const alvo = "postgresql://recrutamento_teste@127.0.0.1:55439/barberos_rev4c_whatsapp_20261103";
if (process.env.DATABASE_URL !== alvo || process.env.AMBIENTE !== "homologacao" || process.env.WHATSAPP_PROVIDER !== "simulador") {
  throw new Error("Use apenas o banco local descartável e provedores simulados.");
}
globalThis.fetch = async () => { throw new Error("Rede bloqueada no teste de opt-out."); };
const numero = () => `55479${randomInt(10000000, 99999999)}`;
const msg = () => `teste-${randomUUID()}`;
async function aguardarBloqueio(fragmento: string) {
  for (let i = 0; i < 40; i++) {
    const r = await db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%${fragmento}%`}`;
    if (Number(r[0].total) > 0) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Operação não aguardou a trava esperada: ${fragmento}`);
}

async function main() {
  const tel = numero();
  const wamid = msg();
  const conversa = await registrarEntrada({ telefone: tel, texto: "PARAR", wamid, optOut: true });
  assert(conversa?.recusaAutomaticas);
  const cliente = await db.cliente.create({ data: { telefone: tel, nome: "Cliente fictício", aceitaMensagens: true } });
  assert.equal(cliente.aceitaMensagens, false, "cadastro não reativa mensagens");
  assert.equal(await registrarEntrada({ telefone: tel, texto: "PARAR", wamid, optOut: true }), null, "webhook repetido é idempotente");
  assert.equal((await notificarCliente(tel, "Novidade fictícia")).ok, false);
  assert.equal((await enviarNaConversa(conversa.id, "Lembrete fictício", "SISTEMA")).ok, false);
  assert.equal((await enviarNaConversa(conversa.id, "Resposta humana fictícia", "EQUIPE")).ok, true);
  assert.deepEqual(await enviarCodigoAcesso(tel, "123456"), { wamid: null }, "código solicitado continua no canal simulado");

  const telLegado = numero();
  await db.cliente.create({ data: { telefone: telLegado, nome: "Cliente fictício legado", aceitaMensagens: false } });
  assert.equal((await notificarCliente(telLegado, "Novidade após criação da conversa")).ok, false, "recusa legada vale mesmo sem conversa anterior");

  await mudarMensagens(cliente.id, "usuario-ficticio", true);
  assert.equal((await db.conversa.findUniqueOrThrow({ where: { telefone: tel } })).recusaAutomaticas, false);
  assert.equal((await db.cliente.findUniqueOrThrow({ where: { id: cliente.id } })).aceitaMensagens, true);
  assert.equal((await notificarCliente(tel, "Aviso de teste após opção explícita")).ok, true);

  const telNovo = numero();
  await registrarEntrada({ telefone: telNovo, texto: "PARAR", wamid: msg(), optOut: true });
  const mudou = await db.cliente.update({ where: { id: cliente.id }, data: { telefone: telNovo, aceitaMensagens: true } });
  assert.equal(mudou.aceitaMensagens, false, "troca de número respeita recusa prévia");

  const primeiro = numero();
  await db.conversa.create({ data: { telefone: primeiro } });
  let aguardandoCadastro: Promise<{ aceitaMensagens: boolean }> | undefined;
  await db.$transaction(async tx => {
    await travarPreferencia(tx, primeiro);
    aguardandoCadastro = db.cliente.create({ data: { telefone: primeiro, nome: "Corrida fictícia", aceitaMensagens: true } });
    void aguardandoCadastro.catch(() => {});
    await aguardarBloqueio("clientes");
    await tx.conversa.update({ where: { telefone: primeiro }, data: { recusaAutomaticas: true } });
  });
  assert.equal((await aguardandoCadastro!).aceitaMensagens, false, "PARAR ganha antes do cadastro mesmo em corrida");

  const segundo = numero();
  await db.conversa.create({ data: { telefone: segundo } });
  let aguardandoParar: ReturnType<typeof registrarEntrada> | undefined;
  await db.$transaction(async tx => {
    await travarPreferencia(tx, segundo);
    await tx.cliente.create({ data: { telefone: segundo, nome: "Corrida fictícia 2", aceitaMensagens: true } });
    aguardandoParar = registrarEntrada({ telefone: segundo, texto: "PARAR", wamid: msg(), optOut: true });
    void aguardandoParar.catch(() => {});
    await aguardarBloqueio("pg_advisory_xact_lock");
  });
  await aguardandoParar;
  assert.equal((await db.cliente.findUniqueOrThrow({ where: { telefone: segundo } })).aceitaMensagens, false, "PARAR vence após cadastro concorrente");
  console.log("Opt-out: pré-cadastro, repetição, troca de telefone, corridas, reativação explícita e OTP simulado passaram.");
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
