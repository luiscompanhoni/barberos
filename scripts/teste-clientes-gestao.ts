/** CRM com PostgreSQL local dedicado. Fixtures próprias, rede bloqueada e auditoria preservada. */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || url.pathname !== "/barberos_cliente_teste_20261104") throw new Error("Use somente o banco local dedicado à revisão de clientes.");
process.env.AMBIENTE = "homologacao";
process.env.PAGAMENTOS_PROVIDER = "simulado";
process.env.WHATSAPP_PROVIDER = "simulador";
globalThis.fetch = async () => { throw new Error("Rede externa bloqueada no teste de CRM"); };

const telefoneFicticio = () => `55119${randomInt(10_000_000, 100_000_000)}`;
const camposPrivados = new Set(["cpf", "usuarioId", "usuario", "senha", "senhaHash", "foto", "fotoDados", "fotoTipo", "tokenPublico"]);
function conferirDto(valor: unknown, cpf: string, foto: string, senha: string) {
  function visitar(v: unknown) {
    if (!v || typeof v !== "object" || v instanceof Date) return;
    for (const [chave, conteudo] of Object.entries(v)) {
      assert(!camposPrivados.has(chave), `DTO expõe campo privado: ${chave}`);
      visitar(conteudo);
    }
  }
  visitar(valor);
  const texto = JSON.stringify(valor);
  assert(!texto.includes(cpf), "CPF completo apareceu no DTO");
  assert(!texto.includes(foto), "Foto apareceu no DTO");
  assert(!texto.includes(senha), "Hash de senha apareceu no DTO");
}

