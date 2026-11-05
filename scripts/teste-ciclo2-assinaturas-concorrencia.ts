/** Corridas financeiras determinísticas, somente fixtures no PostgreSQL sintético. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { Sessao } from "@/lib/auth/sessao";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || url.pathname !== "/barberos_cliente_teste_20261104") throw Error("Use somente o banco sintético local autorizado.");
process.env.AMBIENTE = "teste";
process.env.PAGAMENTOS_PROVIDER = "simulado";
process.env.WHATSAPP_PROVIDER = "simulador";
globalThis.fetch = async () => { throw Error("Rede bloqueada no ensaio financeiro."); };
const tag = `testeciclo2-${randomUUID()}`;
url.searchParams.set("application_name", tag);
const base = new PrismaClient({ datasourceUrl: url.toString(), transactionOptions: { timeout: 15000 } });
const barreiras: ReturnType<typeof barreira>[] = [];
function barreira(id: string) {
  const pronta = Promise.withResolvers<void>(), liberar = Promise.withResolvers<void>();
  return { id, pronta, liberar, usada: false };
}
function novaBarreira(id: string) { const b = barreira(id); barreiras.push(b); return b; }
type Barreira = ReturnType<typeof barreira>;
let vencida: Barreira | undefined, reserva: Barreira | undefined, conversao: Barreira | undefined;
async function pausar(b: Barreira) {
  if (b.usada) return;
  b.usada = true; b.pronta.resolve(); await b.liberar.promise;
}
const db = base.$extends({ query: {
  cobranca: { async findMany({ args, query }) {
    if (vencida && args.where?.status === "PENDENTE" && args.where.vencimento) {
      // A rotina exercita sua consulta real, limitada à fixture deste ensaio.
      const r = await query({ ...args, where: { ...args.where, id: vencida.id } });
      await pausar(vencida); return r;
    }
    return query(args);
  } },
  agendamento: {
    async create({ args, query }) {
      if (reserva && args.data.clienteId === reserva.id) await pausar(reserva);
      return query(args);
    },
    async update({ args, query }) {
      if (conversao && args.where.id === conversao.id && args.data.assinaturaId && args.data.precoCentavos === 0) await pausar(conversao);
      return query(args);
    },
  },
} });
(globalThis as unknown as { prisma: PrismaClient }).prisma = db as unknown as PrismaClient;
const clientes: string[] = [], usuarios: string[] = [], planos: string[] = [], barbeiros: string[] = [], servicos: string[] = [], assinaturas: string[] = [];
let checks = 0;
function ok(c: unknown, texto: string) { assert.ok(c, texto); checks++; console.log(`OK ${texto}`); }
async function esperar<T>(p: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Barreira excedeu 5s")), 5000); })]); }
  finally { clearTimeout(timer!); }
}
async function esperaTrava() {
  const inicio = performance.now();
  while (performance.now() - inicio < 2500) {
    const r = await base.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE application_name = ${tag} AND wait_event = 'advisory'`;
    if (r[0].n > BigInt(0)) return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return false;
}
const capturar = <T>(p: Promise<T>) => p.then(valor => ({ valor, erro: null }), erro => ({ valor: null, erro }));

async function main() {
  const { sincronizarCobranca } = await import("@/lib/assinaturas/cobrancas");
  const { marcarVencidas } = await import("@/lib/assinaturas/rotina");
  const { cancelar } = await import("@/lib/assinaturas/servico");
  const { aplicarPlanoAosFuturos } = await import("@/lib/assinaturas/agenda");
  const { solicitarAlteracaoPlano, aplicarAlteracaoPlano } = await import("@/lib/assinaturas/alteracao-plano");
  const { criarAgendamento } = await import("@/lib/agenda/agendamentos");
  const { instanteLocal } = await import("@/lib/agenda/tempo");
  const original = Date.now;
  try {
    Date.now = () => +new Date("2031-01-20T12:00:00Z");
    const equipe = await db.usuario.create({ data: { nome: tag, telefone: `${tag}-equipe`, papel: "RECEPCAO" } }); usuarios.push(equipe.id);
    const ator: Sessao = { usuarioId: equipe.id, nome: tag, papel: "RECEPCAO", clienteId: null, barbeiroId: null };
    const cfg = await db.configuracao.findUniqueOrThrow({ where: { id: 1 } });
    async function fixture(limite: number | null = null) {
      const n = clientes.length;
      const cliente = await db.cliente.create({ data: { nome: tag, telefone: `${tag}-${n}` } }); clientes.push(cliente.id);
      const servico = await db.servico.create({ data: { nome: `${tag}-${n}`, duracaoMin: 30, precoCentavos: 5000 } }); servicos.push(servico.id);
      const plano = await db.plano.create({ data: { nome: `${tag}-${n}`, precoCentavos: 10000, maxAgendamentosAbertos: 10,
        servicos: { create: { servicoId: servico.id, usosPorCiclo: limite } } } }); planos.push(plano.id);
      const b = await db.barbeiro.create({ data: { nome: `${tag}-${n}`, usuario: { create: { nome: tag, telefone: `${tag}-prof-${n}`, papel: "BARBEIRO" } },
        servicos: { create: { servicoId: servico.id } }, expediente: { create: Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, inicioMin: 480, fimMin: 1200 })) } } });
      barbeiros.push(b.id); usuarios.push(b.usuarioId);
      const a = await db.assinatura.create({ data: { clienteId: cliente.id, planoId: plano.id, status: "ATIVA", precoCentavos: 10000,
        origem: "SITE", formaPagamento: "PIX", gatewayId: `pixrec_${tag}-${n}`, ativadaEm: new Date("2031-01-01"),
        cicloInicio: new Date("2031-01-01"), proximoVencimento: new Date("2031-02-01") } }); assinaturas.push(a.id);
      const entrada = (min = 600) => ({ barbeiroId: b.id, servicoId: servico.id, cliente: { id: cliente.id }, origem: "RECEPCAO" as const,
        inicio: new Date(instanteLocal("2031-02-02", min, cfg.fuso)) });
      const avulso = () => db.agendamento.create({ data: { barbeiroId: b.id, clienteId: cliente.id, servicoId: servico.id, origem: "RECEPCAO", precoCentavos: 5000,
        inicio: entrada().inicio, fim: new Date(+entrada().inicio + 30 * 60000) } });
      return { cliente, servico, plano, b, a, entrada, avulso };
    }

    const f1 = await fixture();
    const c = await db.cobranca.create({ data: { assinaturaId: f1.a.id, gatewayId: `simchg_${tag}`, valorCentavos: 10000,
      vencimento: new Date("2031-01-01"), status: "PENDENTE" } });
    vencida = novaBarreira(c.id);
    const marcar = marcarVencidas();
    await esperar(vencida.pronta.promise);
    const pagaEm = new Date("2031-01-20T12:00:00Z");
    await sincronizarCobranca({ id: c.gatewayId, assinaturaGatewayId: f1.a.gatewayId, valorCentavos: 10000,
      vencimento: "2031-01-01", status: "PAGA", pagaEm: pagaEm.toISOString(), link: null });
    vencida.liberar.resolve();
    ok(await marcar === 0, "vencimento local descarta a leitura antiga depois do pagamento");
    const paga = await db.cobranca.findUniqueOrThrow({ where: { id: c.id } });
    ok(paga.status === "PAGA" && paga.pagaEm?.getTime() === +pagaEm && paga.valorCentavos === 10000, "pagamento conserva estado, valor e data");
    ok((await db.assinatura.findUniqueOrThrow({ where: { id: f1.a.id } })).status === "ATIVA", "rotina atrasada não bloqueia plano pago");
    ok(await marcarVencidas() === 0, "repetição da rotina não altera cobrança paga");
    vencida = undefined;

    const f2 = await fixture();
    reserva = novaBarreira(f2.cliente.id);
    const reservar = criarAgendamento(f2.entrada(), ator);
    await esperar(reserva.pronta.promise);
    const encerramento = capturar(cancelar(f2.a.id, "Ensaio sintético", equipe.id, { avisar: false, semGateway: true }));
    const esperouCancelar = await esperaTrava();
    reserva.liberar.resolve();
    const ag = await reservar;
    const encerrada = await encerramento;
    ok(esperouCancelar && !encerrada.erro, "cancelamento ativo espera reserva em voo concluir");
    const convertido = await db.agendamento.findUniqueOrThrow({ where: { id: ag.id } });
    ok(convertido.assinaturaId === null && convertido.precoCentavos === 5000, "reserva recém-criada vira avulsa no cancelamento");
    ok((await db.assinatura.findUniqueOrThrow({ where: { id: f2.a.id } })).status === "CANCELADA", "cancelamento mantém estado final encerrado");
    const posterior = await criarAgendamento(f2.entrada(660), ator);
    ok(posterior.assinaturaId === null && posterior.precoCentavos === 5000, "reserva posterior ao encerramento não ganha cobertura");
    reserva = undefined;

    const f3 = await fixture(1);
    const antigo = await f3.avulso();
    conversao = novaBarreira(antigo.id);
    const converter = aplicarPlanoAosFuturos(f3.cliente.id, cfg.fuso);
    await esperar(conversao.pronta.promise);
    const novoUso = capturar(criarAgendamento(f3.entrada(660), ator));
    const esperouUso = await esperaTrava();
    conversao.liberar.resolve();
    ok(await converter === 1, "ativação converte o avulso elegível uma única vez");
    const uso = await novoUso;
    ok(esperouUso && uso.erro instanceof Error && /usou/.test(uso.erro.message), "nova reserva espera a conversão e respeita o uso por ciclo");
    ok(await db.agendamento.count({ where: { assinaturaId: f3.a.id } }) === 1, "concorrência não duplica benefício limitado");
    ok(await aplicarPlanoAosFuturos(f3.cliente.id, cfg.fuso) === 0, "repetir conversão é idempotente");
    conversao = undefined;

    const f4 = await fixture();
    const destino = await db.plano.create({ data: { nome: `${tag}-destino`, precoCentavos: 7000 } }); planos.push(destino.id);
    await solicitarAlteracaoPlano({ assinaturaId: f4.a.id, planoId: destino.id, origem: "SITE", usuarioId: equipe.id });
    Date.now = () => +new Date("2031-02-01T12:00:00Z");
    const livre = await f4.avulso();
    conversao = novaBarreira(livre.id);
    const converterAntes = aplicarPlanoAosFuturos(f4.cliente.id, cfg.fuso);
    await esperar(conversao.pronta.promise);
    const trocar = capturar(aplicarAlteracaoPlano(f4.a.id, equipe.id));
    const esperouTroca = await esperaTrava();
    conversao.liberar.resolve();
    ok(await converterAntes === 1, "conversão em voo termina usando as condições anteriores");
    const troca = await trocar;
    ok(esperouTroca && troca.erro instanceof Error && /horários futuros/.test(troca.erro.message), "troca espera conversão e recusa futuro incompatível");
    ok((await db.assinatura.findUniqueOrThrow({ where: { id: f4.a.id } })).planoId === f4.plano.id, "plano anterior permanece quando há futuro convertido");
    await db.agendamento.update({ where: { id: livre.id }, data: { assinaturaId: null, precoCentavos: 5000 } });
    ok((await aplicarAlteracaoPlano(f4.a.id, equipe.id)).aplicada, "troca sem benefício futuro pendente pode concluir");
    ok(await aplicarPlanoAosFuturos(f4.cliente.id, cfg.fuso) === 0, "conversão posterior lê os benefícios do plano novo");
    ok((await db.agendamento.findUniqueOrThrow({ where: { id: livre.id } })).precoCentavos === 5000, "serviço fora do novo plano conserva preço avulso");
    ok(await db.emissaoPixMensal.count({ where: { assinaturaId: { in: assinaturas } } }) === 0, "nenhuma cobrança ou Pix emitido no ensaio");
    console.log(`OK ${checks} verificações de concorrência; nenhuma rede externa ou pagamento real.`);
  } finally {
    for (const b of barreiras) b.liberar.resolve();
    Date.now = original;
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
