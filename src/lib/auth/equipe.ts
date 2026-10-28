import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { auditar, auditarMudanca } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { normalizarLogin } from "./acesso";
import { validarMudancaDeAcesso } from "./equipe-regras";
import type { EdicaoUsuario } from "./equipe-schemas";
import { configuravel, PERMISSOES } from "./permissoes-regras";
import { permissoesDe } from "./permissoes";
import type { Sessao } from "./sessao";

type Tx = Prisma.TransactionClient;

const incluirPerfil = { barbeiro: { include: { servicos: true } }, checklistPessoa: true, permissoes: true } as const;
type Perfil = Prisma.UsuarioGetPayload<{ include: typeof incluirPerfil }>;
const retrato = (u: Perfil) => ({
  nome: u.nome, telefone: u.telefone, login: u.login, papel: u.papel, ativo: u.ativo,
  atende: u.barbeiro?.ativo ?? false, cor: u.barbeiro?.cor ?? null,
  servicoIds: u.barbeiro?.servicos.map((v) => v.servicoId).sort() ?? [],
  cargo: u.checklistPessoa?.cargo ?? null, funcaoChecklist: u.checklistPessoa?.funcao ?? null,
  permissoes: Object.fromEntries(u.permissoes.toSorted((a, b) => a.permissao.localeCompare(b.permissao)).map((p) => [p.permissao, p.permitido])),
});

const selecionar = {
  id: true, nome: true, telefone: true, papel: true, login: true, ativo: true, senhaHash: true,
  trocarSenha: true, bloqueadoAte: true, permissoes: true,
  barbeiro: { select: { id: true, ativo: true, cor: true, fotoVersao: true, servicos: { select: { servicoId: true } } } },
  checklistPessoa: { select: { id: true, cargo: true, funcao: true } },
} satisfies Prisma.UsuarioSelect;

export async function listarAcessos(s: Sessao) {
  if (s.papel !== "DONO") throw proibido();
  const usuarios = await db.usuario.findMany({ where: { papel: { not: "CLIENTE" } }, orderBy: [{ papel: "asc" }, { nome: "asc" }], select: selecionar });
  return usuarios.map(({ senhaHash, bloqueadoAte, ...u }) => ({ ...u, eu: u.id === s.usuarioId, temSenha: !!senhaHash, bloqueado: !!bloqueadoAte && bloqueadoAte > new Date() }));
}

export async function opcoesDeAcesso(s: Sessao, id: string) {
  if (s.papel !== "DONO") throw proibido();
  const u = await db.usuario.findUnique({ where: { id }, select: selecionar });
  if (!u || u.papel === "CLIENTE") throw naoEncontrado("Usuário da equipe");
  const [base, servicos] = await Promise.all([
    permissoesDe(u.papel),
    db.servico.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  const { senhaHash, bloqueadoAte, ...usuario } = u;
  return {
    usuario: { ...usuario, eu: u.id === s.usuarioId, temSenha: !!senhaHash, bloqueado: !!bloqueadoAte && bloqueadoAte > new Date() }, servicos,
    permissoes: PERMISSOES.map((p) => ({ chave: p.chave, rotulo: p.rotulo, detalhe: p.detalhe, papeis: p.papeis, base: base[p.chave], excecao: u.permissoes.find((x) => x.permissao === p.chave)?.permitido ?? null })),
  };
}

/** O lock também serializa duas tentativas concorrentes de remover o último dono. */
async function prepararEdicao(tx: Tx, s: Sessao) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('barberos:acessos-equipe'))`;
  const ator = await tx.usuario.findUnique({ where: { id: s.usuarioId }, select: { ativo: true, papel: true } });
  if (!ator?.ativo || ator.papel !== "DONO") throw proibido();
}

async function atualizarPerfil(tx: Tx, usuarioId: string, d: EdicaoUsuario) {
  const u = await tx.usuario.findUniqueOrThrow({ where: { id: usuarioId }, include: { barbeiro: { include: { checklistPessoa: true } }, checklistPessoa: true } });
  let b = u.barbeiro;
  const atende = d.atende ?? b?.ativo ?? u.papel === "BARBEIRO";
  if (b && !atende && b.ativo) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${b.id}))`;
    const futuros = await tx.agendamento.count({ where: { barbeiroId: b.id, fim: { gt: new Date() }, status: { in: ["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO"] } } });
    if (futuros) throw new ErroNegocio("Resolva os atendimentos futuros antes de retirar esta pessoa da agenda.", 409, "agenda_pendente");
  }
  if (b) {
    b = await tx.barbeiro.update({ where: { id: b.id }, data: { nome: u.nome, ativo: atende, ...(d.cor ? { cor: d.cor } : {}) }, include: { checklistPessoa: true } });
  } else if (atende) {
    b = await tx.barbeiro.create({ data: { usuarioId: u.id, nome: u.nome, cor: d.cor ?? "#d3ab45", ordem: await tx.barbeiro.count() }, include: { checklistPessoa: true } });
  }
  const pessoa = u.checklistPessoa ?? b?.checklistPessoa;
  if (pessoa) {
    await tx.checklistPessoa.update({ where: { id: pessoa.id }, data: { usuarioId: u.id, nome: u.nome, telefone: u.telefone, ...(b ? { barbeiroId: b.id } : {}), ...(d.cargo !== undefined ? { cargo: d.cargo || null } : {}), ...(d.funcaoChecklist ? { funcao: d.funcaoChecklist } : {}) } });
  } else if (b || d.funcaoChecklist) {
    await tx.checklistPessoa.create({ data: { usuarioId: u.id, barbeiroId: b?.id, nome: u.nome, telefone: u.telefone, token: randomBytes(24).toString("hex"), funcao: d.funcaoChecklist ?? "BARBEIRO", cargo: d.cargo || null } });
  }
  if (d.servicoIds !== undefined) {
    if (!b && d.servicoIds.length) throw new ErroNegocio("Ative a agenda antes de escolher os serviços.");
    const ids = [...new Set(d.servicoIds)];
    if ((await tx.servico.count({ where: { id: { in: ids }, ativo: true } })) !== ids.length) throw new ErroNegocio("Escolha somente serviços ativos.");
    if (b) {
      await tx.barbeiroServico.deleteMany({ where: { barbeiroId: b.id, servicoId: { notIn: ids } } });
      await tx.barbeiroServico.createMany({ data: ids.map((servicoId) => ({ barbeiroId: b!.id, servicoId })), skipDuplicates: true });
    }
  }
}

