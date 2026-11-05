/** Recuperação versus exclusão: somente fixtures próprias e PostgreSQL sintético local. */
import assert from "node:assert/strict";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || url.pathname !== "/barberos_cliente_teste_20261104") throw Error("Use apenas o banco sintético local autorizado.");
process.env.AMBIENTE = "homologacao";
process.env.SESSION_SECRET = "teste-exclusao-revogacao-local-sem-credenciais-reais";
globalThis.fetch = async () => { throw Error("Rede externa bloqueada no ensaio de exclusão."); };
const tag = `testexclusao-${randomUUID()}`;
url.searchParams.set("application_name", tag);
const base = new PrismaClient({ datasourceUrl: url.toString(), transactionOptions: { timeout: 15000 } });
const revogacaoPronta = Promise.withResolvers<void>(), liberarRecuperacao = Promise.withResolvers<void>();
let usuarioId = "", clienteId = "", telefone = "", pausou = false, checks = 0;
const db = base.$extends({ query: { usuario: { async update({ args, query }) {
  const resultado = await query(args);
  if (args.where.id === usuarioId && args.data.senhaHash && args.data.sessaoVersao && !pausou) {
    pausou = true; revogacaoPronta.resolve(); await liberarRecuperacao.promise;
  }
  return resultado;
} } } });
(globalThis as unknown as { prisma: PrismaClient }).prisma = db as unknown as PrismaClient;
function ok(c: unknown, mensagem: string) { assert.ok(c, mensagem); checks++; console.log(`OK ${mensagem}`); }
async function esperar<T>(p: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  const limite = new Promise<never>((_, rejeitar) => { timer = setTimeout(() => rejeitar(Error("Barreira excedeu o prazo")), 8000); });
  try { return await Promise.race([p, limite]); } finally { clearTimeout(timer!); }
}

async function main() {
  const { recuperarSenhaCliente } = await import("@/lib/auth/recuperacao");
  const { excluirConta } = await import("@/lib/lgpd/titular");
  const { conferirSenha, gerarHash } = await import("@/lib/auth/senha");
  try {
    do { telefone = `55119${randomInt(10_000_000, 100_000_000)}`; }
    while (await db.usuario.findUnique({ where: { telefone } }) || await db.cliente.findUnique({ where: { telefone } }));
    const u = await db.usuario.create({ data: { nome: tag, telefone, papel: "CLIENTE", telefoneVerificadoEm: new Date(), senhaHash: await gerarHash("Anterior!927"),
      cliente: { create: { nome: tag, telefone, cpf: "52998224725", email: "qa@example.test", observacoes: "Preferência sintética" } },
      identidadesSociais: { create: { provedor: "google", subject: tag } },
    }, include: { cliente: true } });
    usuarioId = u.id; clienteId = u.cliente!.id;
    const codigo = "123456";
    await db.codigoLogin.create({ data: { telefone, codigoHash: createHmac("sha256", process.env.SESSION_SECRET!).update(`recuperacao:${telefone}:${codigo}`).digest("hex"), expiraEm: new Date(Date.now() + 300000) } });
    const recuperacao = recuperarSenhaCliente({ telefone, codigo, senha: "Recuperada!927" });
    await esperar(revogacaoPronta.promise);
    // A sessão 0 foi autenticada antes da recuperação, mas espera o auth-lock para excluir.
    const antiga = excluirConta(clienteId, usuarioId, 0).then(() => null, (e: unknown) => e);
    let esperou = false;
    const inicio = performance.now();
    while (performance.now() - inicio < 5000) {
      const r = await base.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE application_name = ${tag} AND wait_event = 'advisory'`;
      if (Number(r[0].n) > 0) { esperou = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    liberarRecuperacao.resolve();
    const atual = await recuperacao;
    const erro = await antiga;
    ok(esperou, "exclusão antiga aguardou a recuperação real sob trava de identidade");
    ok(atual.sessaoVersao === 1 && await conferirSenha("Recuperada!927", atual.senhaHash), "recuperação concluiu e revogou a sessão anterior");
    ok(erro instanceof Error && "codigo" in erro && erro.codigo === "sessao_invalida", "exclusão da sessão revogada foi recusada após obter a trava");
    const preservado = await db.cliente.findUniqueOrThrow({ where: { id: clienteId } });
    ok(!preservado.excluidoEm && preservado.cpf === "52998224725" && preservado.nome === tag && preservado.observacoes === "Preferência sintética", "requisição antiga não apagou nem anonimizou dados");
    ok(await db.identidadeSocial.count({ where: { usuarioId } }) === 1 && await db.auditoria.count({ where: { entidadeId: clienteId, acao: "lgpd_exclusao" } }) === 0, "identidade e auditoria não registram exclusão recusada");
    await excluirConta(clienteId, usuarioId, atual.sessaoVersao);
    const excluido = await db.cliente.findUniqueOrThrow({ where: { id: clienteId } });
    ok(Boolean(excluido.excluidoEm) && excluido.cpf === null && excluido.usuarioId === null, "sessão atual pode excluir e anonimizar normalmente");
    ok(!(await db.usuario.findUniqueOrThrow({ where: { id: usuarioId } })).ativo && await db.identidadeSocial.count({ where: { usuarioId } }) === 0, "exclusão válida revoga login e vínculos sociais");
    ok(await db.auditoria.count({ where: { entidadeId: clienteId, acao: "lgpd_exclusao" } }) === 1, "exclusão válida gera somente uma auditoria");
    console.log(`PASS ${checks} verificações, nenhum pagamento ou serviço externo.`);
  } finally {
    liberarRecuperacao.resolve();
    if (telefone) await db.codigoLogin.deleteMany({ where: { telefone } });
    if (usuarioId) await db.identidadeSocial.deleteMany({ where: { usuarioId } });
    if (clienteId) await db.cliente.deleteMany({ where: { id: clienteId } });
    if (usuarioId) await db.usuario.deleteMany({ where: { id: usuarioId } });
    await base.$disconnect();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
