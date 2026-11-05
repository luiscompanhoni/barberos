/** Ensaio de autenticação exclusivamente no banco sintético local; nunca envia OTP. */
import assert from "node:assert/strict";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { criarContaCliente, entrarComSenha, trocarPropriaSenha } from "@/lib/auth/acesso";
import { verificarCodigo } from "@/lib/auth/otp";
import { conferirSenha, gerarHash } from "@/lib/auth/senha";
import { assinarToken, lerToken } from "@/lib/auth/token";

const url = new URL(process.env.DATABASE_URL ?? "http://invalido");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || url.pathname !== "/barberos_cliente_teste_20261104") throw Error("Use somente o banco sintético local autorizado.");
process.env.SESSION_SECRET = "ensaio-local-cadastro-prova-telefone-sem-provedor-20261104";
globalThis.fetch = async () => { throw Error("Rede bloqueada no ensaio de cadastro."); };
const tag = `testcadastro-${randomUUID()}`;
const telefones: string[] = [], usuarios: string[] = [], clientes: string[] = [];
const codigo = "123456", senhaAnterior = "Anterior-teste!V9", senhaTitular = "Titular-teste!P7";
let checks = 0, senhaHash = "";
function ok(c: unknown, mensagem: string) { assert.ok(c, mensagem); checks++; console.log(`OK ${mensagem}`); }
async function recusar(p: Promise<unknown>, mensagem: string) { await assert.rejects(p); checks++; console.log(`OK ${mensagem}`); }

async function telefoneNovo() {
  for (;;) {
    const tel = `55479${randomInt(10_000_000, 100_000_000)}`;
    if (telefones.includes(tel) || await db.usuario.findUnique({ where: { telefone: tel } }) || await db.cliente.findUnique({ where: { telefone: tel } })) continue;
    telefones.push(tel); return tel;
  }
}
async function inserirCodigo(telefone: string) {
  return db.codigoLogin.create({ data: { telefone,
    codigoHash: createHmac("sha256", process.env.SESSION_SECRET!).update(`${telefone}:${codigo}`).digest("hex"),
    expiraEm: new Date(Date.now() + 300_000),
  } });
}
async function clienteLegado(verificado = false, versao = 0) {
  const telefone = await telefoneNovo();
  const u = await db.usuario.create({ data: { nome: tag, telefone, papel: "CLIENTE", senhaHash, sessaoVersao: versao,
    telefoneVerificadoEm: verificado ? new Date() : null,
    cliente: { create: { telefone, nome: tag } },
    identidadesSociais: { create: { provedor: "google", subject: `${tag}-${randomUUID()}` } },
  }, include: { cliente: true } });
  usuarios.push(u.id); clientes.push(u.cliente!.id); return u;
}