function dadosNormalizados(d: EdicaoUsuario) {
  const telefone = d.telefone === undefined ? undefined : normalizarTelefone(d.telefone);
  if (d.telefone !== undefined && !telefone) throw new ErroNegocio("Telefone inválido. Informe DDD e número.", 400);
  const login = d.login ? normalizarLogin(d.login) : d.login === undefined ? undefined : null;
  if (d.login && !login) throw new ErroNegocio("Usuário: 3 a 30 caracteres, começando por letra, com letras, números, ponto ou traço.");
  return { nome: d.nome, telefone: telefone ?? undefined, login, papel: d.papel, ativo: d.ativo };
}

/** Atualização única preserva os identificadores de agenda, RH, pontos e comissões. */
export async function salvarAcesso(s: Sessao, id: string | null, d: EdicaoUsuario) {
  if (s.papel !== "DONO") throw proibido();
  const dados = dadosNormalizados(d);
  try {
    return await db.$transaction(async (tx) => {
      await prepararEdicao(tx, s);
      const anterior = id ? await tx.usuario.findUnique({ where: { id }, include: incluirPerfil }) : null;
      if (id && !anterior) throw naoEncontrado("Usuário");
      if (anterior) validarMudancaDeAcesso({ proprio: id === s.usuarioId, papelAtual: anterior.papel, ativoAtual: anterior.ativo, papel: dados.papel ?? anterior.papel, ativo: dados.ativo ?? anterior.ativo, donosAtivos: await tx.usuario.count({ where: { papel: "DONO", ativo: true } }) });
      const u = anterior
        ? await tx.usuario.update({ where: { id: anterior.id }, data: dados })
        : await tx.usuario.create({ data: { nome: dados.nome!, telefone: dados.telefone!, papel: dados.papel!, login: dados.login, ativo: dados.ativo } });
      await atualizarPerfil(tx, u.id, d);
      if (d.permissoes) {
        for (const [permissao, permitido] of Object.entries(d.permissoes)) {
          const k = PERMISSOES.find((p) => p.chave === permissao)?.chave;
          if (!k || (permitido !== null && !configuravel(u.papel, k))) throw new ErroNegocio("Permissão incompatível com a função escolhida.", 400);
          if (permitido === null) await tx.permissaoUsuario.deleteMany({ where: { usuarioId: u.id, permissao } });
          else await tx.permissaoUsuario.upsert({ where: { usuarioId_permissao: { usuarioId: u.id, permissao } }, create: { usuarioId: u.id, permissao, permitido }, update: { permitido } });
        }
      }
      // Exceções da função anterior não devem reaparecer numa promoção futura.
      await tx.permissaoUsuario.deleteMany({ where: { usuarioId: u.id, permissao: { notIn: PERMISSOES.filter((p) => configuravel(u.papel, p.chave)).map((p) => p.chave) } } });
      const depois = await tx.usuario.findUniqueOrThrow({ where: { id: u.id }, include: incluirPerfil });
      if (anterior) await auditarMudanca(tx, s.usuarioId, "editar_acesso", "usuario", u.id, retrato(anterior), retrato(depois));
      else await auditar(tx, s.usuarioId, "criar", "usuario", u.id, retrato(depois));
      return { id: u.id, ok: true };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ErroNegocio("Telefone, usuário ou vínculo já usado por outra pessoa. Confira o cadastro.", 409, "cadastro_duplicado");
    throw e;
  }
}
