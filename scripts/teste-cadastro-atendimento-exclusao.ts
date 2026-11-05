/** Só fixtures próprias no PostgreSQL sintético local. Nenhum provedor ou HTTP. */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || url.pathname !== "/barberos_cliente_teste_20261104") throw Error("Somente o banco sintético local autorizado.");
globalThis.fetch = async () => { throw Error("HTTP bloqueado no ensaio de exclusão do cadastro."); };
const tag = `testcadastro-exclusao-${randomUUID()}`;
const base = new PrismaClient({ datasourceUrl: url.toString(), transactionOptions: { timeout: 15000 } });
const anonimizou = Promise.withResolvers<void>(), liberar = Promise.withResolvers<void>();
let clienteId = "", usuarioId = "", telefone = "", pausou = false, checks = 0;
const db = base.$extends({ query: { cliente: { async update({ args, query }) {
  const r = await query(args);
  if (args.where.id === clienteId && args.data.excluidoEm && !pausou) {
    pausou = true; anonimizou.resolve(); await liberar.promise;
  }
  return r;
} } } });
(globalThis as unknown as { prisma: PrismaClient }).prisma = db as unknown as PrismaClient;
function ok(condicao: unknown, texto: string) { assert.ok(condicao, texto); checks++; console.log(`OK ${texto}`); }
async function esperar<T>(promessa: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  const limite = new Promise<never>((_, rejeitar) => { timer = setTimeout(() => rejeitar(Error("Barreira não alcançada.")), 8000); });
  try { return await Promise.race([promessa, limite]); } finally { clearTimeout(timer!); }
}
async function main() {
  const { excluirConta } = await import("@/lib/lgpd/titular");
  const { atualizarCadastroAtendimento } = await import("@/lib/clientes/cadastro-atendimento");
  let exclusao: Promise<void> | undefined;
  let alteracao: Promise<unknown> | undefined;
  try {
    do { telefone = `55119${randomInt(10_000_000, 100_000_000)}`; }
    while (await db.usuario.findUnique({ where: { telefone } }) || await db.cliente.findUnique({ where: { telefone } }));
    const u = await db.usuario.create({ data: { nome: tag, telefone, papel: "CLIENTE", telefoneVerificadoEm: new Date(),
      cliente: { create: { nome: tag, telefone, observacoes: "Preferência sintética", origemDetalhe: "Indicação de teste", dataNascimento: new Date("1990-01-10") } } }, include: { cliente: true } });
    usuarioId = u.id; clienteId = u.cliente!.id;
    exclusao = excluirConta(clienteId, usuarioId, 0);
    void exclusao.catch(() => {}); // O await abaixo reporta falhas; não deixar rejeição solta na barreira.
    // A exclusão real já anonimizou a linha, mas ainda não liberou sua transação.
    await esperar(anonimizou.promise);
    alteracao = atualizarCadastroAtendimento(clienteId, { dataNascimento: new Date("1991-02-03"),
      origem: "INDICACAO", origemDetalhe: "Não pode reaparecer", observacoes: "Não pode reaparecer" }, "equipe-sintetica")
      .then(() => null, (erro: unknown) => erro);
    let aguardou = false;
    const prazo = performance.now() + 5000;
    while (performance.now() < prazo) {
      const chave = `cliente-ciclo:${clienteId}`;
      const [fila] = await base.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted AND objid::bigint = (hashtext(${chave})::bigint & 4294967295)`;
      if (Number(fila.n) > 0) { aguardou = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    liberar.resolve(); await exclusao;
    const erro = await alteracao;
    ok(aguardou, "edição legada aguardou a mesma trava da exclusão real");
    ok(erro instanceof Error && "status" in erro && erro.status === 404, "edição em voo foi recusada após a exclusão concluir");
    const apagado = await db.cliente.findUniqueOrThrow({ where: { id: clienteId } });
    ok(Boolean(apagado.excluidoEm) && apagado.usuarioId === null && apagado.dataNascimento === null &&
      apagado.origemDetalhe === null && apagado.observacoes === null, "nenhum dado pessoal foi reintroduzido na conta apagada");
    await assert.rejects(atualizarCadastroAtendimento(clienteId, { observacoes: "Nova tentativa" }, "equipe-sintetica"),
      (e: unknown) => !!e && typeof e === "object" && "status" in e && e.status === 404);
    ok((await db.cliente.findUniqueOrThrow({ where: { id: clienteId } })).observacoes === null, "tentativa iniciada após a exclusão também preserva anonimização");
    ok(await db.auditoria.count({ where: { entidadeId: clienteId, acao: "alterar" } }) === 0, "edições recusadas não registram sucesso ou dados pessoais na auditoria");
    ok(await db.auditoria.count({ where: { entidadeId: clienteId, acao: "lgpd_exclusao" } }) === 1, "exclusão concluída uma vez com trilha própria");
    console.log(`PASS ${checks} verificações; sem HTTP, mensagens, pagamentos ou alteração de configuração.`);
  } finally {
    liberar.resolve();
    await Promise.allSettled([exclusao, alteracao].filter(Boolean));
    if (clienteId) await db.cliente.deleteMany({ where: { id: clienteId } });
    if (usuarioId) await db.usuario.deleteMany({ where: { id: usuarioId } });
    await base.$disconnect();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
