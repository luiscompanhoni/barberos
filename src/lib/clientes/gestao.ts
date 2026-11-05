import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { cadastroCompleto } from "./perfil-cadastro";
import { travarMudancaTelefone } from "@/lib/whatsapp/preferencia";
import { cpfMascarado, filtroClientes, TAMANHO_PAGINA_CLIENTES, type ConsultaClientes, type DadosClienteGestao } from "./gestao-regras";

const campos = { id: true, nome: true, telefone: true, email: true, cpf: true, endereco: true, dataNascimento: true,
  observacoes: true, usuarioId: true, criadoEm: true, fotoVersao: true, perfilCompletoEm: true } as const;
const resumoPlano = { id: true, status: true, plano: { select: { nome: true } } } as const;
const resumoAgenda = { id: true, inicio: true, status: true, servico: { select: { nome: true } }, barbeiro: { select: { nome: true } },
  adicionais: { select: { servico: { select: { nome: true } } }, orderBy: { inicio: "asc" } },
} as const;
type Cadastro = Prisma.ClienteGetPayload<{ select: typeof campos }>;

function exibir(c: Cadastro) {
  const { cpf, usuarioId, ...dados } = c;
  return { ...dados, cpfMascarado: cpfMascarado(cpf), temAcesso: Boolean(usuarioId), cadastroCompleto: cadastroCompleto(c),
    dataNascimento: c.dataNascimento?.toISOString().slice(0, 10) ?? null };
}

export async function listarClientes(consulta: ConsultaClientes) {
  const where = filtroClientes(consulta);
  const [total, encontrados] = await db.$transaction([
    db.cliente.count({ where }),
    db.cliente.findMany({ where, select: { ...campos,
      assinaturas: { where: { status: { not: "CANCELADA" } }, select: resumoPlano, orderBy: { criadaEm: "desc" }, take: 1 },
      agendamentos: { where: { status: "CONCLUIDO", adicionalDeId: null }, select: { inicio: true }, orderBy: { inicio: "desc" }, take: 1 },
    }, orderBy: [{ nome: "asc" }, { id: "asc" }], skip: (consulta.pagina - 1) * TAMANHO_PAGINA_CLIENTES, take: TAMANHO_PAGINA_CLIENTES }),
  ]);
  return { total, pagina: consulta.pagina, paginas: Math.max(1, Math.ceil(total / TAMANHO_PAGINA_CLIENTES)), clientes: encontrados.map((c) => ({
    ...exibir(c), assinatura: c.assinaturas[0] ?? null, ultimaVisita: c.agendamentos[0]?.inicio ?? null,
  })) };
}

export async function detalharCliente(id: string) {
  const cliente = await db.cliente.findFirst({ where: { id, excluidoEm: null }, select: campos });
  if (!cliente) throw naoEncontrado("Cliente");
  const [assinaturas, agendamentos, atendimentos, faltas] = await Promise.all([
    db.assinatura.findMany({ where: { clienteId: id }, select: { ...resumoPlano, proximoVencimento: true }, orderBy: { criadaEm: "desc" }, take: 10 }),
    db.agendamento.findMany({ where: { clienteId: id, adicionalDeId: null }, select: resumoAgenda, orderBy: { inicio: "desc" }, take: 20 }),
    db.agendamento.count({ where: { clienteId: id, status: "CONCLUIDO", adicionalDeId: null } }),
    db.agendamento.count({ where: { clienteId: id, status: "FALTOU", adicionalDeId: null } }),
  ]);
  return { cliente: exibir(cliente), assinaturas, agendamentos, atendimentos, faltas };
}

function tratarDuplicidade(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new ErroNegocio("Já existe um cadastro com este telefone. Procure o cliente antes de cadastrar novamente.", 409, "cliente_duplicado");
  }
  throw e;
}

export async function cadastrarCliente(dados: DadosClienteGestao, usuarioId: string) {
  try {
    const c = await db.$transaction(async (tx) => {
      const completo = cadastroCompleto({ ...dados, cpf: dados.cpf ?? null, email: dados.email ?? null,
        endereco: dados.endereco ?? null, dataNascimento: dados.dataNascimento ?? null });
      const criado = await tx.cliente.create({ data: { ...dados, aceitaMensagens: false, perfilCompletoEm: completo ? new Date() : null }, select: campos });
      await auditar(tx, usuarioId, "cadastrar", "cliente", criado.id, { origem: "gestao", campos: Object.keys(dados) });
      return criado;
    });
    return exibir(c);
  } catch (e) { return tratarDuplicidade(e); }
}

export async function editarCliente(id: string, dados: Partial<DadosClienteGestao>, usuarioId: string) {
  try {
    const c = await db.$transaction(async (tx) => {
      const referencia = await tx.cliente.findFirst({ where: { id, excluidoEm: null }, select: { usuarioId: true, telefone: true } });
      if (!referencia) throw naoEncontrado("Cliente");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-telefone:${referencia.telefone}`}))`;
      if (referencia.usuarioId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-usuario:${referencia.usuarioId}`}))`;
      if (dados.telefone && dados.telefone !== referencia.telefone) await travarMudancaTelefone(tx, referencia.telefone, dados.telefone);
      await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${id} FOR UPDATE`;
      const atual = await tx.cliente.findFirst({ where: { id, excluidoEm: null }, select: campos });
      if (!atual) throw naoEncontrado("Cliente");
      if (atual.usuarioId !== referencia.usuarioId || atual.telefone !== referencia.telefone) {
        throw new ErroNegocio("O acesso do cliente mudou. Atualize a ficha antes de salvar.", 409);
      }
      if (atual.usuarioId && dados.telefone && atual.telefone !== dados.telefone) {
        throw new ErroNegocio("Este telefone dá acesso ao aplicativo. A troca exige verificação do titular; mantenha o número atual.", 409, "telefone_com_acesso");
      }
      const completo = cadastroCompleto({ ...atual, ...dados });
      const alterado = await tx.cliente.update({ where: { id }, data: { ...dados, perfilCompletoEm: completo ? atual.perfilCompletoEm ?? new Date() : null }, select: campos });
      if (atual.usuarioId && dados.nome) await tx.usuario.updateMany({ where: { id: atual.usuarioId, papel: "CLIENTE" }, data: { nome: dados.nome } });
      await auditar(tx, usuarioId, "alterar_cadastro", "cliente", id, { origem: "gestao", campos: Object.keys(dados) });
      return alterado;
    });
    return exibir(c);
  } catch (e) { return tratarDuplicidade(e); }
}
