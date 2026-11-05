/** C3: fixtures próprias no banco local, gateway simulado e nenhuma chamada externa. */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || url.pathname !== "/barberos_cliente_teste_20261104") throw new Error("Use somente o banco local dedicado.");
process.env.AMBIENTE = "homologacao";
process.env.WHATSAPP_PROVIDER = "simulador";
process.env.PAGAMENTOS_PROVIDER = "simulado";
globalThis.fetch = async () => { throw new Error("Rede externa bloqueada no ensaio de adesão"); };
const telefone = () => `55119${randomInt(10_000_000, 100_000_000)}`;

async function main() {
  const { db } = await import("@/lib/db");
  const { assinar } = await import("@/lib/assinaturas/servico");
  const { excluirConta } = await import("@/lib/lgpd/titular");
  const { simulado } = await import("@/lib/pagamentos/simulado");
  const tag = `QA C3 adesão ${randomUUID().slice(0, 8)}`;
  const plano = await db.plano.create({ data: { nome: tag, precoCentavos: 10000, formasPagamento: ["CARTAO"], ativo: true, visivel: true, compravel: true } });
  const gatewayOriginal = simulado.criarCliente;
  const chamadas: Parameters<typeof simulado.criarCliente>[0][] = [];
  simulado.criarCliente = async p => { chamadas.push(p); return gatewayOriginal(p); };
  async function cliente() {
    const u = await db.usuario.create({ data: { nome: tag, telefone: telefone(), papel: "CLIENTE", telefoneVerificadoEm: new Date() } });
    const c = await db.cliente.create({ data: { nome: tag, telefone: u.telefone, cpf: "52998224725", email: "antes@example.invalid", usuarioId: u.id } });
    return { c, u };
  }
  async function esperar(chave: string, n: number) {
    const limite = Date.now() + 8_000;
    while (Date.now() < limite) {
      const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid::bigint = (hashtext(${chave})::bigint & 4294967295)`;
      if (Number(r[0].n) >= n) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("Fila de concorrência não observada");
  }
  async function disputar(chave: string, primeiro: () => Promise<unknown>, segundo: () => Promise<unknown>) {
    let liberar!: () => void, entrou!: () => void;
    const liberado = new Promise<void>(r => { liberar = r; }), iniciado = new Promise<void>(r => { entrou = r; });
    const bloqueador = db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))`; entrou(); await liberado;
    }, { timeout: 20_000 });
    await iniciado;
    const resultado = (p: Promise<unknown>) => p.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
    try {
      const a = resultado(primeiro()); await esperar(chave, 1);
      const b = resultado(segundo()); await esperar(chave, 2);
      liberar(); await bloqueador;
      return await Promise.all([a, b]);
    } finally { liberar(); await bloqueador; }
  }
  try {
    for (const app of [true, false]) {
      const { c, u } = await cliente();
      const chave = app ? `auth-usuario:${u.id}` : `cliente-ciclo:${c.id}`;
      const [excluiu, adesao] = await disputar(chave, () => excluirConta(c.id, u.id), () => assinar({
        clienteId: c.id, planoId: plano.id, forma: "CARTAO", cpf: c.cpf!, email: c.email!,
        origem: app ? "SITE" : "RECEPCAO", ...(app ? { usuarioId: u.id, titular: { usuarioId: u.id, sessaoVersao: 0 } } : {}),
      }));
      assert(excluiu.ok); assert(!adesao.ok && adesao.error.status === (app ? 401 : 404));
      const depois = await db.cliente.findUniqueOrThrow({ where: { id: c.id } });
      assert(depois.excluidoEm); assert.equal(depois.cpf, null); assert.equal(depois.email, null);
      assert.equal(await db.assinatura.count({ where: { clienteId: c.id } }), 0);
      assert.equal(chamadas.length, 0, "Nenhuma criação no gateway após exclusão");
    }

    const revogado = await cliente(), chave = `auth-usuario:${revogado.u.id}`;
    const [revogou, recusou] = await disputar(chave, () => db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))`;
      await tx.usuario.update({ where: { id: revogado.u.id }, data: { sessaoVersao: { increment: 1 } } });
    }), () => assinar({ clienteId: revogado.c.id, planoId: plano.id, forma: "CARTAO", origem: "SITE", titular: { usuarioId: revogado.u.id, sessaoVersao: 0 } }));
    assert(revogou.ok); assert(!recusou.ok && recusou.error.status === 401);
    assert.equal(chamadas.length, 0); assert.equal(await db.assinatura.count({ where: { clienteId: revogado.c.id } }), 0);

    const atualizado = await cliente(), chaveAtual = `cliente-ciclo:${atualizado.c.id}`;
    const [alterou, comprou] = await disputar(chaveAtual, () => db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chaveAtual}))`;
      await tx.cliente.update({ where: { id: atualizado.c.id }, data: { nome: `${tag} atual`, email: "atual@example.invalid" } });
    }), () => assinar({ clienteId: atualizado.c.id, planoId: plano.id, forma: "CARTAO", origem: "RECEPCAO" }));
    assert(alterou.ok); assert(comprou.ok);
    assert.equal(chamadas.length, 1); assert.equal(chamadas[0].email, "atual@example.invalid"); assert.equal(chamadas[0].nome, `${tag} atual`);
    assert.equal((await db.cliente.findUniqueOrThrow({ where: { id: atualizado.c.id } })).email, "atual@example.invalid");
    await assert.rejects(excluirConta(atualizado.c.id, atualizado.u.id), (e: unknown) => (e as { codigo: string }).codigo === "exclusao_bloqueada");
    const assinaturas = await db.assinatura.findMany({ where: { planoId: plano.id }, include: { cobrancas: true } });
    assert.equal(assinaturas.length, 1); assert.equal(assinaturas[0].status, "PENDENTE");
    assert.equal(assinaturas[0].cobrancas.length, 1); assert.equal(assinaturas[0].cobrancas[0].status, "PENDENTE");
    assert(assinaturas[0].gatewayId?.startsWith("simsub_"));
    console.log("C3 PG adesão: exclusão vence no app e recepção; sessão revogada recusa; dados atuais preservados; adesão pendente impede exclusão. Fixtures sintéticas e trilha preservadas.");
  } finally { simulado.criarCliente = gatewayOriginal; await db.$disconnect(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