async function main() {
  senhaHash = await gerarHash(senhaAnterior);
  const telefoneSemCadastro = await telefoneNovo();
  await inserirCodigo(telefoneSemCadastro);
  await assert.rejects(verificarCodigo(telefoneSemCadastro, codigo, "cliente"), e => (e as { codigo?: string }).codigo === "cadastro_necessario");
  checks++; console.log("OK login OTP de número desconhecido exige cadastro completo");
  ok(await db.usuario.count({ where: { telefone: telefoneSemCadastro } }) === 0 && await db.cliente.count({ where: { telefone: telefoneSemCadastro } }) === 0,
    "login recusado não deixa usuário ou ficha incompleta");
  await recusar(verificarCodigo(telefoneSemCadastro, codigo, "cliente"), "prova consumida na orientação de cadastro não pode ser reutilizada");
  const telefoneImportado = await telefoneNovo();
  const importado = await db.cliente.create({ data: { nome: tag, telefone: telefoneImportado, observacoes: "Ficha importada sem dados complementares" } }); clientes.push(importado.id);
  await inserirCodigo(telefoneImportado);
  const acessoImportado = await verificarCodigo(telefoneImportado, codigo, "cliente"); usuarios.push(acessoImportado.id);
  ok(acessoImportado.cliente?.id === importado.id && Boolean(acessoImportado.telefoneVerificadoEm), "OTP comum permite primeiro acesso de cliente importado sem duplicar ficha");
  const fichaImportada = await db.cliente.findUniqueOrThrow({ where: { id: importado.id } });
  ok(fichaImportada.nome === tag && fichaImportada.observacoes === importado.observacoes && fichaImportada.cpf === null, "primeiro acesso preserva cadastro legado incompleto");
  const telefone = await telefoneNovo();
  const dados = { telefone, nome: tag, senha: senhaTitular, codigo, cpf: "11144477735", email: "cadastro@example.test",
    endereco: "Endereço de ensaio local, 123", dataNascimento: new Date("1990-01-01T00:00:00Z") };
  await recusar(criarContaCliente({ ...dados, codigo: "" }), "cadastro sem prova de telefone é recusado");
  await inserirCodigo(telefone);
  await recusar(criarContaCliente({ ...dados, codigo: "654321" }), "código errado não cria credencial");
  ok(await db.usuario.count({ where: { telefone } }) === 0, "nenhum usuário é criado antes da prova correta");
  const novo = await criarContaCliente(dados);
  usuarios.push(novo.id); clientes.push(novo.cliente!.id);
  ok(Boolean(novo.telefoneVerificadoEm) && novo.papel === "CLIENTE" && await conferirSenha(senhaTitular, novo.senhaHash), "cadastro correto cria senha somente após comprovar celular");
  const perfil = await db.cliente.findUniqueOrThrow({ where: { id: novo.cliente!.id } });
  ok(perfil.nome === tag && perfil.email === dados.email && Boolean(perfil.perfilCompletoEm), "cadastro verificado preserva os dados do titular");
  await recusar(verificarCodigo(telefone, codigo, "cliente"), "OTP consumido não pode ser reutilizado");
  await inserirCodigo(telefone);
  await recusar(criarContaCliente({ ...dados, senha: senhaAnterior }), "novo cadastro não substitui senha já verificada");
  ok(await conferirSenha(senhaTitular, (await db.usuario.findUniqueOrThrow({ where: { id: novo.id } })).senhaHash), "senha verificada permanece após tentativa de recadastro");

  const legado = await clienteLegado();
  const tokenAntigo = await assinarToken({ usuarioId: legado.id, papel: "CLIENTE", nome: tag, clienteId: legado.cliente!.id, barbeiroId: null, sessaoVersao: 0 });
  await inserirCodigo(legado.telefone);
  const recuperado = await verificarCodigo(legado.telefone, codigo, "cliente");
  ok(recuperado.telefoneVerificadoEm && recuperado.senhaHash === null && recuperado.sessaoVersao === 1, "primeira prova revoga senha legada e avança versão da sessão");
  ok(await db.identidadeSocial.count({ where: { usuarioId: legado.id } }) === 0, "primeira prova remove identidades sociais anteriores sem prova");
  await recusar(entrarComSenha(legado.telefone, senhaAnterior, "cliente"), "senha anterior não autentica após recuperação do titular");
  const antigo = await lerToken(tokenAntigo);
  const tokenAtual = await assinarToken({ usuarioId: recuperado.id, papel: "CLIENTE", nome: tag, clienteId: recuperado.cliente!.id, barbeiroId: null, sessaoVersao: recuperado.sessaoVersao });
  ok(antigo?.sessaoVersao === 0 && antigo.sessaoVersao !== recuperado.sessaoVersao && (await lerToken(tokenAtual))?.sessaoVersao === 1, "tokens reais mantêm versões distintas para revalidação da sessão");
  await recusar(trocarPropriaSenha(legado.id, { nova: senhaAnterior }, 0), "sessão antiga não consegue reinstalar senha após prova do titular");
  await trocarPropriaSenha(legado.id, { nova: senhaTitular }, recuperado.sessaoVersao);
  ok((await entrarComSenha(legado.telefone, senhaTitular, "cliente")).id === legado.id, "titular com sessão atual pode definir e usar nova senha");

  const verificado = await clienteLegado(true, 4);
  await inserirCodigo(verificado.telefone);
  const preservado = await verificarCodigo(verificado.telefone, codigo, "cliente");
  ok(preservado.senhaHash === senhaHash && preservado.sessaoVersao === 4 && await db.identidadeSocial.count({ where: { usuarioId: verificado.id } }) === 1,
    "OTP recorrente preserva credenciais e versão de cliente já verificado");
  const telefoneEquipe = await telefoneNovo();
  const equipe = await db.usuario.create({ data: { nome: tag, telefone: telefoneEquipe, papel: "RECEPCAO", senhaHash, sessaoVersao: 2,
    identidadesSociais: { create: { provedor: "google", subject: `${tag}-staff` } } } }); usuarios.push(equipe.id);
  await inserirCodigo(equipe.telefone);
  const equipePreservada = await verificarCodigo(equipe.telefone, codigo, "equipe");
  ok(equipePreservada.papel === "RECEPCAO" && equipePreservada.senhaHash === senhaHash && equipePreservada.sessaoVersao === 2 && !equipePreservada.telefoneVerificadoEm,
    "prova da equipe não muda papel, senha ou versão");
  ok(await db.identidadeSocial.count({ where: { usuarioId: equipe.id } }) === 1, "OTP da equipe preserva vínculos anteriores");

  const concorrente = await clienteLegado();
  await inserirCodigo(concorrente.telefone);
  const provaDupla = await Promise.allSettled([verificarCodigo(concorrente.telefone, codigo, "cliente"), verificarCodigo(concorrente.telefone, codigo, "cliente")]);
  ok(provaDupla.filter(r => r.status === "fulfilled").length === 1, "duas provas simultâneas consomem o OTP uma única vez");
  ok((await db.usuario.findUniqueOrThrow({ where: { id: concorrente.id } })).sessaoVersao === 1 && await db.auditoria.count({ where: { entidadeId: concorrente.id, acao: "cliente_confirmar_celular" } }) === 1,
    "prova concorrente revoga e audita uma única vez");

  const corrida = await clienteLegado();
  await inserirCodigo(corrida.telefone);
  const disputa = await Promise.allSettled([
    trocarPropriaSenha(corrida.id, { atual: senhaAnterior, nova: "Senha-antiga-trocada!X8" }, 0),
    verificarCodigo(corrida.telefone, codigo, "cliente"),
  ]);
  ok(disputa[0].status === "rejected" && disputa[1].status === "fulfilled", "troca de senha legada concorrente não supera a prova do celular");
  const final = await db.usuario.findUniqueOrThrow({ where: { id: corrida.id } });
  ok(final.senhaHash === null && final.sessaoVersao === 1 && Boolean(final.telefoneVerificadoEm), "corrida termina sem credencial do cadastro não verificado");
  console.log(`${checks} verificações PostgreSQL de cadastro passaram; nenhum OTP ou pedido externo enviado.`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  // Inclui criação concluída antes de eventual erro da função, sempre pelo marcador do ensaio.
  const criados = await db.usuario.findMany({ where: { OR: [{ nome: tag }, { telefone: { in: telefones } }] }, select: { id: true, cliente: { select: { id: true } } } });
  const ids = [...new Set([...usuarios, ...criados.map(u => u.id)])];
  const clienteIds = [...new Set([...clientes, ...criados.flatMap(u => u.cliente ? [u.cliente.id] : [])])];
  await db.codigoLogin.deleteMany({ where: { telefone: { in: telefones } } });
  await db.identidadeSocial.deleteMany({ where: { usuarioId: { in: ids } } });
  await db.cliente.deleteMany({ where: { id: { in: clienteIds } } });
  await db.usuario.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});
