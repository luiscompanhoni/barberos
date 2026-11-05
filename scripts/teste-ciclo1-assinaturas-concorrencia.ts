/** Concorrência determinística: somente fixtures no PostgreSQL sintético local. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { Sessao } from "@/lib/auth/sessao";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || url.pathname !== "/barberos_cliente_teste_20261104") throw Error("Use somente o banco sintético local autorizado.");
process.env.AMBIENTE = "teste";
process.env.PAGAMENTOS_PROVIDER = "simulado";
process.env.WHATSAPP_PROVIDER = "simulador";
globalThis.fetch = async () => { throw Error("Rede bloqueada no ensaio de concorrência."); };
const tag = `testeciclo1-${randomUUID()}`;
url.searchParams.set("application_name", tag);
const base = new PrismaClient({ datasourceUrl: url.toString(), transactionOptions: { timeout: 15000 } });
const cancelarPronto = Promise.withResolvers<void>(), liberarSincronizacao = Promise.withResolvers<void>();
const reservaPronta = Promise.withResolvers<void>(), liberarReserva = Promise.withResolvers<void>();
let contratoPausado = "", clientePausado = "", pausouSync = false, pausouReserva = false, checks = 0;
const db = base.$extends({ query: {
  assinatura: { async findUnique({ args, query }) {
    const r = await query(args);
    if (args.where.gatewayId === contratoPausado && !pausouSync) {
      pausouSync = true; cancelarPronto.resolve(); await liberarSincronizacao.promise;
    }
    return r;
  } },
  agendamento: { async create({ args, query }) {
    if (args.data.clienteId === clientePausado && !pausouReserva) {
      pausouReserva = true; reservaPronta.resolve(); await liberarReserva.promise;
    }
    return query(args);
  } },
} });
(globalThis as unknown as { prisma: PrismaClient }).prisma = db as unknown as PrismaClient;
const clientes: string[] = [], usuarios: string[] = [], planos: string[] = [], barbeiros: string[] = [], servicos: string[] = [], assinaturas: string[] = [];
function ok(condicao: unknown, mensagem: string) { assert.ok(condicao, mensagem); checks++; console.log(`OK ${mensagem}`); }
async function esperar<T>(p: Promise<T>) {
  let limite: ReturnType<typeof setTimeout>;
  const prazo = new Promise<never>((_, reject) => { limite = setTimeout(() => reject(Error("Barreira excedeu 5s")), 5000); });
  try { return await Promise.race([p, prazo]); }
  finally { clearTimeout(limite!); }
}

async function main() {
  const { sincronizarCobranca } = await import("@/lib/assinaturas/cobrancas");
  const { cancelarOperacaoInicial } = await import("@/lib/assinaturas/operacao-inicial");
  const { solicitarAlteracaoPlano, aplicarAlteracaoPlano } = await import("@/lib/assinaturas/alteracao-plano");
  const { criarAgendamento } = await import("@/lib/agenda/agendamentos");
  const { instanteLocal, diaSemana } = await import("@/lib/agenda/tempo");
  const agoraOriginal = Date.now;
  try {
    const cliente = await db.cliente.create({ data: { nome: tag, telefone: tag } }); clientes.push(cliente.id);
    const equipe = await db.usuario.create({ data: { nome: tag, telefone: `${tag}-equipe`, papel: "RECEPCAO" } }); usuarios.push(equipe.id);
    const servico = await db.servico.create({ data: { nome: `${tag}-barba`, duracaoMin: 30, precoCentavos: 5000 } }); servicos.push(servico.id);
    const antigo = await db.plano.create({ data: { nome: `${tag}-antigo`, precoCentavos: 10000, servicos: { create: { servicoId: servico.id } } } }); planos.push(antigo.id);
    const novo = await db.plano.create({ data: { nome: `${tag}-novo`, precoCentavos: 15000 } }); planos.push(novo.id);

    contratoPausado = `simsub_${tag}`;
    const inicial = await db.assinatura.create({ data: { clienteId: cliente.id, planoId: antigo.id, precoCentavos: 10000, origem: "SITE", formaPagamento: "CARTAO", gatewayId: contratoPausado, status: "PENDENTE" } }); assinaturas.push(inicial.id);
    // Suspende após ler a referência, enquanto o cancelamento termina em outra conexão.
    const cobranca = { id: `simchg_${tag}`, assinaturaGatewayId: contratoPausado, valorCentavos: 10000,
      vencimento: "2031-01-01", status: "CANCELADA" as const, pagaEm: null, link: null };
    const sync = sincronizarCobranca(cobranca);
    await esperar(cancelarPronto.promise);
    ok((await cancelarOperacaoInicial(inicial.id, equipe.id)).cancelada, "cancelamento inicial conclui enquanto consulta antiga está suspensa");
    liberarSincronizacao.resolve();
    assert.deepEqual(await sync, { de: "CANCELADA", para: "CANCELADA" });
    ok((await db.assinatura.findUniqueOrThrow({ where: { id: inicial.id } })).status === "CANCELADA", "consulta antiga não reabre assinatura cancelada");
    ok(await db.cobranca.count({ where: { assinaturaId: inicial.id, gatewayId: cobranca.id } }) === 1, "evidência da cobrança continua registrada uma vez");
    // Uma evidência tardia deve ficar conciliável, sem reativar um contrato encerrado.
    await sincronizarCobranca({ ...cobranca, status: "PAGA", pagaEm: "2031-01-01T12:00:00Z" });
    ok((await db.assinatura.findUniqueOrThrow({ where: { id: inicial.id } })).status === "CANCELADA" &&
      (await db.cobranca.findUniqueOrThrow({ where: { gatewayId: cobranca.id } })).status === "PAGA", "pagamento tardio sintético preserva evidência sem reativação ou notificação");

    Date.now = () => +new Date("2031-01-20T12:00:00Z");
    const a = await db.assinatura.create({ data: { clienteId: cliente.id, planoId: antigo.id, status: "ATIVA", precoCentavos: 10000,
      origem: "SITE", formaPagamento: "PIX", gatewayId: `pixrec_${tag}`, cicloInicio: new Date("2031-01-01"), proximoVencimento: new Date("2031-02-01") } }); assinaturas.push(a.id);
    const historica = await db.cobranca.create({ data: { assinaturaId: a.id, gatewayId: `fixture_${tag}`, valorCentavos: 10000, vencimento: new Date("2031-01-01"), status: "PAGA", pagaEm: new Date("2031-01-01T12:00:00Z") } });
    await solicitarAlteracaoPlano({ assinaturaId: a.id, planoId: novo.id, origem: "SITE", usuarioId: equipe.id });
    Date.now = () => +new Date("2031-02-01T12:00:00Z");
    const cfg = await db.configuracao.findUniqueOrThrow({ where: { id: 1 } });
    const data = "2031-02-02";
    const b = await db.barbeiro.create({ data: { nome: tag, usuario: { create: { nome: tag, telefone: `${tag}-prof`, papel: "BARBEIRO" } },
      servicos: { create: { servicoId: servico.id } }, expediente: { create: { diaSemana: diaSemana(data), inicioMin: 480, fimMin: 1200 } } } });
    barbeiros.push(b.id); usuarios.push(b.usuarioId);
    const ator: Sessao = { usuarioId: equipe.id, nome: tag, papel: "RECEPCAO", clienteId: null, barbeiroId: null };
    const entrada = { barbeiroId: b.id, servicoId: servico.id, cliente: { id: cliente.id }, origem: "RECEPCAO" as const, inicio: new Date(instanteLocal(data, 600, cfg.fuso)) };
    clientePausado = cliente.id;
    const reserva = criarAgendamento(entrada, ator);
    await esperar(reservaPronta.promise);
    // O resultado é capturado imediatamente para evitar rejeição não tratada na reprodução.
    const aplicacao = aplicarAlteracaoPlano(a.id, equipe.id).then(valor => ({ valor, erro: null }), erro => ({ valor: null, erro }));
    const inicioEspera = performance.now();
    let aguardou = false;
    while (performance.now() - inicioEspera < 2500) {
      const filas = await base.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE application_name = ${tag} AND wait_event = 'advisory'`;
      if (filas[0].n > BigInt(0)) { aguardou = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    liberarReserva.resolve();
    const ag = await reserva;
    const resultado = await aplicacao;
    ok(aguardou, "troca espera a trava do cliente durante agendamento da recepção");
    ok(ag.precoCentavos === 0 && ag.assinaturaId === a.id, "reserva em voo mantém cobertura do plano antigo");
    ok(resultado.erro instanceof Error && /horários futuros/.test(resultado.erro.message), "troca revalida reservas e recusa condições incompatíveis");
    ok((await db.assinatura.findUniqueOrThrow({ where: { id: a.id } })).planoId === antigo.id, "corrida não altera plano de uma reserva recém-criada");
    await db.agendamento.delete({ where: { id: ag.id } });
    ok((await aplicarAlteracaoPlano(a.id, equipe.id)).aplicada, "sem reserva pendente a troca pode ser aplicada");
    const avulso = await criarAgendamento(entrada, ator);
    ok(avulso.precoCentavos === 5000 && avulso.assinaturaId === null, "reserva posterior à troca usa os novos benefícios e valor");
    ok((await db.cobranca.findUniqueOrThrow({ where: { id: historica.id } })).valorCentavos === 10000, "pagamento histórico permanece integralmente preservado");
    ok(await db.emissaoPixMensal.count({ where: { assinaturaId: a.id } }) === 0, "revisão não emite cobranças nem movimenta dinheiro");
    console.log(`OK ${checks} verificações de concorrência; nenhuma rede externa ou pagamento real.`);
  } finally {
    liberarSincronizacao.resolve(); liberarReserva.resolve(); Date.now = agoraOriginal;
    await db.agendamento.deleteMany({ where: { clienteId: { in: clientes } } });
    await db.alteracaoPlanoAssinatura.deleteMany({ where: { assinaturaId: { in: assinaturas } } });
    await db.cobranca.deleteMany({ where: { assinaturaId: { in: assinaturas } } });
    await db.assinatura.deleteMany({ where: { id: { in: assinaturas } } });
    await db.barbeiro.deleteMany({ where: { id: { in: barbeiros } } });
    await db.plano.deleteMany({ where: { id: { in: planos } } });
    await db.servico.deleteMany({ where: { id: { in: servicos } } });
    await db.cliente.deleteMany({ where: { id: { in: clientes } } });
    await db.usuario.deleteMany({ where: { id: { in: usuarios } } });
    await base.$disconnect();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
