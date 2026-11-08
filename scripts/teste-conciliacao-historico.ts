// Banco descartavel local; nunca aceita URL de producao. Nao envia mensagens nem chama operadoras.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Sessao } from "@/lib/auth/sessao";
import { aplicarHistorico } from "@/lib/conciliacao/historico/aplicar";
import { preverHistorico } from "@/lib/conciliacao/historico/consulta";
import type { EscolhaHistorico } from "@/lib/conciliacao/historico/schemas";
import { classificarMovimento } from "@/lib/conciliacao/resultado";
import { cobrancaEmAberto, sincronizarCobranca } from "@/lib/assinaturas/cobrancas";
import { situacaoDoCliente } from "@/lib/assinaturas/servico";
import { carregarAlvo } from "@/lib/estornos/alvo";
import { guardarMovimentosCelcash } from "@/lib/conciliacao/celcash";
import { resumoMes } from "@/lib/financeiro/resumo";
import { resultadoDoMes } from "@/lib/conciliacao/resultado";

const url = new URL(process.env.DATABASE_URL ?? "http://invalido");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/barberos_historico_teste") throw new Error("Use somente o banco local descartável barberos_historico_teste.");
const lote = randomUUID();
let sequencia = Date.now();
const fontes = new Map<string, unknown>();
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = new URL(String(input));
  assert.equal(u.origin, "https://api.sandbox.cel.cash");
  if (u.pathname === "/v2/token") {
    assert.equal(JSON.parse(String(init?.body)).scope, "transactions.read");
    return Response.json({ access_token: "sintetico-local" });
  }
  assert.equal(init?.method ?? "GET", "GET"); assert.equal(u.pathname, "/v2/transactions");
  const fonte = fontes.get(u.searchParams.get("galaxPayIds")!);
  return Response.json({ Transactions: fonte ? [fonte] : [] });
};
process.env.CELCASH_GALAX_ID = "sintetico";
process.env.CELCASH_GALAX_HASH = "sintetico";
process.env.CELCASH_AMBIENTE = "sandbox";
const instante = new Date("2026-10-23T13:00:00Z");