async function main() {
  const { db } = await import("@/lib/db");
  const { cadastrarCliente, editarCliente, detalharCliente, listarClientes } = await import("@/lib/clientes/gestao");
  const { zClienteGestao, zEditarClienteGestao, zConsultaClientes } = await import("@/lib/clientes/gestao-regras");
  const tag = `QA CRM ${randomUUID().slice(0, 8)}`;
  const cpf = "52998224725";
  const foto = "FOTO_SINTETICA_PRIVADA_CRM";
  const senha = `hash-sintetico-sem-acesso-${randomUUID()}`;
  const ids: string[] = [];
  try {
    const ator = await db.usuario.create({ data: { nome: `${tag} Equipe`, telefone: telefoneFicticio(), papel: "RECEPCAO" } });
    const telefone = telefoneFicticio();
    const dados = zClienteGestao.parse({ nome: `${tag} Concorrência`, telefone, cpf, dataNascimento: "2000-01-02", observacoes: "Observação sintética reservada" });
    const cadastros = await Promise.allSettled(Array.from({ length: 5 }, () => cadastrarCliente(dados, ator.id)));
    const aprovados = cadastros.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof cadastrarCliente>>> => r.status === "fulfilled");
    assert.equal(aprovados.length, 1, "Telefone concorrente precisa produzir exatamente um cadastro");
    const rejeitados = cadastros.filter(r => r.status === "rejected");
    assert.equal(rejeitados.length, 4);
    for (const r of rejeitados) assert.equal(r.reason.codigo, "cliente_duplicado");
    assert.equal(await db.cliente.count({ where: { telefone } }), 1);
    const id = aprovados[0].value.id;
    conferirDto(aprovados[0].value, cpf, foto, senha);
    ids.push(id);
    assert.equal((await db.cliente.findUniqueOrThrow({ where: { id } })).aceitaMensagens, false);
    assert.equal(await db.auditoria.count({ where: { entidade: "cliente", entidadeId: id, acao: "cadastrar" } }), 1);

    // Cada PATCH completa uma parte diferente; a segunda transação deve enxergar a primeira.
    const novoEmail = `qa-${randomUUID()}@example.invalid`;
    const novoEndereco = "Rua de Teste, 123, Bairro Sintético";
    await Promise.all([
      editarCliente(id, zEditarClienteGestao.parse({ email: novoEmail }), ator.id),
      editarCliente(id, zEditarClienteGestao.parse({ endereco: novoEndereco }), ator.id),
    ]);
    const atualizado = await db.cliente.findUniqueOrThrow({ where: { id } });
    assert.equal(atualizado.email, novoEmail);
    assert.equal(atualizado.endereco, novoEndereco);
    assert.equal(atualizado.nome, dados.nome);
    assert.equal(atualizado.telefone, telefone);
    assert(atualizado.perfilCompletoEm, "Completude deve considerar as duas alterações concorrentes");
    assert.equal(await db.auditoria.count({ where: { entidade: "cliente", entidadeId: id, acao: "alterar_cadastro" } }), 2);

    const conta = await db.usuario.create({ data: { nome: dados.nome, telefone, papel: "CLIENTE", senhaHash: senha } });
    await db.cliente.update({ where: { id }, data: { usuarioId: conta.id, fotoDados: Buffer.from(foto), fotoTipo: "image/png", fotoVersao: 1 } });
    const detalhe = await detalharCliente(id);
    conferirDto(detalhe, cpf, foto, senha);
    assert.equal(detalhe.cliente.temAcesso, true);
    assert.equal(detalhe.cliente.cpfMascarado, "***.***.247-**");
    assert.equal(detalhe.cliente.fotoVersao, 1, "DTO pode informar versão, sem carregar bytes da foto");
    const lista = await listarClientes(zConsultaClientes.parse({ busca: dados.nome }));
    assert.equal(lista.total, 1);
    assert.equal(lista.clientes[0].id, id);
    conferirDto(lista, cpf, foto, senha);
    const totalAuditAntes = await db.auditoria.count({ where: { entidade: "cliente", entidadeId: id } });
    await assert.rejects(() => editarCliente(id, { telefone: telefoneFicticio() }, ator.id), e => (e as { codigo?: string }).codigo === "telefone_com_acesso");
    assert.equal((await db.cliente.findUniqueOrThrow({ where: { id } })).telefone, telefone);
    assert.equal((await db.usuario.findUniqueOrThrow({ where: { id: conta.id } })).telefone, telefone);
    assert.equal(await db.auditoria.count({ where: { entidade: "cliente", entidadeId: id } }), totalAuditAntes);
    const corrigido = await editarCliente(id, { nome: `${tag} Nome Corrigido` }, ator.id);
    assert.equal((await db.usuario.findUniqueOrThrow({ where: { id: conta.id } })).nome, corrigido.nome);
    conferirDto(corrigido, cpf, foto, senha);

    const registros = await db.auditoria.findMany({ where: { entidade: "cliente", entidadeId: id }, orderBy: { criadoEm: "asc" } });
    for (const registro of registros) {
      assert.equal(registro.usuarioId, ator.id);
      assert(["cadastrar", "alterar_cadastro"].includes(registro.acao));
      const payload = registro.dados as { origem: string; campos: string[] };
      assert.deepEqual(Object.keys(payload).sort(), ["campos", "origem"]);
      assert.equal(payload.origem, "gestao");
      assert(Array.isArray(payload.campos) && payload.campos.length > 0);
      for (const campo of payload.campos) assert(["nome", "telefone", "cpf", "dataNascimento", "observacoes", "email", "endereco"].includes(campo));
      const texto = JSON.stringify(payload);
      for (const privado of [cpf, telefone, dados.nome, dados.observacoes!, novoEmail, novoEndereco, senha, foto]) assert(!texto.includes(privado), "Auditoria guardou valor pessoal em vez de nomes dos campos");
    }

    const excluido = await cadastrarCliente(zClienteGestao.parse({ nome: `${tag} Excluído`, telefone: telefoneFicticio() }), ator.id);
    ids.push(excluido.id);
    await db.cliente.update({ where: { id: excluido.id }, data: { excluidoEm: new Date() } });
    const listaExcluido = await listarClientes(zConsultaClientes.parse({ busca: excluido.nome }));
    assert.equal(listaExcluido.total, 0);
    assert.deepEqual(listaExcluido.clientes, []);
    await assert.rejects(() => detalharCliente(excluido.id), e => (e as { status?: number }).status === 404);
    await assert.rejects(() => editarCliente(excluido.id, { nome: `${tag} Reativado indevidamente` }, ator.id), e => (e as { status?: number }).status === 404);
    assert.equal((await db.cliente.findUniqueOrThrow({ where: { id: excluido.id } })).nome, excluido.nome);
    assert.equal(await db.auditoria.count({ where: { entidade: "cliente", entidadeId: excluido.id } }), 1);
    console.log("OK CRM PG: 5 cadastros concorrentes/1 sucesso, PATCHs parciais preservados, completude serializada, auditoria sem valores pessoais, DTO sem CPF/foto/senha, telefone de login protegido e excluído invisível.");
    console.log(JSON.stringify({ clientesSinteticosCriados: ids, auditoriaPreservada: true, chamadasExternas: 0 }));
  } finally { await db.$disconnect(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
