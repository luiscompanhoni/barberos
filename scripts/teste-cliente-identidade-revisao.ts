/** Regressões de identidade: apenas banco sintético dedicado, sem chamadas externas. */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || url.pathname !== "/barberos_cliente_teste_20261104") throw new Error("Use somente o banco local dedicado à revisão.");
process.env.AMBIENTE = "homologacao";
process.env.OTP_PROVIDER = "console";
process.env.WHATSAPP_PROVIDER = "simulador";
globalThis.fetch = async () => { throw new Error("Rede externa bloqueada no teste de identidade"); };
const telefoneFicticio = () => `55119${randomInt(10_000_000, 100_000_000)}`;

async function main() {
  const { db } = await import("@/lib/db");
  const { atualizarPerfilTitular, atualizarFotoTitular } = await import("@/lib/clientes/perfil-mutacao");
  const { editarCliente } = await import("@/lib/clientes/gestao");
  const { excluirConta } = await import("@/lib/lgpd/titular");
  const { solicitarCodigo, verificarCodigo } = await import("@/lib/auth/otp");
  const { recuperarSenhaCliente } = await import("@/lib/auth/recuperacao");
  const { gerarHash, conferirSenha } = await import("@/lib/auth/senha");
  const tag = `QA identidade ${randomUUID().slice(0, 8)}`;
  const foto = { dados: Buffer.from("FOTO_FICTICIA_QA"), tipo: "image/png" };
  async function criar() {
    const u = await db.usuario.create({ data: { nome: tag, telefone: telefoneFicticio(), papel: "CLIENTE", telefoneVerificadoEm: new Date() } });
    const c = await db.cliente.create({ data: { nome: tag, telefone: u.telefone, usuarioId: u.id,
      cpf: "52998224725", dataNascimento: new Date("2000-01-01") } });
    return { usuarioId: u.id, clienteId: c.id, sessaoVersao: 0, telefone: u.telefone };
  }
  async function esperarFila(chave: string, minimo: number) {
    const limite = Date.now() + 8_000;
    while (Date.now() < limite) {
      const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid::bigint = (hashtext(${chave})::bigint & 4294967295)`;
      if (Number(r[0].n) >= minimo) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Não observou concorrência real na trava de identidade");
  }
  try {
    const s = await criar();
    await Promise.all([
      atualizarPerfilTitular(s, { email: "qa@example.invalid" }),
      atualizarPerfilTitular(s, { endereco: "Rua Sintética, 123, Bairro de Teste" }),
    ]);
    const completo = await db.cliente.findUniqueOrThrow({ where: { id: s.clienteId } });
    assert.equal(completo.email, "qa@example.invalid"); assert.equal(completo.endereco, "Rua Sintética, 123, Bairro de Teste");
    assert(completo.perfilCompletoEm, "Completude precisa considerar os dois PATCHs concorrentes");
    const fotos = await Promise.all([atualizarFotoTitular(s, foto), atualizarFotoTitular(s, foto)]);
    assert.deepEqual(fotos.map((f) => f.fotoVersao).sort(), [1, 2]);

    // Segura a identidade, coloca exclusão primeiro na fila real do PostgreSQL,
    // depois simula três requests autenticados anteriormente aguardando o lock.
    let liberar!: () => void; let entrou!: () => void;
    const liberado = new Promise<void>((resolve) => { liberar = resolve; });
    const iniciou = new Promise<void>((resolve) => { entrou = resolve; });
    const chave = `auth-usuario:${s.usuarioId}`;
    const bloqueador = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))`;
      entrou(); await liberado;
    }, { timeout: 20_000 });
    await iniciou;
    const exclusao = excluirConta(s.clienteId, s.usuarioId);
    const conclusaoExclusao = exclusao.then(() => null, (e: unknown) => e);
    let tardias: PromiseSettledResult<unknown>[];
    try {
      await esperarFila(chave, 1);
      const aguardando = Promise.allSettled([
        atualizarPerfilTitular(s, { nome: "Não restaurar", cpf: "52998224725" }),
        atualizarFotoTitular(s, foto),
        editarCliente(s.clienteId, { nome: "Não restaurar via CRM" }, s.usuarioId),
      ]);
      await esperarFila(chave, 4);
      liberar(); await bloqueador;
      assert.equal(await conclusaoExclusao, null);
      tardias = await aguardando;
    } finally { liberar(); await bloqueador; }
    assert(tardias.every((r) => r.status === "rejected"), "Nenhuma escrita autenticada antiga pode sobreviver à exclusão");
    const apagado = await db.cliente.findUniqueOrThrow({ where: { id: s.clienteId } });
    assert(apagado.excluidoEm); assert.equal(apagado.cpf, null); assert.equal(apagado.fotoDados, null);
    assert.equal(apagado.usuarioId, null); assert.notEqual(apagado.nome, "Não restaurar");
    const contaApagada = await db.usuario.findUniqueOrThrow({ where: { id: s.usuarioId } });
    assert.equal(contaApagada.ativo, false); assert.equal(contaApagada.sessaoVersao, 1);

    const acesso = await criar();
    const senhaAnterior = await gerarHash("SenhaAnterior!927");
    await db.usuario.update({ where: { id: acesso.usuarioId }, data: { senhaHash: senhaAnterior } });
    await db.identidadeSocial.create({ data: { usuarioId: acesso.usuarioId, provedor: "google", subject: randomUUID() } });
    const a = (await solicitarCodigo(acesso.telefone, "cliente"))!;
    const b = (await solicitarCodigo(acesso.telefone, "cliente"))!;
    const codigos = await db.codigoLogin.findMany({ where: { telefone: acesso.telefone }, orderBy: { criadoEm: "desc" } });
    assert(codigos[1].usadoEm, "Reenvio precisa invalidar o código anterior");
    assert(codigos[0].criadoEm > codigos[1].criadoEm);
    const replay = await Promise.allSettled(Array.from({ length: 3 }, () => verificarCodigo(acesso.telefone, b, "cliente")));
    assert.equal(replay.filter((r) => r.status === "fulfilled").length, 1);
    await assert.rejects(verificarCodigo(acesso.telefone, a, "cliente"), /inválido/);
    const normal = await db.usuario.findUniqueOrThrow({ where: { id: acesso.usuarioId } });
    assert.equal(normal.senhaHash, senhaAnterior); assert.equal(normal.sessaoVersao, 0);
    assert.equal(await db.identidadeSocial.count({ where: { usuarioId: acesso.usuarioId } }), 1);

    const codigoAcesso = (await solicitarCodigo(acesso.telefone, "cliente"))!;
    await assert.rejects(recuperarSenhaCliente({ telefone: acesso.telefone, codigo: codigoAcesso, senha: "SenhaNova!927" }), /inválido/);
    const erroPersistido = await db.codigoLogin.findFirstOrThrow({ where: { telefone: acesso.telefone }, orderBy: { criadoEm: "desc" } });
    assert.equal(erroPersistido.tentativas, 1, "Tentativa errada deve permanecer gravada");
    const recuperar = (await solicitarCodigo(acesso.telefone, "cliente", "recuperacao"))!;
    await assert.rejects(verificarCodigo(acesso.telefone, recuperar, "cliente"), /inválido/);
    const atualizado = await recuperarSenhaCliente({ telefone: acesso.telefone, codigo: recuperar, senha: "SenhaNova!927" });
    assert.equal(atualizado.sessaoVersao, 1); assert(await conferirSenha("SenhaNova!927", atualizado.senhaHash!));
    assert(!(await conferirSenha("SenhaAnterior!927", atualizado.senhaHash!)));
    assert.equal(await db.identidadeSocial.count({ where: { usuarioId: acesso.usuarioId } }), 1);
    await assert.rejects(atualizarPerfilTitular(acesso, { nome: "Sessão antiga" }), /sessão mudou/);
    await atualizarPerfilTitular({ ...acesso, sessaoVersao: atualizado.sessaoVersao }, { nome: "Sessão nova válida" });
    await assert.rejects(recuperarSenhaCliente({ telefone: acesso.telefone, codigo: recuperar, senha: "OutraSenha!927" }), /inválido/);
    assert.equal(await db.auditoria.count({ where: { entidadeId: acesso.usuarioId, acao: "cliente_recuperar_senha" } }), 1);
    console.log("PASS: exclusão/perfil/foto/CRM concorrentes; PATCHs e versões de foto; OTP único e último; propósito, recuperação, revogação e auditoria. Fixtures próprias preservadas.");
  } finally { await db.$disconnect(); }
}
main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