async function main() {
  // O banco isolado não recebe o seed geral; prepare a configuração antes das leituras paralelas.
  await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const usuario = await db.usuario.create({ data: { nome: "Dono sintético", telefone: `teste-${lote}`, papel: "DONO" } });
  const s: Sessao = { usuarioId: usuario.id, papel: "DONO", nome: usuario.nome, clienteId: null, barbeiroId: null };
  const plano = await db.plano.create({ data: { nome: `[teste ${lote}]`, precoCentavos: 11800 } });
  // Metadados ficticios exercitam a regra; nao sao uma declaracao de backup de producao.
  const backup = await db.backupRegistro.create({ data: { id: lote, tipo: "TESTE", arquivo: "fixture-sintetica.dump", bytes: BigInt(1024), restaurado: true, foraDoServidor: false, conferencia: "Fixture exclusiva de teste" } });
  async function fixture() {
    const id = String(++sequencia);
    const cliente = await db.cliente.create({ data: { nome: "Pessoa Sintética", telefone: `55119${id.slice(-8)}` } });
    const assinatura = await db.assinatura.create({ data: { clienteId: cliente.id, planoId: plano.id, precoCentavos: 11800, formaPagamento: "CARTAO", origem: "RECEPCAO", status: "CANCELADA", gatewayId: `celcash:hist:${cliente.id}` } });
    const mov = await db.movimentoExterno.create({ data: { fonte: "CELCASH", tipo: "RECEBIMENTO", idExterno: `${lote}-${id}`, transacaoId: id, valorCentavos: 11800, data: instante, descricao: "Crédito sintético" } });
    const fonte = { galaxPayId: Number(id), value: 11800, payday: "2026-10-23", paydayDateDateTime: "2026-10-23 10:00:00", status: "captured", Subscription: { galaxPayId: Number(id), Customer: { name: cliente.nome, document: "", phones: [cliente.telefone] } } };
    fontes.set(id, fonte);
    const p: EscolhaHistorico = { transacaoId: id, assinaturaId: assinatura.id, operacao: "IMPORTAR", identidadeConfirmada: false, motivo: "Evidência fictícia conferida no teste" };
    return { id, cliente, assinatura, mov, fonte, p };
  }
  async function aplicar(p: EscolhaHistorico) {
    const v = await preverHistorico(p); assert.deepEqual(v.bloqueios, []); assert.equal(v.podeAplicar, true);
    const entrada = { ...p, revisao: v.revisao, backupId: v.backup!.id };
    return { resultado: await aplicarHistorico(s, entrada), entrada };
  }
  const primeiro = await fixture();
  const { resultado, entrada } = await aplicar(primeiro.p);
  const cob = await db.cobranca.findUniqueOrThrow({ where: { id: resultado.cobrancaId } });
  assert.equal(cob.valorCentavos, 11800); assert.equal(cob.pagaEm?.toISOString(), instante.toISOString());
  assert.equal(cob.gatewayId, `celcash:pag:${primeiro.id}`);
  assert.equal((await db.assinatura.findUniqueOrThrow({ where: { id: primeiro.assinatura.id } })).status, "CANCELADA");
  assert.equal((await aplicarHistorico(s, entrada)).repetida, true);
  await assert.rejects(aplicarHistorico(s, { ...entrada, motivo: "Motivo alterado depois da execução" }), /mudaram/);
  await assert.rejects(aplicarHistorico(s, { ...entrada, backupId: "outro-backup" }), /mudaram/);
  assert.equal(await db.cobranca.count({ where: { assinaturaId: primeiro.assinatura.id } }), 1);
  assert.equal(await db.auditoria.count({ where: { entidadeId: cob.id, acao: "conciliacao_historico" } }), 1);
  console.log("OK inclusão, preservação, auditoria e repetição idempotente");

  const f = await fixture();
  const antiga = await db.cobranca.create({ data: { assinaturaId: f.assinatura.id, gatewayId: `cashbarber:pag:${f.id}`, valorCentavos: 11800, status: "PAGA", vencimento: new Date("2026-10-23"), pagaEm: instante } });
  const destino = await db.assinatura.create({ data: { clienteId: f.cliente.id, planoId: plano.id, precoCentavos: 11800, formaPagamento: "CARTAO", origem: "RECEPCAO", status: "ATIVA" } });
  const vincular = { ...f.p, operacao: "VINCULAR" as const, cobrancaId: antiga.id, assinaturaId: destino.id };
  await aplicar(vincular);
  const depois = await db.cobranca.findUniqueOrThrow({ where: { id: antiga.id } });
  assert.equal(depois.assinaturaId, destino.id); assert.equal(depois.gatewayId, antiga.gatewayId);
  assert.equal(+depois.vencimento, +antiga.vencimento); assert.equal(+depois.pagaEm!, +antiga.pagaEm!);
  assert.equal(await db.cobranca.count({ where: { assinatura: { clienteId: f.cliente.id } } }), 1);
  await assert.rejects(classificarMovimento(s, f.mov.id, { tipo: "TRANSFERENCIA", categoria: null }), /correção histórica/);
  console.log("OK vínculo preserva datas, origem e quantidade; extrato vinculado protegido");

  const financeiroAntes = await resumoMes("2026-10");
  f.fonte.status = "reversed";
  const est = await db.movimentoExterno.create({ data: { fonte: "CELCASH", tipo: "ESTORNO", idExterno: `${lote}-est-${f.id}`, transacaoId: f.id, valorCentavos: -11800, data: instante, descricao: "Devolução sintética" } });
  const r = await aplicar({ ...vincular, operacao: "ESTORNO" });
  const pedido = await db.pedidoEstorno.findFirstOrThrow({ where: { referenciaId: antiga.id } });
  assert.equal(pedido.status, "EXECUTADO"); assert.equal(pedido.valorCentavos, 11800); assert.equal(+pedido.executadoEm!, +est.data);
  assert.equal((await db.cobranca.findUniqueOrThrow({ where: { id: antiga.id } })).status, "ESTORNADA");
  assert.equal((await aplicarHistorico(s, r.entrada)).repetida, true);
  assert.equal(await db.pedidoEstorno.count({ where: { referenciaId: antiga.id } }), 1);
  const financeiroDepois = await resumoMes("2026-10");
  assert.equal(financeiroDepois.receitas.mensalidades.total, financeiroAntes.receitas.mensalidades.total);
  assert.equal(financeiroDepois.receitas.estornos.total, financeiroAntes.receitas.estornos.total + 11800);
  assert.equal(financeiroDepois.receitas.total, financeiroAntes.receitas.total - 11800);
  console.log("OK estorno histórico integral e uma única devolução local");

  const g = await fixture();
  const v = await preverHistorico(g.p);
  await db.movimentoExterno.update({ where: { id: g.mov.id }, data: { valorCentavos: 11700 } });
  await assert.rejects(aplicarHistorico(s, { ...g.p, revisao: v.revisao, backupId: backup.id }), /mudaram/);
  assert.equal(await db.cobranca.count({ where: { assinaturaId: g.assinatura.id } }), 0);
  await assert.rejects(aplicarHistorico({ ...s, papel: "GERENTE" }, entrada), /permissão/);
  console.log("OK revisão obsoleta e acesso de gerente recusados sem gravação");

  const h = await fixture();
  await db.backupRegistro.update({ where: { id: backup.id }, data: { restaurado: false } });
  const semBackup = await preverHistorico(h.p); assert.equal(semBackup.podeAplicar, false);
  await assert.rejects(aplicarHistorico(s, { ...h.p, revisao: semBackup.revisao, backupId: backup.id }), /backup/);
  await db.backupRegistro.update({ where: { id: backup.id }, data: { restaurado: true } });
  const previa = await preverHistorico(h.p); const concorrente = { ...h.p, revisao: previa.revisao, backupId: backup.id };
  const duplo = await Promise.allSettled([aplicarHistorico(s, concorrente), aplicarHistorico(s, concorrente)]);
  assert.ok(duplo.some((x) => x.status === "fulfilled"));
  assert.equal(await db.cobranca.count({ where: { assinaturaId: h.assinatura.id } }), 1);
  assert.equal(await db.auditoria.count({ where: { usuarioId: s.usuarioId, acao: "conciliacao_historico" } }), 4);
  console.log("OK backup obrigatório e concorrência sem duplicar cobrança/auditoria");
  await db.assinatura.update({ where: { id: primeiro.assinatura.id }, data: { gatewayId: `celsub_${primeiro.id}` } });
  await sincronizarCobranca({ id: `celtx_${primeiro.id}`, assinaturaGatewayId: `celsub_${primeiro.id}`, status: "PAGA", valorCentavos: 11800, vencimento: "2026-10-23", pagaEm: "2026-10-23", link: null });
  assert.equal(await db.cobranca.count({ where: { assinaturaId: primeiro.assinatura.id } }), 1);
  console.log("OK sincronização posterior não recria pagamento histórico como celtx");
  assert.match((await carregarAlvo("MENSALIDADE", cob.id)).bloqueio!, /histórica conciliada/);
  assert.equal(await cobrancaEmAberto(destino.id), null);
  assert.equal((await situacaoDoCliente(f.cliente.id))?.valida, true);
  const corrente = await db.cobranca.create({ data: { assinaturaId: destino.id, gatewayId: `sintetico-corrente-${lote}`, valorCentavos: 11800, status: "PAGA", vencimento: new Date("2026-11-23"), pagaEm: new Date("2026-11-23T13:00Z") } });
  await sincronizarCobranca({ id: corrente.gatewayId, assinaturaGatewayId: null, status: "PAGA", valorCentavos: 11800, vencimento: "2026-11-23", pagaEm: "2026-11-23T13:00Z", link: null });
  const ativa = await db.assinatura.findUniqueOrThrow({ where: { id: destino.id } });
  assert.equal(ativa.status, "ATIVA"); assert.equal(ativa.proximoVencimento?.toISOString().slice(0, 10), "2026-12-23");
  console.log("OK histórico não bloqueia benefícios, não reaparece como dívida e não permite novo estorno normal");
  const mudouNaFonte = { id: `celtx_${primeiro.id}`, assinaturaGatewayId: null, status: "ESTORNADA" as const, valorCentavos: 11800, vencimento: "2026-10-23", pagaEm: "2026-10-23", link: null };
  await sincronizarCobranca(mudouNaFonte); await sincronizarCobranca(mudouNaFonte);
  assert.equal((await db.cobranca.findUniqueOrThrow({ where: { id: cob.id } })).status, "PAGA");
  assert.equal(await db.auditoria.count({ where: { entidadeId: cob.id, acao: "conciliacao_historico_divergencia" } }), 1);
  assert.ok((await resultadoDoMes("2026-10")).alertas.some((a) => a.includes(primeiro.id)));
  await aplicar({ ...primeiro.p, operacao: "VINCULAR", cobrancaId: cob.id });
  assert.equal((await resultadoDoMes("2026-10")).alertas.some((a) => a.includes(primeiro.id)), false);
  console.log("OK mudança posterior gera alerta auditado uma vez e nova conferência resolve a pendência");

  const corrida = await fixture(); corrida.fonte.status = "reversed";
  const original = await db.cobranca.create({ data: { assinaturaId: corrida.assinatura.id, gatewayId: `cashbarber:pag:${corrida.id}`, valorCentavos: 11800, vencimento: new Date("2026-10-23"), pagaEm: instante, status: "PAGA" } });
  await db.movimentoExterno.create({ data: { fonte: "CELCASH", tipo: "ESTORNO", idExterno: `${lote}-est-${corrida.id}`, transacaoId: corrida.id, valorCentavos: -11800, data: instante, descricao: "Estorno sintético" } });
  const pc = { ...corrida.p, operacao: "ESTORNO" as const, cobrancaId: original.id };
  const vc = await preverHistorico(pc);
  let liberar!: () => void, travou!: () => void;
  const porta = new Promise<void>((r) => { liberar = r; }); const adquirida = new Promise<void>((r) => { travou = r; });
  const normal = db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`estorno:MENSALIDADE:${original.id}`}))`;
    await tx.pedidoEstorno.create({ data: { tipo: "MENSALIDADE", referenciaId: original.id, valorCentavos: 11800, valorOriginalCentavos: 11800, motivo: "Pedido sintético simultâneo", meio: "CELCASH", forma: "ONLINE", descricao: "Teste de concorrência", status: "PENDENTE" } });
    travou(); await porta;
  }, { timeout: 10000 });
  await adquirida;
  const aplicacao = aplicarHistorico(s, { ...pc, revisao: vc.revisao, backupId: backup.id }).then(() => null, (e: unknown) => e);
  try {
    for (let n = 0; n < 100; n++) {
      const esperando = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'`;
      if (esperando[0].n > BigInt(0)) break;
      await new Promise((r) => setTimeout(r, 20));
      if (n === 99) throw new Error("Teste não observou a espera pela trava.");
    }
  } finally { liberar(); }
  await normal; assert.ok(await aplicacao instanceof Error);
  assert.equal(await db.pedidoEstorno.count({ where: { referenciaId: original.id } }), 1);
  assert.equal((await db.cobranca.findUniqueOrThrow({ where: { id: original.id } })).status, "PAGA");
  console.log("OK pedido normal criado durante a espera impede segundo estorno histórico");

  const extrato = await fixture(); const ve = await preverHistorico(extrato.p);
  const portaExtrato = new Promise<void>((r) => { liberar = r; });
  const travaExtrato = new Promise<void>((r) => { travou = r; });
  const segurando = db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`conciliacao:celcash:${extrato.id}`}))`;
    travou(); await portaExtrato;
  }, { timeout: 10000 });
  await travaExtrato;
  const inserindo = guardarMovimentosCelcash([{ fonte: "CELCASH", tipo: "RECEBIMENTO", idExterno: `${lote}-segundo-${extrato.id}`, transacaoId: extrato.id, valorCentavos: 11800, data: instante, descricao: "Crédito ambíguo sintético" }]);
  try {
    for (let n = 0; n < 100; n++) {
      const esperando = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'`;
      if (esperando[0].n > BigInt(0)) break;
      await new Promise((r) => setTimeout(r, 20));
      if (n === 99) throw new Error("Importador de extrato não usou a trava da conciliação.");
    }
  } finally { liberar(); }
  await segurando; await inserindo;
  await assert.rejects(aplicarHistorico(s, { ...extrato.p, revisao: ve.revisao, backupId: backup.id }), /mudaram/);
  assert.equal(await db.cobranca.count({ where: { assinaturaId: extrato.assinatura.id } }), 0);
  console.log("OK inserção de extrato compartilha trava e invalida a prévia anterior");

  const classificacao = await fixture();
  const portaClassificacao = new Promise<void>((r) => { liberar = r; });
  const travaClassificacao = new Promise<void>((r) => { travou = r; });
  const editando = db.$transaction(async (tx) => {
    await tx.movimentoExterno.update({ where: { id: classificacao.mov.id }, data: { tipo: "TRANSFERENCIA", observacao: "Nota gravada simultaneamente" } });
    travou(); await portaClassificacao;
  }, { timeout: 10000 });
  await travaClassificacao;
  const classificado = classificarMovimento(s, classificacao.mov.id, { tipo: "RECEBIMENTO", categoria: null });
  try {
    for (let n = 0; n < 100; n++) {
      const esperando = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (esperando[0].n > BigInt(0)) break;
      await new Promise((r) => setTimeout(r, 20));
      if (n === 99) throw new Error("Classificação não aguardou a edição concorrente.");
    }
  } finally { liberar(); }
  await editando; await classificado;
  assert.equal((await db.movimentoExterno.findUniqueOrThrow({ where: { id: classificacao.mov.id } })).observacao, "Nota gravada simultaneamente");
  const audit = await db.auditoria.findFirstOrThrow({ where: { entidadeId: classificacao.mov.id, acao: "conciliacao_classificar" } });
  assert.equal((audit.dados as { antes: { tipo: string } }).antes.tipo, "TRANSFERENCIA");
  console.log("OK classificação preserva nota concorrente e audita o estado real anterior");
  const rollback = await fixture(); const vr = await preverHistorico(rollback.p);
  // Injeta uma falha de armazenamento exclusivamente no banco descartavel e remove o gatilho ao terminar.
  await db.$executeRawUnsafe(`CREATE FUNCTION teste_historico_auditoria() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."usuarioId" = 'falha-sintetica-auditoria' THEN RAISE EXCEPTION 'Falha sintética de auditoria'; END IF; RETURN NEW; END $$`);
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER teste_historico_auditoria BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION teste_historico_auditoria()`);
    await assert.rejects(aplicarHistorico({ ...s, usuarioId: "falha-sintetica-auditoria" }, { ...rollback.p, revisao: vr.revisao, backupId: backup.id }));
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS teste_historico_auditoria ON auditoria`);
    await db.$executeRawUnsafe(`DROP FUNCTION teste_historico_auditoria()`);
  }
  assert.equal(await db.cobranca.count({ where: { assinaturaId: rollback.assinatura.id } }), 0);
  assert.equal(await db.vinculoCobrancaExterna.count({ where: { transacaoId: rollback.id } }), 0);
  console.log("OK falha de auditoria desfaz cobrança e vínculo na mesma transação");
  console.log("Fluxo concluído em banco local descartável, com gateway somente simulado.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { globalThis.fetch = fetchOriginal; await db.$disconnect(); });
